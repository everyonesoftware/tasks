import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function validateBuildNumber(value) {
  const raw = String(value);
  const number = Number(raw);
  if (!/^[1-9][0-9]*$/.test(raw) || !Number.isSafeInteger(number) || number > 65534 || String(number) !== raw) {
    throw new Error('Windows build number must be a canonical integer from 1 through 65534.');
  }
  return number;
}

export function buildInfo(root, requested) {
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  if (git('rev-parse', '--is-shallow-repository') !== 'false') throw new Error('Windows releases require full Git history.');
  const buildNumber = validateBuildNumber(git('rev-list', '--count', 'HEAD'));
  if (requested !== undefined && validateBuildNumber(requested) !== buildNumber) throw new Error('Windows build number does not match this source commit.');
  const sourceSha = git('rev-parse', 'HEAD');
  if (!/^[0-9a-f]{40}$/.test(sourceSha)) throw new Error('Invalid source commit identity.');
  return { buildNumber, version: `0.1.${buildNumber}`, fileVersion: `0.1.${buildNumber}.0`, sourceSha, filename: `Tasks-Windows-${buildNumber}-Setup.exe` };
}

function peMachine(filename) {
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.size < 64) throw new Error('Expected a real PE executable.');
  const handle = fs.openSync(filename, 'r');
  try {
    const header = Buffer.alloc(64);
    if (fs.readSync(handle, header, 0, 64, 0) !== 64 || header.readUInt16LE() !== 0x5a4d) throw new Error('Invalid PE executable header.');
    const offset = header.readUInt32LE(0x3c);
    if (offset < 64 || offset > 4 * 1024 * 1024 || offset + 6 > stat.size) throw new Error('Invalid PE executable offset.');
    const pe = Buffer.alloc(6);
    if (fs.readSync(handle, pe, 0, 6, offset) !== 6 || !pe.subarray(0, 4).equals(Buffer.from('PE\0\0', 'binary'))) throw new Error('Invalid PE executable signature.');
    return pe.readUInt16LE(4);
  } finally { fs.closeSync(handle); }
}

const nativeFiles = ['Tasks.exe', 'Microsoft.UI.Xaml.dll', 'Microsoft.WindowsAppRuntime.dll', 'coreclr.dll'];
const requiredFiles = [...nativeFiles, 'Tasks.dll', 'resources.pri'];
const privateName = /^(?:\.git|\.data|\.env(?:\..*)?|session\.dat)$|\.(?:key|p12|pfx|jks|keystore|db|sqlite|sqlite3)$/i;

export function validatePayload(directory) {
  if (!fs.lstatSync(directory).isDirectory() || fs.lstatSync(directory).isSymbolicLink()) throw new Error('Publish payload must be an actual directory, not a link.');
  const files = [], folded = new Map();
  function visit(relative) {
    for (const entry of fs.readdirSync(path.join(directory, relative), { withFileTypes: true })) {
      const name = path.join(relative, entry.name);
      const key = name.replaceAll('\\', '/').toLowerCase();
      if (folded.has(key)) throw new Error('Duplicate case-folded Windows payload member.');
      folded.set(key, name);
      if (privateName.test(entry.name)) throw new Error('Sensitive/private data is not a publish payload.');
      const stat = fs.lstatSync(path.join(directory, name));
      if (stat.isSymbolicLink()) throw new Error('Linked files are not allowed in a publish payload.');
      if (stat.isDirectory()) visit(name);
      else if (stat.isFile()) files.push(name);
      else throw new Error('Unsupported publish payload member.');
    }
  }
  visit('');
  for (const required of requiredFiles) {
    const actual = folded.get(required.toLowerCase());
    if (!actual || !files.includes(actual) || fs.statSync(path.join(directory, actual)).size === 0) throw new Error(`Missing required native publish file: ${required}`);
    if (nativeFiles.includes(required) && peMachine(path.join(directory, actual)) !== 0x8664) throw new Error(`Native publish file must have x64 architecture: ${required}`);
  }
  if (![0x14c, 0x8664].includes(peMachine(path.join(directory, folded.get('tasks.dll'))))) throw new Error('Invalid managed PE executable architecture.');
  return files;
}

export function stageInstaller(setupPath, outputDirectory, value) {
  const buildNumber = validateBuildNumber(value);
  if (![0x14c, 0x8664].includes(peMachine(setupPath))) throw new Error('Unsupported installer PE executable architecture.');
  const bytes = fs.readFileSync(setupPath);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const filename = `Tasks-Windows-${buildNumber}-Setup.exe`;
  if (fs.existsSync(outputDirectory)) {
    const stat = fs.lstatSync(outputDirectory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Installer staging requires a directory, not a link.');
    if (fs.readdirSync(outputDirectory).length !== 0) throw new Error('Installer staging directory must be empty; existing bytes will not be overwritten.');
  }
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(path.join(outputDirectory, filename), bytes, { flag: 'wx' });
  fs.writeFileSync(path.join(outputDirectory, filename + '.sha256'), `${sha256}  ${filename}\n`, { flag: 'wx' });
  return { filename, sha256, bytes: bytes.length };
}

// The public setup is an unregistered migration guard containing the genuine vpk
// setup. Never publish the unguarded bootstrapper: it cannot detect old Inno installs.
export function stageVelopack(source, guardedSetup, output, value) {
  const number = validateBuildNumber(value), version = `0.1.${number}`;
  const packageName = `TasksWindows-${version}-win-x64-full.nupkg`;
  const setupName = 'TasksWindows-win-x64-Setup.exe';
  const feedName = 'releases.win-x64.json';
  for (const name of [packageName, setupName, feedName]) {
    const stat = fs.lstatSync(path.join(source, name));
    if (!stat.isFile() || stat.isSymbolicLink() || !stat.size) throw new Error('Invalid Velopack inventory member.');
  }
  if (![0x14c, 0x8664].includes(peMachine(path.join(source, setupName))) || ![0x14c, 0x8664].includes(peMachine(guardedSetup))) throw new Error('Invalid Velopack setup executable.');
  const feedBytes = fs.readFileSync(path.join(source, feedName));
  const feed = JSON.parse(feedBytes.toString('utf8').replace(/^\uFEFF/, ''));
  if (!Array.isArray(feed.Assets) || feed.Assets.length !== 1) throw new Error('Ambiguous Velopack feed inventory.');
  const asset = feed.Assets[0], bytes = fs.readFileSync(path.join(source, packageName));
  if (asset.PackageId !== 'TasksWindows' || asset.Version !== version || asset.Type !== 'Full' || asset.FileName !== packageName || asset.Size !== bytes.length) throw new Error('Velopack feed package identity mismatch.');
  for (const [field, algorithm] of [['SHA1', 'sha1'], ['SHA256', 'sha256']]) {
    if (typeof asset[field] !== 'string' || asset[field].toLowerCase() !== crypto.createHash(algorithm).update(bytes).digest('hex')) throw new Error('Velopack feed package digest mismatch.');
  }
  if (!bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 3, 4]))) throw new Error('Velopack package is not a ZIP archive.');
  // Native build additionally validates the ZIP inventory and extracted payload.
  const guard = fs.readFileSync(guardedSetup), digest = crypto.createHash('sha256').update(guard).digest('hex');
  const files = new Map([[packageName, bytes], [feedName, feedBytes]]);
  for (const name of [setupName, `Tasks-Windows-${number}-Setup.exe`]) {
    files.set(name, guard); files.set(name + '.sha256', Buffer.from(`${digest}  ${name}\n`));
  }
  if (fs.existsSync(output) && (!fs.lstatSync(output).isDirectory() || fs.lstatSync(output).isSymbolicLink() || fs.readdirSync(output).length)) throw new Error('Velopack output must be empty; refusing to overwrite release bytes.');
  fs.mkdirSync(output, { recursive: true });
  for (const [name, data] of files) fs.writeFileSync(path.join(output, name), data, { flag: 'wx' });
  return { version, files: [...files.keys()] };
}

function argumentsFor(values) {
  const options = new Map();
  for (let i = 0; i < values.length; i += 2) {
    if (!values[i]?.startsWith('--') || values[i + 1] === undefined || options.has(values[i])) throw new Error('Invalid packaging arguments.');
    options.set(values[i], values[i + 1]);
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, ...values] = process.argv.slice(2), options = argumentsFor(values);
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    let result;
    if (command === 'info') result = buildInfo(root, options.get('--build-number'));
    else if (command === 'validate-payload' && options.has('--directory')) result = { files: validatePayload(options.get('--directory')).length };
    else if (command === 'stage-installer' && options.has('--setup') && options.has('--directory') && options.has('--build-number')) result = stageInstaller(options.get('--setup'), options.get('--directory'), options.get('--build-number'));
    else if (command === 'stage-velopack' && ['--source', '--guard', '--directory', '--build-number'].every(key => options.has(key))) result = stageVelopack(options.get('--source'), options.get('--guard'), options.get('--directory'), options.get('--build-number'));
    else throw new Error('Expected info, validate-payload, stage-installer, or stage-velopack with required arguments.');
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
