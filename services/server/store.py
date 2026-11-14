"""Transactional SQLite persistence; every operation owns its connection."""
from contextlib import closing, contextmanager
from datetime import datetime, timezone
from pathlib import Path
import sqlite3
from uuid import uuid4

from .validation import task_fields
from .auth import AuthMixin, AUTH_SCHEMA


SCHEMA = """
CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, notes TEXT NOT NULL,
    category TEXT NOT NULL, repeat TEXT NOT NULL, interval INTEGER NOT NULL,
    startDate TEXT NOT NULL, priority INTEGER NOT NULL, createdAt TEXT NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS completions (
    taskId TEXT NOT NULL REFERENCES tasks(id), dueDate TEXT NOT NULL,
    completedOn TEXT NOT NULL, completedAt TEXT NOT NULL,
    PRIMARY KEY(taskId, dueDate)
);
"""


def utc_now():
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


def public_task(row):
    return {key: row[key] for key in row.keys() if key not in ('archived', 'ownerId')}


class Store(AuthMixin):
    def __init__(self, path):
        self.path = str(path)
        self._owner = None
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(self.path)) as db:
            db.execute('PRAGMA journal_mode=WAL')
            db.executescript(AUTH_SCHEMA + SCHEMA)
            if 'ownerId' not in {row[1] for row in db.execute('PRAGMA table_info(tasks)')}:
                db.execute('ALTER TABLE tasks ADD COLUMN ownerId TEXT REFERENCES users(id)')
            db.execute('CREATE INDEX IF NOT EXISTS tasks_owner ON tasks(ownerId)')

    def adopt_legacy(self, username):
        from .validation import APIError
        with self.connection(write=True) as db:
            user = db.execute('SELECT id FROM users WHERE username=?', (username,)).fetchone()
            if user is None:
                raise APIError('User not found', 404)
            return db.execute('UPDATE tasks SET ownerId=? WHERE ownerId IS NULL', (user['id'],)).rowcount

    @property
    def owner(self):
        from .validation import APIError
        if self._owner is None:
            raise APIError('Authentication required', 401)
        return self._owner

    def for_user(self, user_id):
        from .validation import APIError
        with self.connection() as db:
            if not db.execute('SELECT 1 FROM users WHERE id=?', (user_id,)).fetchone():
                raise APIError('Authentication required', 401)
        scoped = object.__new__(Store)
        scoped.path, scoped._owner = self.path, user_id
        return scoped

    @contextmanager
    def connection(self, write=False):
        db = sqlite3.connect(self.path, timeout=10, isolation_level=None)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys=ON')
        try:
            db.execute('BEGIN IMMEDIATE' if write else 'BEGIN')
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    def create(self, data):
        owner = self.owner
        task = task_fields(data)
        task.update(id=str(uuid4()), createdAt=utc_now())
        with self.connection(write=True) as db:
            db.execute('INSERT INTO tasks (title, notes, category, repeat, interval, priority, startDate, id, createdAt, ownerId) VALUES (:title, :notes, :category, :repeat, :interval, :priority, :startDate, :id, :createdAt, :owner)', {**task, 'owner': owner})
        return task

    def update(self, task_id, data):
        owner = self.owner
        from .validation import APIError
        fields = task_fields(data)
        with self.connection(write=True) as db:
            if not db.execute('SELECT 1 FROM tasks WHERE id=? AND ownerId=? AND archived=0', (task_id, owner)).fetchone():
                raise APIError('Task not found', 404)
            db.execute('UPDATE tasks SET title=:title, notes=:notes, category=:category, repeat=:repeat, interval=:interval, startDate=:startDate, priority=:priority WHERE id=:id', {**fields, 'id': task_id})
            return public_task(db.execute('SELECT * FROM tasks WHERE id=?', (task_id,)).fetchone())

    def archive(self, task_id):
        owner = self.owner
        from .validation import APIError
        with self.connection(write=True) as db:
            if not db.execute('UPDATE tasks SET archived=1 WHERE id=? AND ownerId=?', (task_id, owner)).rowcount:
                raise APIError('Task not found', 404)

    def complete(self, data):
        return self._completion(data, undo=False)

    def undo(self, data):
        return self._completion(data, undo=True)

    def _completion(self, data, undo):
        owner = self.owner
        from .validation import iso_date, APIError
        from .schedule import around
        if not isinstance(data, dict) or set(data) != {'taskId', 'dueDate', 'date'}:
            raise APIError('Expected taskId, dueDate and date')
        task_id = data['taskId']
        if (not isinstance(task_id, str) or not task_id or len(task_id) > 100 or
                any(0xD800 <= ord(char) <= 0xDFFF for char in task_id)):
            raise APIError('Invalid taskId')
        due, on = iso_date(data['dueDate'], 'dueDate'), iso_date(data['date'])
        with self.connection(write=True) as db:
            task = db.execute('SELECT * FROM tasks WHERE id=? AND ownerId=? AND archived=0', (task_id, owner)).fetchone()
            if task is None:
                raise APIError('Task not found', 404)
            latest, _ = around(iso_date(task['startDate']), task['repeat'], task['interval'], due)
            if due > on or latest != due:
                raise APIError('Occurrence must be scheduled and not in the future')
            if undo:
                db.execute('DELETE FROM completions WHERE taskId=? AND dueDate=?', (task_id, due.isoformat()))
            else:
                db.execute('INSERT INTO completions (taskId, dueDate, completedOn, completedAt) VALUES (?, ?, ?, ?) ON CONFLICT(taskId, dueDate) DO NOTHING',
                           (task_id, due.isoformat(), on.isoformat(), utc_now()))
        return self.state(on.isoformat())

    def export(self):
        owner = self.owner
        with self.connection() as db:
            return {'schemaVersion': 1,
                    'tasks': [{key: row[key] for key in row.keys() if key != 'ownerId'} for row in db.execute('SELECT * FROM tasks WHERE ownerId=? ORDER BY createdAt, id', (owner,))],
                    'completions': [dict(row) for row in db.execute('SELECT c.* FROM completions c JOIN tasks t ON t.id=c.taskId WHERE t.ownerId=? ORDER BY c.taskId, c.dueDate', (owner,))]}

    def state(self, on):
        owner = self.owner
        from .validation import iso_date
        from .schedule import around
        on = iso_date(on)
        with self.connection() as db:
            tasks = [public_task(row) for row in db.execute('SELECT * FROM tasks WHERE ownerId=? AND archived=0 ORDER BY createdAt, id', (owner,))]
            completions = {(row['taskId'], row['dueDate']): dict(row) for row in db.execute('SELECT c.* FROM completions c JOIN tasks t ON t.id=c.taskId WHERE t.ownerId=?', (owner,))}
        today, upcoming = [], []
        completed_today = {}
        for (task_id, due), completion in completions.items():
            if due < on.isoformat() and completion['completedOn'] == on.isoformat():
                completed_today.setdefault(task_id, []).append(iso_date(due))
        for task in tasks:
            latest, following = around(iso_date(task['startDate']), task['repeat'], task['interval'], on)
            def occurrence(due):
                completion = completions.get((task['id'], due.isoformat()))
                return {**{key: task[key] for key in ('title', 'notes', 'category', 'repeat', 'interval', 'priority')},
                        'occurrenceId': task['id'] + '@' + due.isoformat(), 'taskId': task['id'],
                        'dueDate': due.isoformat(), 'completed': completion is not None,
                        'completedAt': completion['completedAt'] if completion else None, 'overdue': due < on}
            if latest:
                completion = completions.get((task['id'], latest.isoformat()))
                if not completion or latest == on or completion['completedOn'] == on.isoformat():
                    today.append(occurrence(latest))
            for due in completed_today.get(task['id'], []):
                scheduled, _ = around(iso_date(task['startDate']), task['repeat'], task['interval'], due)
                if due != latest and scheduled == due:
                    today.append(occurrence(due))
            if following and not (task['repeat'] == 'once' and (task['id'], following.isoformat()) in completions):
                upcoming.append(occurrence(following))
        order = {task['id']: (task['createdAt'], task['id']) for task in tasks}
        def sort_key(item):
            return item['completed'], item['dueDate'], -item['priority'], order[item['taskId']]
        today.sort(key=sort_key)
        upcoming.sort(key=lambda item: (item['dueDate'], -item['priority'], order[item['taskId']]))
        return {'date': on.isoformat(), 'tasks': tasks, 'today': today, 'upcoming': upcoming,
                'progress': {'completed': sum(item['completed'] for item in today), 'total': len(today)}}
