#!/usr/bin/env node
/**
 * Step 0 for the D&D Beyond game-log import (issue #146): connect to the
 * (unofficial) game-log feed with a DM's CobaltSession cookie and record the
 * raw events, so the message shape and token lifetime are pinned against a
 * real campaign before anything is built on them.
 *
 * Usage:
 *   COBALT='<CobaltSession cookie value>' node scripts/ddb-gamelog-capture.mjs [campaignId] [minutes]
 *
 * With no campaignId it lists the account's active campaigns and exits.
 * Events go to stdout and to ddb-gamelog-capture-<campaignId>.jsonl in the
 * current directory. Dependency-free (Node 22+: global fetch + WebSocket).
 *
 * Get the cookie from a logged-in dndbeyond.com tab: DevTools → Application →
 * Cookies → CobaltSession. It is a session credential — never paste it into
 * a chat or a ticket, and delete the capture file when done.
 */
import fs from 'node:fs';

const AUTH_URL = 'https://auth-service.dndbeyond.com/v1/cobalt-token';
const CAMPAIGNS_URL = 'https://www.dndbeyond.com/api/campaign/stt/active-campaigns';
const GAMELOG_WS = 'wss://game-log-api-live.dndbeyond.com/v1';

const cobalt = process.env.COBALT;
if (!cobalt) {
  console.error('Set COBALT to your CobaltSession cookie value.');
  process.exit(2);
}
const campaignId = process.argv[2];
const minutes = Number(process.argv[3] ?? 30);

async function mintToken() {
  const res = await fetch(AUTH_URL, {
    method: 'POST',
    headers: { Cookie: `CobaltSession=${cobalt}`, 'User-Agent': 'Mozilla/5.0 (HexCrawl capture)' },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`cobalt-token ${res.status}: ${text.slice(0, 200)}`);
  const body = JSON.parse(text);
  const token = body.token;
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  return { token, ttl: body.ttl, payload };
}

async function listCampaigns(token) {
  const res = await fetch(CAMPAIGNS_URL, {
    headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'Mozilla/5.0 (HexCrawl capture)' },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`active-campaigns ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

const { token, ttl, payload } = await mintToken();
const userId = payload.sub ?? payload.userId ?? payload.id;
console.error(`token ok (ttl ${ttl}s), user ${userId} (${payload.displayName ?? payload.name ?? '?'})`);
const campaigns = await listCampaigns(token);
console.error('active campaigns:', JSON.stringify(campaigns, null, 2));
if (!campaignId) process.exit(0);

const out = fs.createWriteStream(`ddb-gamelog-capture-${campaignId}.jsonl`, { flags: 'a' });
const url = `${GAMELOG_WS}?gameId=${encodeURIComponent(campaignId)}&userId=${encodeURIComponent(userId)}&stt=${encodeURIComponent(token)}`;
console.error(`connecting to ${url.replace(/stt=[^&]+/, 'stt=…')} for ${minutes} min`);
const ws = new WebSocket(url);
ws.addEventListener('open', () => console.error('open — roll something on D&D Beyond now'));
ws.addEventListener('message', (ev) => {
  const line = typeof ev.data === 'string' ? ev.data : String(ev.data);
  console.log(line);
  out.write(line + '\n');
});
ws.addEventListener('close', (ev) => {
  console.error(`closed ${ev.code} ${ev.reason}`);
  process.exit(0);
});
ws.addEventListener('error', (ev) => console.error('error', ev.message ?? ev));
setTimeout(() => {
  console.error('time is up');
  ws.close();
}, minutes * 60_000);
