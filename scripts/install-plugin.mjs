// Install the FlowPilot sidebar plugin into a Node-RED userDir.
// Default userDir: $NODE_RED_USERDIR or ~/.node-red. Override with arg: node scripts/install-plugin.mjs <userDir>
import { execSync } from 'node:child_process';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const plugin = join(root, 'nodered-plugin');
const userDir = process.argv[2] || process.env.NODE_RED_USERDIR || join(homedir(), '.node-red');

mkdirSync(userDir, { recursive: true });
// Ensure a package.json HERE so npm installs into userDir (not an ancestor workspace) + with workspaces off.
const pkgPath = join(userDir, 'package.json');
if (!existsSync(pkgPath)) {
  writeFileSync(pkgPath, JSON.stringify({ name: 'node-red-project', version: '0.0.1', private: true }, null, 2));
}
console.log(`Installing FlowPilot sidebar into ${userDir} ...`);
// shell:true so npm.cmd resolves on Windows; --workspaces=false stops npm climbing to a parent workspace.
execSync(`npm install --workspaces=false "${plugin}"`, { cwd: userDir, stdio: 'inherit', shell: true });
console.log('\n✓ Installed. Restart Node-RED, then look for the "FlowPilot" tab (paper-plane icon) in the right sidebar.');
console.log('  The tab embeds http://localhost:5173 — make sure `npm run dev` is running.');
