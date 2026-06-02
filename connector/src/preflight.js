// Security preflight (Threat 3 + Threat 5). Read-only posture check before control is allowed.

const DANGEROUS_TYPES = [
  'exec', 'file', 'file in', 'tcp in', 'tcp out', 'tcp request',
  'udp in', 'udp out', 'http request', 'websocket in', 'websocket out',
  'template', 'function'
];

export async function securityPreflight(nr) {
  const findings = [];
  let settings = null, nodes = null;
  try { settings = await nr.getSettings(); } catch (e) { findings.push(warn('settings_unreadable', `GET /settings failed: ${e.status || e.message}`)); }
  try { nodes = await nr.getNodes(); } catch (e) { findings.push(warn('nodes_unreadable', `GET /nodes failed: ${e.status || e.message}`)); }

  const remote = !/^https?:\/\/(127\.0\.0\.1|localhost)/.test(nr.baseUrl);
  const https = nr.baseUrl.startsWith('https');

  if (settings) {
    // No token required + reachable admin API => editor likely unsecured.
    if (!nr.token && !settings.user) {
      findings.push(crit('admin_unsecured', 'Admin API reachable without auth. Anyone with network access can deploy. Configure adminAuth.'));
    }
    if (!settings.context && settings.flowEncryptionType === 'system') {
      findings.push(warn('no_credential_secret', 'credentialSecret not set; credentials encrypted with system-generated key (lost on key change).'));
    }
  }
  if (remote && !https) findings.push(crit('remote_no_https', 'Remote Node-RED served over HTTP. Use HTTPS.'));

  const dangerous = [];
  if (Array.isArray(nodes)) {
    for (const mod of nodes) {
      for (const t of mod.types || []) {
        if (DANGEROUS_TYPES.includes(t)) dangerous.push(t);
      }
    }
  }
  if (dangerous.length) findings.push(warn('dangerous_nodes_available', `High-risk node types installed: ${[...new Set(dangerous)].join(', ')}`));

  const score = findings.some(f => f.severity === 'critical') ? 'critical'
    : findings.some(f => f.severity === 'warn') ? 'warn' : 'ok';

  return { posture: score, remote, https, hasToken: !!nr.token, findings };
}

const crit = (id, message) => ({ id, severity: 'critical', message });
const warn = (id, message) => ({ id, severity: 'warn', message });
