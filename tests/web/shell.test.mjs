import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const root = new URL('../../apps/web/', import.meta.url);
test('client uses same-origin API, no offline queue, and periodic focus refresh', async () => {
  const source = await readFile(new URL('app.mjs', root), 'utf8').catch(()=> '');
  assert.match(source, /\/api\/state\?date=/);
  assert.match(source, /\/api\/occurrences\//);
  assert.match(source, /30_000/);
  assert.match(source, /addEventListener\('focus'/);
  assert.match(source, /if \(!connected \|\| pending\) return/);
  assert.doesNotMatch(source, /serviceWorker|fetch\(['"]https?:|localStorage\.setItem|sessionStorage\.setItem/);
});
test('real application shell exposes labelled native task and archive dialogs with exact editable fields', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8').catch(()=> '');
  assert.match(html, /<dialog id="task-dialog" aria-labelledby="task-dialog-title"/);
  assert.match(html, /<dialog id="archive-dialog" aria-labelledby="archive-dialog-title"/);
  for (const name of ['title','notes','category','repeat','interval','startDate','priority']) assert.ok(html.includes(`name="${name}"`), name);
  assert.match(html, /type="module" src="\/app.mjs"/);
  assert.doesNotMatch(html, /https?:\/\//);
});
