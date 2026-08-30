import type { ClientCommand, CommandInput, ServerMessage } from '@hexcrawl/shared';
import { ServerMessageSchema, withDirection } from '@hexcrawl/shared';
import { useSession } from './stores/session.js';

let socket: WebSocket | null = null;
let campaignId: string | null = null;
let reconnectAttempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let commandCounter = 1;
let intentionallyClosed = false;
const queue: string[] = [];

export function connectWs(id: string): void {
  campaignId = id;
  intentionallyClosed = false;
  open();
}

export function disconnectWs(): void {
  intentionallyClosed = true;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  socket?.close();
  socket = null;
}

function open(): void {
  if (!campaignId) return;
  useSession.getState().setStatus('connecting');
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws?campaign=${campaignId}`);
  socket = ws;

  ws.onopen = () => {
    reconnectAttempt = 0;
    useSession.getState().setStatus('open');
    while (queue.length) ws.send(queue.shift()!);
  };

  ws.onmessage = (event) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(String(event.data));
    } catch {
      return;
    }
    const result = ServerMessageSchema.safeParse(parsed);
    if (!result.success) {
      console.warn('Unrecognized server message', result.error, parsed);
      return;
    }
    handleMessage(result.data);
  };

  ws.onclose = () => {
    if (socket !== ws) return;
    socket = null;
    useSession.getState().setStatus('closed');
    if (!intentionallyClosed) scheduleReconnect();
  };
  ws.onerror = () => ws.close();
}

function scheduleReconnect(): void {
  const delay = Math.min(500 * 2 ** reconnectAttempt, 8000) + Math.random() * 400;
  reconnectAttempt++;
  reconnectTimer = setTimeout(open, delay);
}

function handleMessage(msg: ServerMessage): void {
  const session = useSession.getState();
  switch (msg.type) {
    case 'snapshot':
      session.applySnapshot(msg.seatId, msg.role, msg.state);
      break;
    case 'ack':
      break;
    case 'error':
      session.pushToast({ kind: 'error', title: 'Rejected', text: msg.message });
      break;
    case 'presence':
      break;
    case 'event':
      if (msg.kind === 'discovery.new') {
        const mine = msg.discovery.characterId === currentCharacterId();
        session.pushToast({
          kind: 'discovery',
          title: mine ? 'You notice something…' : `${msg.characterName} noticed something`,
          text: withDirection(msg.clueText, msg.discovery.direction),
        });
      } else if (msg.kind === 'log.appended' && msg.entry.kind === 'narration') {
        session.pushToast({ kind: 'narration', title: 'The DM narrates', text: msg.entry.text });
      } else if (msg.kind === 'move.requested') {
        session.pushToast({
          kind: 'info',
          title: 'Move requested',
          text: `${msg.label} wants to travel to hex ${msg.q}, ${msg.r} — approve in the panel above the map.`,
        });
      } else if (msg.kind === 'move.resolved') {
        session.pushToast({
          kind: msg.approved ? 'info' : 'error',
          title: msg.approved ? 'Move approved' : 'Move denied',
          text: `${msg.label}'s travel was ${msg.approved ? 'approved by' : 'held by'} the DM.`,
        });
      }
      break;
  }
}

function currentCharacterId(): string | null {
  const s = useSession.getState();
  return s.state?.seats.find((seat) => seat.id === s.seatId)?.characterId ?? null;
}

if (import.meta.env.DEV) {
  (window as unknown as { __send: typeof send }).__send = (cmd) => send(cmd);
}

/** Fire a command at the server. Queued while disconnected. */
export function send(cmd: CommandInput): void {
  const withId = { ...cmd, id: `cmd-${commandCounter++}` } as ClientCommand;
  const payload = JSON.stringify(withId);
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(payload);
  } else {
    queue.push(payload);
  }
}
