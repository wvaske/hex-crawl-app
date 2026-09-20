import React from 'react';
import type { Character, PluginManifest, PluginPanelMeta } from '@hexcrawl/shared';
import { useSession } from '../stores/session.js';
import { onPluginChanged } from './events.js';

/**
 * The client half of the plugin contract — import it as
 * `@hexcrawl/client/plugin-api`. Authoring guide: plugins/AGENTS.md.
 *
 * A client plugin contributes PANELS to the right-hand rail (the bottom tab
 * bar on phones). The shell owns the chrome — rail button, title bar, pin,
 * close, scrolling, resize — and the plugin renders the body. Panels talk to
 * their server half through `callPluginAction` / `usePluginQuery`; campaign
 * state (characters, clock, role) comes from the same snapshot the rest of
 * the app reads, via `useViewer` and `useSession`.
 */

export interface PluginPanelProps {
  campaignId: string;
  pluginId: string;
}

export interface ClientPluginPanel {
  /** Must match a `panels[].id` in the manifest, which carries icon/label/title. */
  id: string;
  component: React.ComponentType<PluginPanelProps>;
}

export interface ClientPlugin {
  manifest: PluginManifest;
  panels: ClientPluginPanel[];
}

export function defineClientPlugin(plugin: ClientPlugin): ClientPlugin {
  for (const panel of plugin.panels) {
    if (!plugin.manifest.panels?.some((m: PluginPanelMeta) => m.id === panel.id)) {
      throw new Error(`Plugin ${plugin.manifest.id}: panel "${panel.id}" is not declared in the manifest`);
    }
  }
  return plugin;
}

/** Call a server action. Rejects with the server's error message. */
export async function callPluginAction<T = unknown>(
  campaignId: string,
  pluginId: string,
  action: string,
  input?: unknown,
): Promise<T> {
  const res = await fetch(`/api/campaigns/${campaignId}/plugins/${pluginId}/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input ?? {}),
  });
  const body = (await res.json().catch(() => ({}))) as { result?: T; error?: string };
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body.result as T;
}

export interface PluginQuery<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  reload(): void;
}

/**
 * Load an action's result and keep it fresh: refetches when `input` changes
 * and whenever the server half calls `ctx.notify()` (optionally only for
 * matching `topics`). This is a plugin panel's equivalent of the snapshot.
 */
export function usePluginQuery<T = unknown>(
  props: PluginPanelProps,
  action: string,
  input?: unknown,
  opts: { topics?: string[] } = {},
): PluginQuery<T> {
  const { campaignId, pluginId } = props;
  const inputKey = JSON.stringify(input ?? {});
  const topicsKey = (opts.topics ?? []).join('\n');
  const [state, setState] = React.useState<{ data: T | undefined; error: string | null; loading: boolean }>({
    data: undefined,
    error: null,
    loading: true,
  });
  const [tick, setTick] = React.useState(0);
  const reload = React.useCallback(() => setTick((t) => t + 1), []);

  React.useEffect(() => {
    let stale = false;
    setState((s) => ({ ...s, loading: true }));
    callPluginAction<T>(campaignId, pluginId, action, JSON.parse(inputKey))
      .then((data) => !stale && setState({ data, error: null, loading: false }))
      .catch(
        (err: unknown) =>
          !stale &&
          setState((s) => ({
            data: s.data,
            error: err instanceof Error ? err.message : 'Request failed',
            loading: false,
          })),
      );
    return () => {
      stale = true;
    };
  }, [campaignId, pluginId, action, inputKey, tick]);

  React.useEffect(() => {
    const topics = topicsKey ? topicsKey.split('\n') : [];
    return onPluginChanged(pluginId, (topic) => {
      if (topics.length === 0 || topics.includes(topic)) reload();
    });
  }, [pluginId, topicsKey, reload]);

  return { ...state, reload };
}

/**
 * Run a mutating action with busy/error state, toasting failures. Returns the
 * result, or undefined when the call failed (the error is already on screen).
 */
export function usePluginAction(props: PluginPanelProps): {
  busy: boolean;
  error: string | null;
  run<T = unknown>(action: string, input?: unknown): Promise<T | undefined>;
} {
  const { campaignId, pluginId } = props;
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const run = React.useCallback(
    async <T,>(action: string, input?: unknown): Promise<T | undefined> => {
      setBusy(true);
      setError(null);
      try {
        return await callPluginAction<T>(campaignId, pluginId, action, input);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Request failed';
        setError(message);
        useSession.getState().pushToast({ kind: 'error', title: 'Plugin', text: message });
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [campaignId, pluginId],
  );
  return { busy, error, run };
}

export interface Viewer {
  seatId: string | null;
  isDm: boolean;
  /** The character this browser's seat has claimed. */
  character: Character | null;
  characters: Character[];
}

/** Who is looking, from the live snapshot. */
export function useViewer(): Viewer {
  const seatId = useSession((s) => s.seatId);
  const role = useSession((s) => s.role);
  const state = useSession((s) => s.state);
  return React.useMemo(() => {
    const characters = state?.characters ?? [];
    const characterId = state?.seats.find((s) => s.id === seatId)?.characterId ?? null;
    return {
      seatId,
      isDm: role === 'dm',
      character: characters.find((c) => c.id === characterId) ?? null,
      characters,
    };
  }, [seatId, role, state]);
}

export function toast(title: string, text: string, kind: 'info' | 'error' | 'discovery' = 'info'): void {
  useSession.getState().pushToast({ kind, title, text });
}

// The app's own building blocks, so a plugin panel looks native.
export { useSession } from '../stores/session.js';
export {
  Button,
  Dialog,
  EmptyNote,
  Field,
  Input,
  Label,
  Lbl,
  Section,
  Select,
  TextArea,
  Toggle,
  cx,
} from '../ui/kit.js';
export type { PluginManifest } from '@hexcrawl/shared';
