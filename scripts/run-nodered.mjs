// Dev helper: launch a local Node-RED for testing the control plane.
// Uses the node-red installed at the repo root; falls back to a docker container.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const redJs = join(root, 'node_modules', 'node-red', 'red.js');
const userDir = join(root, '.nodered-test', 'userdir');

if (existsSync(redJs)) {
  console.log('[nodered] starting via', redJs);
  spawn(process.execPath, [redJs, '-u', userDir, '-p', '1880'], { stdio: 'inherit' });
} else {
  console.log('[nodered] node-red not installed locally; trying docker');
  spawn('docker', ['run', '--rm', '-p', '1880:1880', 'nodered/node-red:latest'], { stdio: 'inherit' });
}
