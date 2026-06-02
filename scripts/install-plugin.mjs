// Install the FlowPilot sidebar plugin into a Node-RED userDir.
// Default userDir: $NODE_RED_USERDIR or ~/.node-red. Override with arg: node scripts/install-plugin.mjs <userDir>
import { execSync } from 'node:child_process';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const plugin = join(root, 'nodered-plugin');
const userDir = process.argv[2] || process.env.NODE_RED_USERDIR || join(homedir(), '.node-red');

mkdirSync(userDir, { recursive: true });
if (!existsSync(join(userDir, 'package.json'))) {
  execSync('npm init -y', { cwd: userDir, stdio: 'ignore' });
}
console.log(`Installing FlowPilot sidebar into ${userDir} ...`);
execSync(`npm install "${plugin}"`, { cwd: userDir, stdio: 'inherit' });
console.log('\n✓ Installed. Restart Node-RED, then look for the "FlowPilot" tab (paper-plane icon) in the right sidebar.');
console.log('  The tab embeds http://localhost:5173 — make sure `npm run dev` is running.');
