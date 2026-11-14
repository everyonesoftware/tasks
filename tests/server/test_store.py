import tempfile
import unittest
from pathlib import Path


class StoreTests(unittest.TestCase):
    def setUp(self):
        from services.server.store import Store
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'daymark.sqlite3'
        self.store = Store(self.path)
        self.user_id = self.store.create_user('Fixture', 'fixture-password')
        self.store = self.store.for_user(self.user_id)

    def create(self, **fields):
        return self.store.create({'title': 'Task', 'startDate': '2026-11-14', **fields})

    def test_state_renders_latest_overdue_and_sorted_upcoming(self):
        low = self.create(title='low', repeat='daily', interval=3, startDate='2026-11-01')
        high = self.create(title='high', priority=2, startDate='2026-11-13')
        future = self.create(title='future', startDate='2026-12-01')
        state = self.store.state('2026-11-14')
        self.assertEqual([o['taskId'] for o in state['today']], [high['id'], low['id']])
        occurrence = state['today'][1]
        self.assertEqual(occurrence, dict(occurrenceId=low['id']+'@2026-11-13', taskId=low['id'],
            title='low', notes='', category='Personal', repeat='daily', interval=3, priority=0,
            dueDate='2026-11-13', completed=False, completedAt=None, overdue=True))
        self.assertEqual([o['dueDate'] for o in state['upcoming']], ['2026-11-16', '2026-12-01'])
        self.assertEqual(state['upcoming'][1]['taskId'], future['id'])
        self.assertEqual(state['progress'], {'completed': 0, 'total': 2})

    def test_edit_and_archive_preserve_identity_and_history(self):
        from services.server.validation import APIError
        task = self.create()
        edited = self.store.update(task['id'], {'title': 'Edited', 'startDate': '2026-11-16'})
        self.assertEqual((edited['id'], edited['createdAt']), (task['id'], task['createdAt']))
        self.assertEqual(self.store.state('2026-11-14')['upcoming'][0]['title'], 'Edited')
        self.store.archive(task['id'])
        self.assertEqual(self.store.state('2026-11-14')['tasks'], [])
        with self.store.connection() as db:
            self.assertEqual(db.execute('SELECT archived FROM tasks WHERE id=?', (task['id'],)).fetchone()[0], 1)
        for action in (lambda: self.store.update(task['id'], {'title':'x', 'startDate':'2026-11-14'}),
                       lambda: self.store.archive('missing')):
            with self.assertRaises(APIError) as caught:
                action()
            self.assertEqual(caught.exception.status, 404)

    def test_completion_undo_are_idempotent_and_persistent(self):
        from services.server.store import Store
        task = self.create(repeat='weekly', startDate='2026-11-12')
        data = {'taskId':task['id'], 'dueDate':'2026-11-12', 'date':'2026-11-14'}
        state = self.store.complete(data)
        self.assertEqual(state['progress'], {'completed':1, 'total':1})
        self.assertTrue(state['today'][0]['completedAt'].endswith('Z'))
        self.assertEqual(self.store.complete(data), state)
        self.assertEqual(Store(self.path).for_user(self.user_id).state(data['date']), state)
        self.assertEqual(self.store.state('2026-11-15')['today'], [])
        undone = self.store.undo(data)
        self.assertFalse(undone['today'][0]['completed'])
        self.assertEqual(self.store.undo(data), undone)
        self.store.complete(data)
        self.store.archive(task['id'])
        exported = self.store.export()
        self.assertEqual(exported['schemaVersion'], 1)
        self.assertEqual(exported['tasks'][0]['archived'], 1)
        self.assertEqual(exported['completions'][0]['completedOn'], data['date'])
        self.assertEqual(exported['completions'][0]['taskId'], task['id'])

    def test_invalid_occurrences_cannot_change_completion_history(self):
        from services.server.validation import APIError
        task = self.create(repeat='weekly')
        valid = {'taskId':task['id'], 'dueDate':'2026-11-14', 'date':'2026-11-14'}
        bad = [None, [], {}, {**valid, 'extra':1}, {**valid, 'taskId':True},
               {**valid, 'taskId':'missing'}, {**valid, 'dueDate':'2026-11-21'},
               {**valid, 'dueDate':'2026-11-13'}, {**valid, 'dueDate':'2026-11-15', 'date':'2026-11-16'},
               {**valid, 'date':'2026-02-30'}, {**valid, 'dueDate':'2026-02-30'}]
        for data in bad:
            for method in (self.store.complete, self.store.undo):
                with self.subTest(data=data, method=method.__name__), self.assertRaises(APIError):
                    method(data)
        self.assertEqual(self.store.export()['completions'], [])
        self.store.archive(task['id'])
        for method in (self.store.complete, self.store.undo):
            with self.assertRaises(APIError) as caught:
                method(valid)
            self.assertEqual(caught.exception.status, 404)

    def test_completed_today_sorts_last_and_does_not_resurface_old_cycles(self):
        task = self.create(title='daily', repeat='daily', priority=2)
        other = self.create(title='once')
        data = {'taskId':task['id'], 'dueDate':'2026-11-14', 'date':'2026-11-14'}
        state = self.store.complete(data)
        self.assertEqual([o['taskId'] for o in state['today']], [other['id'], task['id']])
        tomorrow = self.store.state('2026-11-15')
        self.assertEqual(tomorrow['progress'], {'completed':0, 'total':2})
        daily = next(o for o in tomorrow['today'] if o['taskId'] == task['id'])
        self.assertEqual((daily['dueDate'], daily['completed']), ('2026-11-15', False))
        self.store.update(task['id'], {'title':'changed schedule', 'startDate':'2026-12-01', 'repeat':'monthly'})
        self.assertEqual(len(self.store.export()['completions']), 1)
        self.assertEqual(self.store.state('2026-11-15')['progress'], {'completed':0, 'total':1})

    def test_simultaneous_completion_is_idempotent(self):
        from concurrent.futures import ThreadPoolExecutor
        task = self.create()
        data = {'taskId':task['id'], 'dueDate':'2026-11-14', 'date':'2026-11-14'}
        with ThreadPoolExecutor(max_workers=4) as pool:
            states = list(pool.map(lambda _: self.store.complete(data), range(8)))
        self.assertTrue(all(state == states[0] for state in states))
        self.assertEqual(len(self.store.export()['completions']), 1)

    def test_overdue_completed_today_is_visible_even_when_new_cycle_is_due(self):
        task = self.create(repeat='daily', startDate='2026-11-13')
        state = self.store.complete({'taskId':task['id'], 'dueDate':'2026-11-13', 'date':'2026-11-14'})
        self.assertEqual([(o['dueDate'], o['completed']) for o in state['today']],
                         [('2026-11-14', False), ('2026-11-13', True)])
        self.assertEqual(state['progress'], {'completed':1, 'total':2})
        self.assertEqual([o['dueDate'] for o in self.store.state('2026-11-15')['today']], ['2026-11-15'])

    def test_completed_once_never_appears_upcoming(self):
        task = self.create(startDate='2026-12-01')
        self.store.complete({'taskId':task['id'], 'dueDate':'2026-12-01', 'date':'2026-12-01'})
        self.assertEqual(self.store.state('2026-11-14')['upcoming'], [])
        self.assertEqual(self.store.state('2026-12-02')['today'], [])

    def test_upcoming_order_is_due_date_not_completion_status(self):
        early = self.create(repeat='weekly', startDate='2026-11-15')
        late = self.create(startDate='2026-11-16')
        self.store.complete({'taskId':early['id'], 'dueDate':'2026-11-15', 'date':'2026-11-15'})
        self.assertEqual([o['taskId'] for o in self.store.state('2026-11-14')['upcoming']], [early['id'], late['id']])

    def test_create_empty_database_and_restart_persistence(self):
        from services.server.store import Store
        from uuid import UUID
        self.assertEqual(self.store.state('2026-11-14')['tasks'], [])
        task = self.create(title="   Robert'); DROP TABLE tasks;--  ")
        UUID(task['id'])
        self.assertTrue(task['createdAt'].endswith('Z'))
        self.assertEqual(task['title'], "Robert'); DROP TABLE tasks;--")
        self.assertEqual(Store(self.path).for_user(self.user_id).state('2026-11-14')['tasks'], [task])
