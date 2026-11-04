// Builds the installer from release/ and silently installs it, replacing any installed version.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const iscc = [
  path.join(process.env.LOCALAPPDATA ?? '', 'Programs/Inno Setup 6/ISCC.exe'),
  path.join(process.env['ProgramFiles(x86)'] ?? '', 'Inno Setup 6/ISCC.exe'),
  path.join(process.env.ProgramFiles ?? '', 'Inno Setup 6/ISCC.exe'),
].find(existsSync);
if (!iscc) throw new Error('Inno Setup 6 (ISCC.exe) が見つかりません。');

execFileSync(iscc, ['/Q', `/DAppVersion=${version}`, path.join(root, 'installer/fret-notes.iss')], { stdio: 'inherit' });
const setup = path.join(root, 'release', `Fret Notes Setup ${version}.exe`);
console.log(`Installer: ${setup}`);
if (process.argv.includes('--no-install')) process.exit(0);
execFileSync(setup, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/CLOSEAPPLICATIONS'], { stdio: 'inherit' });
console.log(`Installed: ${path.join(process.env.LOCALAPPDATA ?? '', 'Programs/Fret Notes/Fret Notes.exe')}`);
