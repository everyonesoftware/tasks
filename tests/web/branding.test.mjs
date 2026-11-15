import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const root = new URL('../../apps/web/', import.meta.url);
const read = name => readFile(new URL(name, root), 'utf8');

test('web shell, sign-in, Settings About and PWA consistently identify Tasks', async () => {
  const [html, app, icon, manifestSource, readme] = await Promise.all(
    ['index.html', 'app.mjs', 'icon.svg', 'manifest.webmanifest', 'README.md'].map(read)
  );
  assert.match(html, /<title>Tasks<\/title>/);
  assert.match(html, /aria-label="Tasks home"/);
  assert.match(html, /class="brand"[^>]*>[\s\S]*?<\/span>Tasks<\/a>/);
  assert.match(html, /Welcome to Tasks\./);
  assert.match(html, /Checking this server…/);
  assert.match(html, /Tasks needs JavaScript enabled/);
  assert.match(app, /Welcome to Tasks\./);
  assert.match(app, /Connecting to your Tasks server\./);
  assert.match(app, /Tasks never saves your password\./);
  assert.match(app, /<h2 id="about-heading">About<\/h2><p>Tasks web · Version /);
  assert.match(icon, /role="img"/);
  assert.match(icon, /aria-label="Tasks"/);
  const manifest = JSON.parse(manifestSource);
  assert.equal(manifest.name, 'Tasks');
  assert.equal(manifest.short_name, 'Tasks');
  assert.match(readme, /^# Tasks web/m);
  for (const [name, source] of Object.entries({html, app, icon, manifestSource})) {
    assert.doesNotMatch(source, /daymark/i, `${name} still exposes the previous brand`);
  }
});

test('rebranding preserves historical browser storage and sign-out compatibility', async () => {
  const auth = await read('auth.mjs');
  for (const key of ['daymark-state-v1', 'daymark-order-', 'daymark-signed-out-v1']) {
    assert.ok(auth.includes(`'${key}'`), `preserve ${key}`);
  }
  const smoke = await readFile(new URL('./api-smoke.mjs', import.meta.url), 'utf8');
  assert.ok(smoke.includes("includes('daymark_session')"));
  assert.ok(smoke.includes("localStorage.getItem('daymark-signed-out-v1')==='1'"));
});