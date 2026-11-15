import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchBuildVersion} from '../../apps/web/version.mjs';

test('web reads the actual same-origin server build version without retaining credentials', async () => {
  const version = await fetchBuildVersion(async (path, options) => {
    assert.equal(path, '/health');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.cache, 'no-store');
    return {ok: true, json: async () => ({status: 'ok', version: '137'})};
  });
  assert.equal(version, '137');
});

test('unversioned development and unavailable builds are not invented release numbers', async () => {
  assert.equal(await fetchBuildVersion(async () => ({ok:true, json:async () => ({status:'ok', version:'dev'})})), 'dev');
  for (const body of [{status:'ok', version:'0.2.0'}, {status:'ok', version:'<script>'}, {status:'ok', version:137}, {status:'failed', version:'137'}]) {
    assert.equal(await fetchBuildVersion(async () => ({ok:true, json:async () => body})), 'Unavailable');
  }
  assert.equal(await fetchBuildVersion(async () => ({ok:false})), 'Unavailable');
  assert.equal(await fetchBuildVersion(async () => {throw new Error('offline');}), 'Unavailable');
});
