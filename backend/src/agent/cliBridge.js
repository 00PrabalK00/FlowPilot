// Delegate a chat turn to the user's local Claude Code CLI (via the connector).
// Claude Code runs its own loop and controls Node-RED through the flowpilot MCP tools;
// each of its tool calls hits /api/tool and shows up in the live action stream.
import { EventType, makeEvent } from '@flowpilot/shared/events';
import { invokeConnector } from '../connectorHub.js';
import { publish } from '../eventBus.js';
import { Runs, audit } from '../store.js';
import { getProviderConfig } from '../secretStore.js';

export async function runCliChat({ workspaceId, prompt, cli = 'claude-code' }) {
  const runId = Runs.create(workspaceId, prompt);
  const emit = (e) => publish(workspaceId, { runId, ...e });

  emit(makeEvent(EventType.AGENT_STARTED, { prompt, provider: cli }));
  audit(workspaceId, 'cli-brain', 'run.start', { runId, cli, prompt: prompt.slice(0, 200) });

  try {
    // long timeout: the CLI may take a while + call several tools
    const model = getProviderConfig(cli).model || undefined; // user-chosen model for this CLI
    const res = await invokeConnector(workspaceId, 'agent.run_cli', { cli, prompt, model }, 290000);
    const text = res?.text || '(no response)';
    emit(makeEvent(EventType.AGENT_MESSAGE, { text }));
    emit(makeEvent(EventType.AGENT_DONE, { text }));
    Runs.finish(runId, res?.ok === false ? 'error' : 'done', { text });
    return { runId, status: 'done', text };
  } catch (e) {
    emit(makeEvent(EventType.AGENT_ERROR, { error: e.message }));
    Runs.finish(runId, 'error', { error: e.message });
    return { runId, status: 'error', error: e.message };
  }
}
