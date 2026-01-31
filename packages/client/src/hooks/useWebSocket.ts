import { useEffect, useRef } from 'react';
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
  // Use refs for store actions so the effect only re-runs when campaignId changes
  const dispatchRef = useRef(useSessionStore.getState().dispatch);
  const setConnectionStatusRef = useRef(useSessionStore.getState().setConnectionStatus);
  const setSendMessageRef = useRef(useSessionStore.getState().setSendMessage);
  const setCampaignIdRef = useRef(useSessionStore.getState().setCampaignId);
  const resetRef = useRef(useSessionStore.getState().reset);

  useEffect(() => {
    if (!campaignId) return;

    const dispatch = dispatchRef.current;
    const setConnectionStatus = setConnectionStatusRef.current;
    const setSendMessage = setSendMessageRef.current;
    const setCampaignId = setCampaignIdRef.current;

    // Store campaignId so hooks/components can access it
    setCampaignId(campaignId);

    let cancelled = false;
    let retryCount = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let ws: WebSocket | null = null;

    console.log(`[WS-DIAG] ${Date.now()} status=connecting cancelled=${cancelled}`);
    setConnectionStatus('connecting');

    const connect = () => {
      if (cancelled) {
        console.log(`[WS-DIAG] ${Date.now()} connect() skipped — cancelled`);
        return;
      }

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(
        `${protocol}//${window.location.host}/ws?campaignId=${campaignId}`
      );

      ws.onopen = () => {
        console.log(`[WS-DIAG] ${Date.now()} onopen cancelled=${cancelled} readyState=${ws?.readyState}`);
        if (cancelled) { ws?.close(); return; }
        retryCount = 0;
        setConnectionStatus('connected');

        const currentWs = ws;
        const send = (msg: ClientMessage) => {
          if (currentWs?.readyState === WebSocket.OPEN) {
            currentWs.send(JSON.stringify(msg));
          }
        };
        setSendMessage(send);
      };

      ws.onmessage = (event: MessageEvent) => {
        if (cancelled) return;
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
        console.log(`[WS-DIAG] ${Date.now()} onclose cancelled=${cancelled} readyState=${ws?.readyState}`);
        if (cancelled) return;

        setSendMessage(null);
        setConnectionStatus('reconnecting');

        // Exponential backoff with jitter (75-125% of computed delay)
        const delay = Math.min(
          INITIAL_DELAY * BACKOFF_MULTIPLIER ** retryCount,
          MAX_DELAY
        );
        const jitteredDelay = delay * (0.75 + Math.random() * 0.5);
        retryCount++;

        reconnectTimer = setTimeout(connect, jitteredDelay);
      };
    };

    connect();

    return () => {
      console.log(`[WS-DIAG] ${Date.now()} cleanup — setting cancelled=true`);
      cancelled = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
      resetRef.current();
    };
  }, [campaignId]);
}
