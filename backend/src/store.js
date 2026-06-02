// Persistence helpers over db.js. Every deploy creates a snapshot + approval + audit (section 8).
import { randomUUID } from 'node:crypto';
import { db, audit } from './db.js';

export { audit };

const now = () => Date.now();

export const Snapshots = {
  create(workspaceId, flows, rev, reason) {
    const id = 'snap_' + randomUUID().slice(0, 8);
    db.prepare('INSERT INTO flow_snapshots (id,workspace_id,created_at,rev,flows,reason) VALUES (?,?,?,?,?,?)')
      .run(id, workspaceId, now(), rev || null, JSON.stringify(flows), reason || null);
    return id;
  },
  get(id) {
    const r = db.prepare('SELECT * FROM flow_snapshots WHERE id=?').get(id);
    if (!r) return null;
    return { ...r, flows: JSON.parse(r.flows) };
  },
  list(workspaceId) {
    return db.prepare('SELECT id,created_at,rev,reason FROM flow_snapshots WHERE workspace_id=? ORDER BY created_at DESC LIMIT 50').all(workspaceId);
  }
};

export const Drafts = {
  create(workspaceId, { name, intent, riskLevel, flow }) {
    const id = 'draft_' + randomUUID().slice(0, 8);
    db.prepare('INSERT INTO flow_drafts (id,workspace_id,created_at,name,intent,risk_level,flow) VALUES (?,?,?,?,?,?,?)')
      .run(id, workspaceId, now(), name || null, intent || null, riskLevel || 'low', JSON.stringify(flow));
    return id;
  },
  get(id) {
    const r = db.prepare('SELECT * FROM flow_drafts WHERE id=?').get(id);
    if (!r) return null;
    return { ...r, flow: JSON.parse(r.flow), validation: r.validation ? JSON.parse(r.validation) : null };
  },
  setValidation(id, validation) {
    db.prepare('UPDATE flow_drafts SET validation=? WHERE id=?').run(JSON.stringify(validation), id);
  },
  setStatus(id, status) {
    db.prepare('UPDATE flow_drafts SET status=? WHERE id=?').run(status, id);
  }
};

export const Runs = {
  create(workspaceId, prompt) {
    const id = 'run_' + randomUUID().slice(0, 8);
    db.prepare('INSERT INTO agent_runs (id,workspace_id,created_at,prompt,status) VALUES (?,?,?,?,?)')
      .run(id, workspaceId, now(), prompt, 'running');
    return id;
  },
  finish(id, status, result) {
    db.prepare('UPDATE agent_runs SET status=?, result=? WHERE id=?').run(status, JSON.stringify(result ?? null), id);
  }
};

export const ToolCalls = {
  record(runId, workspaceId, tool, params, ok, result, error) {
    const id = 'tc_' + randomUUID().slice(0, 8);
    db.prepare('INSERT INTO tool_calls (id,run_id,workspace_id,created_at,tool,params,ok,result,error) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(id, runId, workspaceId, now(), tool, JSON.stringify(params ?? null), ok ? 1 : 0,
        JSON.stringify(result ?? null), error || null);
    return id;
  }
};

export const FileChanges = {
  record(workspaceId, path, tool) {
    // collapse repeats of the same path (keep latest)
    db.prepare('DELETE FROM file_changes WHERE workspace_id=? AND path=? AND reverted=0').run(workspaceId, path);
    db.prepare('INSERT INTO file_changes (workspace_id,created_at,path,tool) VALUES (?,?,?,?)')
      .run(workspaceId, now(), path, tool || null);
  },
  list(workspaceId) {
    return db.prepare('SELECT id,created_at,path,tool,reverted FROM file_changes WHERE workspace_id=? ORDER BY created_at DESC LIMIT 100').all(workspaceId);
  },
  markReverted(workspaceId, path) {
    db.prepare('UPDATE file_changes SET reverted=1 WHERE workspace_id=? AND path=?').run(workspaceId, path);
  }
};

export const Approvals = {
  create(runId, workspaceId, tool, params, riskLevel) {
    const id = 'appr_' + randomUUID().slice(0, 8);
    db.prepare('INSERT INTO approvals (id,run_id,workspace_id,created_at,tool,params,risk_level) VALUES (?,?,?,?,?,?,?)')
      .run(id, runId, workspaceId, now(), tool, JSON.stringify(params ?? null), riskLevel);
    return id;
  },
  get(id) {
    const r = db.prepare('SELECT * FROM approvals WHERE id=?').get(id);
    if (!r) return null;
    return { ...r, params: JSON.parse(r.params) };
  },
  decide(id, status, by) {
    db.prepare('UPDATE approvals SET status=?, decided_at=?, decided_by=? WHERE id=?').run(status, now(), by || 'user', id);
  },
  listPending(workspaceId) {
    return db.prepare("SELECT * FROM approvals WHERE workspace_id=? AND status='pending' ORDER BY created_at").all(workspaceId);
  }
};
