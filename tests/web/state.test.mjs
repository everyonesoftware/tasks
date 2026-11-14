import test from 'node:test';
import assert from 'node:assert/strict';
const helpers = await import('../../apps/web/state.mjs').catch(() => ({}));
test('a refresh started before a mutation cannot overwrite the newer mutation state', () => {
  assert.equal(typeof helpers.isCurrentRefresh, 'function');
  assert.equal(helpers.isCurrentRefresh(1,1,false), true);
  assert.equal(helpers.isCurrentRefresh(1,2,false), false);
  assert.equal(helpers.isCurrentRefresh(1,1,true), false);
});
test('cached state rejects malformed rows and unsafe progress fields', () => {
  const state = {date:'2026-11-14',tasks:[],today:[],upcoming:[],progress:{completed:0,total:0}};
  for (const change of [{tasks:[null]},{today:[{}]},{upcoming:[{title:'bad'}]},{progress:{completed:'<img>',total:1}},{progress:{completed:-1,total:1}},{progress:{completed:2,total:1}}]) {
    assert.equal(helpers.readCachedState(JSON.stringify({state:{...state,...change},savedAt:'saved'}),state.date),null);
  }
});
test('mutation permission requires a live, idle, current-date state', () => {
  assert.equal(typeof helpers.canMutate, 'function');
  assert.equal(helpers.canMutate({date:'2026-11-14'}, true, false, '2026-11-14'), true);
  assert.equal(helpers.canMutate({date:'2026-11-14'}, false, false, '2026-11-14'), false);
  assert.equal(helpers.canMutate({date:'2026-11-14'}, true, true, '2026-11-14'), false);
  assert.equal(helpers.canMutate({date:'2026-11-14'}, true, false, '2026-11-15'), false);
  assert.equal(helpers.canMutate(null, true, false, '2026-11-14'), false);
});
test('HTML interpolation escapes arbitrary task titles and notes', () => {
  assert.equal(typeof helpers.escapeHTML, 'function');
  assert.equal(helpers.escapeHTML('<img src=x onerror="alert(1)"> & \'text\''), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;text&#39;');
});
test('cached state rejects corrupt data and mismatched date rather than showing the wrong day', () => {
  assert.equal(typeof helpers.readCachedState, 'function');
  const state = {date:'2026-11-14', tasks:[], today:[], upcoming:[],progress:{completed:0,total:0}};
  assert.deepEqual(helpers.readCachedState(JSON.stringify({state,savedAt:'saved'}), state.date).state, state);
  for (const raw of ['bad', '{}', JSON.stringify({state})]) assert.equal(helpers.readCachedState(raw, '2026-11-15'), null);
});
test('per-date ordering retains Not now order and selected occurrence across refresh', () => {
  const rows = [{occurrenceId:'a',completed:false},{occurrenceId:'b',completed:false},{occurrenceId:'c',completed:true}];
  assert.equal(typeof helpers.orderWaiting, 'function');
  assert.deepEqual(helpers.orderWaiting(rows, ['b','a']).map(x=>x.occurrenceId), ['b','a']);
  assert.deepEqual(helpers.orderWaiting([...rows,{occurrenceId:'d',completed:false}], ['b','a']).map(x=>x.occurrenceId), ['b','a','d']);
});
test('Not now rotates only the current occurrence without completing it', () => {
  const rows = [{occurrenceId:'a',completed:false},{occurrenceId:'b',completed:false}];
  assert.equal(typeof helpers.deferOccurrence, 'function');
  assert.deepEqual(helpers.deferOccurrence(rows, [], 'a'), ['b','a']);
  assert.deepEqual(rows.map(x=>x.completed), [false,false]);
  assert.deepEqual(helpers.deferOccurrence(rows, ['b','a'], 'b'), ['a','b']);
});
