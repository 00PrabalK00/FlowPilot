// Dev helper: launch a local Node-RED for testing the control plane.
// Auto-installs the FlowPilot sidebar plugin into the userDir first, so the
// "FlowPilot" tab is always present — zero manual setup.
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const redJs = join(root, 'node_modules', 'node-red', 'red.js');
const userDir = join(root, '.nodered-test', 'userdir');
const plugin = join(root, 'nodered-plugin');

// auto-install/refresh the sidebar plugin every start (idempotent, keeps it current)
try {
  console.log('[nodered] installing/refreshing FlowPilot sidebar plugin ...');
  execSync(`node "${join(root, 'scripts', 'install-plugin.mjs')}" "${userDir}"`, { stdio: 'inherit' });
} catch (e) {
  console.log('[nodered] plugin auto-install skipped:', e.message);
}

if (existsSync(redJs)) {
  console.log('[nodered] starting via', redJs);
  spawn(process.execPath, [redJs, '-u', userDir, '-p', '1880'], { stdio: 'inherit' });
} else {
  console.log('[nodered] node-red not installed locally; trying docker');
  spawn('docker', ['run', '--rm', '-p', '1880:1880', 'nodered/node-red:latest'], { stdio: 'inherit' });
}
