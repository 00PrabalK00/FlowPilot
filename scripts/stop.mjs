// Kill everything FlowPilot started.
// Primary: any node process whose command line contains "flowpilot"
//   - backend/connector are tagged with a "flowpilot-*" argv marker
//   - vite / node-red / concurrently run from the ...\FlowPlot\... path
// Backstop: free the known ports (1880 Node-RED, 8787 backend, 5173 frontend).
import { execSync } from 'node:child_process';

const PORTS = [1880, 8787, 5173];
const isWin = process.platform === 'win32';
const killed = new Set();

function kill(pid) {
  pid = String(pid || '').trim();
  if (!pid || pid === '0' || killed.has(pid)) return;
  try { execSync(isWin ? `taskkill /F /T /PID ${pid}` : `kill -9 ${pid}`, { stdio: 'ignore' }); killed.add(pid); }
  catch {}
}

// 1. command-line match
try {
  if (isWin) {
    const ps = "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'flowpilot' } | ForEach-Object { $_.ProcessId }";
    execSync(`powershell -NoProfile -Command "${ps}"`, { encoding: 'utf8' }).split('\n').forEach(kill);
  } else {
    execSync("pgrep -fi flowpilot", { encoding: 'utf8' }).split('\n').forEach(kill);
  }
} catch {}

// 2. port backstop
for (const port of PORTS) {
  try {
    if (isWin) {
      const out = execSync(`powershell -NoProfile -Command "(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue).OwningProcess"`, { encoding: 'utf8' });
      out.split('\n').forEach(kill);
    } else {
      execSync(`lsof -ti tcp:${port}`, { encoding: 'utf8' }).split('\n').forEach(kill);
    }
  } catch {}
}

console.log(killed.size ? `[stop] killed ${killed.size} process(es): ${[...killed].join(', ')}` : '[stop] nothing running');
