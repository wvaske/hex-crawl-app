import { useEffect, useRef, useCallback } from 'react';
import { useSessionStore } from '../stores/useSessionStore';
import type { ClientMessage, ServerMessage } from '@hex-crawl/shared';

const INITIAL_DELAY = 1000;
const MAX_DELAY = 30000;
const BACKOFF_MULTIPLIER = 2;

/**
 * Manages WebSocket lifecycle for a campaign session.
 *
 * - Connects to /ws?campaignId=X with automatic cookie-based auth
 * - Dispatches incoming ServerMessages to useSessionStore
 * - Reconnects with exponential backoff + jitter (1s initial, 30s max, 75-125%)
 * - Exposes sendMessage on the session store for outbound messages
 * - Cleans up on campaignId change or unmount
 */
export function useWebSocket(campaignId: string | null) {
  const wsRef = useRef<WebSocket | null>(null);
  const retryCountRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dispatch = useSessionStore((s) => s.dispatch);
  const setConnectionStatus = useSessionStore((s) => s.setConnectionStatus);
  const setSendMessage = useSessionStore((s) => s.setSendMessage);
  const reset = useSessionStore((s) => s.reset);

  const connect = useCallback(() => {
    if (!campaignId) return;

    setConnectionStatus('connecting');

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(
      `${protocol}//${window.location.host}/ws?campaignId=${campaignId}`
    );

    ws.onopen = () => {
      retryCountRef.current = 0;
      setConnectionStatus('connected');

      // Expose sendMessage on the store for outbound messages
      const send = (msg: ClientMessage) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(msg));
        }
      };
      setSendMessage(send);
    };

    ws.onmessage = (event: MessageEvent) => {
      try {
        const message = JSON.parse(event.data as string) as ServerMessage;
        dispatch(message);
      } catch {
        console.warn('[WS] Failed to parse message:', event.data);
      }
    };

    ws.onerror = (event) => {
      console.warn('[WS] Error:', event);
    };

    ws.onclose = () => {
      // Clear sendMessage since the socket is closed
      setSendMessage(null);
      setConnectionStatus('reconnecting');

      // Exponential backoff with jitter (75-125% of computed delay)
      const delay = Math.min(
        INITIAL_DELAY * BACKOFF_MULTIPLIER ** retryCountRef.current,
        MAX_DELAY
      );
      const jitteredDelay = delay * (0.75 + Math.random() * 0.5);
      retryCountRef.current++;

      reconnectTimerRef.current = setTimeout(connect, jitteredDelay);
    };

    wsRef.current = ws;
  }, [campaignId, dispatch, setConnectionStatus, setSendMessage]);

  useEffect(() => {
    connect();

    return () => {
      // Cleanup: close existing ws, clear reconnect timer, reset store
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.onclose = null; // Prevent reconnect on intentional close
        wsRef.current.close();
        wsRef.current = null;
      }
      reset();
    };
  }, [connect, reset]);

  return wsRef;
}
