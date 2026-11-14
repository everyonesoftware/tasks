export function isCurrentRefresh(startVersion, mutationVersion, pending) {
  return startVersion === mutationVersion && !pending;
}

export function canMutate(state, connected, pending, date) {
  return Boolean(state && state.date === date && connected && !pending);
}

export function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}

export function readCachedState(raw, date) {
  try {
    const cache = JSON.parse(raw);
    const s = cache?.state;
    const fieldsValid = row => row && ['title','notes','category','repeat'].every(key => typeof row[key] === 'string') && ['once','daily','weekly','monthly','yearly'].includes(row.repeat) && Number.isInteger(row.interval) && row.interval >= 1 && row.interval <= 365 && Number.isInteger(row.priority) && row.priority >= 0 && row.priority <= 2;
    const isoDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
    const taskValid = row => fieldsValid(row) && typeof row.id === 'string' && isoDate(row.startDate);
    const occurrenceValid = row => fieldsValid(row) && typeof row.occurrenceId === 'string' && typeof row.taskId === 'string' && isoDate(row.dueDate) && typeof row.completed === 'boolean' && typeof row.overdue === 'boolean';
    const p = s?.progress;
    const valid = s?.date === date && isoDate(date) && ['tasks','today','upcoming'].every(key => Array.isArray(s[key])) && s.tasks.every(taskValid) && s.today.every(occurrenceValid) && s.upcoming.every(occurrenceValid) && p && Number.isInteger(p.completed) && Number.isInteger(p.total) && p.completed >= 0 && p.total >= p.completed && typeof cache.savedAt === 'string';
    return valid ? cache : null;
  } catch { return null; }
}

export function deferOccurrence(rows, order, currentId) {
  const ids = orderWaiting(rows, order).map(row => row.occurrenceId);
  return ids.includes(currentId) ? [...ids.filter(id => id !== currentId), currentId] : ids;
}

export function orderWaiting(rows, order = []) {
  const waiting = rows.filter(row => !row.completed);
  return [...order.map(id => waiting.find(row => row.occurrenceId === id)).filter(Boolean), ...waiting.filter(row => !order.includes(row.occurrenceId))].filter((row, i, all) => all.findIndex(x => x.occurrenceId === row.occurrenceId) === i);
}
