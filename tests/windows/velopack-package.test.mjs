import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import * as packaging from '../../scripts/windows-package.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'tasks-velopack-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'vpk'); fs.mkdirSync(source);
  const packageName = 'TasksWindows-0.1.137-win-x64-full.nupkg';
  // Inventory fixtures are deliberately not native installation evidence.
  const bytes = Buffer.from('PK\u0003\u0004fixture-package');
  fs.writeFileSync(path.join(source, packageName), bytes);
  const pe = Buffer.alloc(256); pe.write('MZ'); pe.writeUInt32LE(128, 60); pe.write('PE\0\0', 128, 'binary'); pe.writeUInt16LE(0x8664, 132);
  fs.writeFileSync(path.join(source, 'TasksWindows-win-x64-Setup.exe'), pe);
  const guard = path.join(root, 'guard.exe'); fs.writeFileSync(guard, Buffer.concat([pe, Buffer.from('guard')]));
  const asset = { PackageId: 'TasksWindows', Version: '0.1.137', Type: 'Full', FileName: packageName, Size: bytes.length,
    SHA1: crypto.createHash('sha1').update(bytes).digest('hex'), SHA256: crypto.createHash('sha256').update(bytes).digest('hex') };
  const save = () => fs.writeFileSync(path.join(source, 'releases.win-x64.json'), JSON.stringify({ Assets: [asset] })); save();
  return { root, source, guard, asset, save, packageName };
}

test('Velopack staging preserves exact feed/package bytes and distributes only guarded setup aliases', t => {
  const f = fixture(t), output = path.join(f.root, 'release');
  assert.equal(typeof packaging.stageVelopack, 'function', 'Velopack inventory staging is missing');
  packaging.stageVelopack(f.source, f.guard, output, '137');
  const names = fs.readdirSync(output).sort();
  assert.deepEqual(names, ['Tasks-Windows-137-Setup.exe', 'Tasks-Windows-137-Setup.exe.sha256', f.packageName,
    'TasksWindows-win-x64-Setup.exe', 'TasksWindows-win-x64-Setup.exe.sha256', 'releases.win-x64.json'].sort());
  for (const name of [f.packageName, 'releases.win-x64.json']) assert.deepEqual(fs.readFileSync(path.join(output, name)), fs.readFileSync(path.join(f.source, name)));
  for (const name of ['Tasks-Windows-137-Setup.exe', 'TasksWindows-win-x64-Setup.exe']) {
    assert.deepEqual(fs.readFileSync(path.join(output, name)), fs.readFileSync(f.guard));
    assert.equal(fs.readFileSync(path.join(output, name + '.sha256'), 'utf8'), `${crypto.createHash('sha256').update(fs.readFileSync(f.guard)).digest('hex')}  ${name}\n`);
  }
  assert.throws(() => packaging.stageVelopack(f.source, f.guard, output, '137'), /empty|overwrit/i);
});

test('Velopack staging fails before output for mismatched, ambiguous, unsafe or corrupted inventories', t => {
  assert.equal(typeof packaging.stageVelopack, 'function');
  for (const [field, value] of [['PackageId', 'Other'], ['Version', '0.1.138'], ['Type', 'Delta'], ['FileName', '../bad.nupkg'], ['Size', 1], ['SHA256', '0'.repeat(64)], ['SHA1', '0'.repeat(40)]]) {
    const f = fixture(t); f.asset[field] = value; f.save(); const out = path.join(f.root, 'out');
    assert.throws(() => packaging.stageVelopack(f.source, f.guard, out, '137'), /feed|package|inventory|digest/i, field);
    assert.equal(fs.existsSync(out), false);
  }
  for (const name of ['releases.win-x64.json', 'TasksWindows-win-x64-Setup.exe', 'TasksWindows-0.1.137-win-x64-full.nupkg']) {
    const f = fixture(t); fs.unlinkSync(path.join(f.source, name));
    assert.throws(() => packaging.stageVelopack(f.source, f.guard, path.join(f.root, 'out'), '137'));
  }
  const f = fixture(t); fs.writeFileSync(path.join(f.source, 'releases.win-x64.json'), JSON.stringify({ Assets: [f.asset, f.asset] }));
  assert.throws(() => packaging.stageVelopack(f.source, f.guard, path.join(f.root, 'out'), '137'), /feed|ambiguous/i);
});
