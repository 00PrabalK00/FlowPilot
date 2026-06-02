// In-memory pub/sub for live event stream -> frontend (SSE/WS). Per workspace.
import { EventEmitter } from 'node:events';

const emitter = new EventEmitter();
emitter.setMaxListeners(0);

export function publish(workspaceId, event) {
  emitter.emit(workspaceId, event);
  emitter.emit('*', { workspaceId, ...event });
}

export function subscribe(workspaceId, handler) {
  emitter.on(workspaceId, handler);
  return () => emitter.off(workspaceId, handler);
}
