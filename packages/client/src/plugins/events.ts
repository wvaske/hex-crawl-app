/**
 * `plugin.changed` fan-out: `ws.ts` publishes, `usePluginQuery` subscribes.
 * Kept apart from `api.tsx` so the socket layer does not import React code.
 */
type Listener = (topic: string) => void;

const listeners = new Map<string, Set<Listener>>();

export function onPluginChanged(pluginId: string, listener: Listener): () => void {
  let set = listeners.get(pluginId);
  if (!set) {
    set = new Set();
    listeners.set(pluginId, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
  };
}

export function emitPluginChanged(pluginId: string, topic: string): void {
  for (const listener of listeners.get(pluginId) ?? []) listener(topic);
}
