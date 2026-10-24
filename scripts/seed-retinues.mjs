#!/usr/bin/env node
/**
 * Place the faction retinues on a campaign map (retinue markers).
 *
 * Reads scripts/retinues.json (roster from the wiki) and upserts, through the
 * integration API: the retinue definitions (colour, crest, speed) and one NPC
 * token per member, standing on the content item its posting names and, where
 * the wiki says "in transit", carrying a planned route that walks as the
 * campaign clock runs. Idempotent: tokens are matched by label, so re-running
 * after editing the roster updates in place.
 *
 * Usage:
 *   node scripts/seed-retinues.mjs --base https://hex.example --campaign <id> \
 *        --secret <dm key> --map "<map name or id>" [--roster scripts/retinues.json] \
 *        [--hours-per-day 8] [--dry-run]
 *
 * The DM key is the campaign's DM invite secret (Setup → Invite links); it is
 * the Bearer token for /api/integration. Dependency-free (Node 22+).
 */
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? 'true' : all[i + 1]]);
    return acc;
  }, []),
);
const need = (k) => {
  if (!args[k]) {
    console.error(`Missing --${k}`);
    process.exit(2);
  }
  return args[k];
};
const base = need('base').replace(/\/$/, '');
const campaign = need('campaign');
const secret = need('secret');
const mapArg = need('map');
const rosterPath = args.roster ?? path.join(path.dirname(new URL(import.meta.url).pathname), 'retinues.json');
const hoursPerDay = Number(args['hours-per-day'] ?? 8);
const dryRun = args['dry-run'] === 'true';

const roster = JSON.parse(fs.readFileSync(rosterPath, 'utf8'));
const headers = { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' };
const api = async (method, p, body) => {
  const res = await fetch(`${base}/api/integration/campaigns/${campaign}${p}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${p} → ${res.status} ${json.error ?? ''}`);
  return json;
};

const { maps } = await api('GET', '/maps');
const map = maps.find((m) => m.id === mapArg || m.name.toLowerCase() === mapArg.toLowerCase());
if (!map) {
  console.error(`No map "${mapArg}". Maps: ${maps.map((m) => `${m.name} (${m.id})`).join(', ')}`);
  process.exit(1);
}
const { content } = await api('GET', `/maps/${map.id}/content`);
const titles = new Map(content.map((c) => [c.title.toLowerCase(), c]));
const findPlace = (names) => {
  for (const n of names) {
    const hit = titles.get(n.toLowerCase());
    if (hit) return { title: hit.title, fallback: n !== names[0] && n === names[names.length - 1] && names.length > 1 };
  }
  return null;
};

console.log(`Map: ${map.name} (${map.id}), ${map.milesPerHex} miles/hex, ${content.length} content items`);
if (!dryRun) await api('POST', '/retinues', { retinues: roster.retinues });
console.log(`Retinues: ${roster.retinues.map((r) => r.name).join(', ')}`);

const problems = [];
for (const m of roster.members) {
  const place = findPlace(m.at);
  if (!place) {
    problems.push(`${m.label}: none of ${m.at.join(' / ')} is on the map — skipped`);
    continue;
  }
  let note = m.note;
  if (place.fallback) note += ` [place by hand: ${m.at[0]}]`;
  const body = {
    mapId: map.id,
    label: m.label,
    at: place.title,
    retinueId: m.retinueId,
    note,
    playerVisible: m.playerVisible ?? true,
    visibleThroughFog: true,
  };
  let routeTo = null;
  if (m.routeTo) {
    const dests = m.routeTo.map((n) => findPlace([n]));
    if (dests.some((d) => !d)) {
      problems.push(`${m.label}: route destination ${m.routeTo.join(' → ')} not on the map — placed without a route`);
    } else {
      routeTo = dests.map((d) => d.title);
      body.routeTo = routeTo;
    }
  }
  if (dryRun) {
    console.log(`  (dry) ${m.label} @ ${place.title}${routeTo ? ` → ${routeTo.join(' → ')}` : ''}`);
    continue;
  }
  const res = await api('POST', '/tokens', body);
  let extra = '';
  if (routeTo && m.arriveInDays && res.routeHexes > 0) {
    // Scale this member's speed so the walk takes about `arriveInDays` travel days.
    const miles = res.routeHexes * map.milesPerHex;
    const mph = Math.max(0.1, Math.round((miles / (m.arriveInDays * hoursPerDay)) * 10) / 10);
    await api('POST', '/tokens', { mapId: map.id, label: m.label, mph });
    extra = ` · ${res.routeHexes} hexes, ${mph} mph ≈ ${m.arriveInDays} days`;
  }
  console.log(`  ${res.updated ? 'updated' : 'placed '} ${m.label} @ ${place.title} (${res.q},${res.r})${routeTo ? ` → ${routeTo.join(' → ')}` : ''}${extra}`);
}
if (problems.length) {
  console.log('\nNeeds a hand:');
  for (const p of problems) console.log(`  - ${p}`);
}
