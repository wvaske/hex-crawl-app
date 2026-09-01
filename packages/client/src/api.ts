export interface CampaignInfo {
  campaignId: string;
  name: string;
  description: string;
  keyRole: 'dm' | 'player' | null;
  seat: { id: string; role: 'dm' | 'player'; name: string; characterId: string | null } | null;
  characters: {
    id: string;
    name: string;
    color: string;
    glyph: string;
    claimedBy: string | null;
  }[];
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
}

export async function createCampaign(
  name: string,
  dmName: string,
  createPassword?: string,
): Promise<{ campaignId: string; dmKey: string; playerKey: string }> {
  const res = await fetch('/api/campaigns', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, dmName, createPassword }),
  });
  return jsonOrThrow(res);
}

/**
 * Instance-level policy, probed by the Landing page. `createGated` means the
 * operator set CREATE_PASSWORD and new campaigns need it.
 */
export async function fetchInstanceInfo(): Promise<{ createGated: boolean }> {
  const res = await fetch('/api/instance');
  if (!res.ok) return { createGated: false };
  return (await res.json()) as { createGated: boolean };
}

export interface InviteKeys {
  dmKey: string;
  playerKey: string;
}

/** DM only: the campaign's current invite secrets. */
export async function fetchInviteKeys(campaignId: string): Promise<InviteKeys | null> {
  const res = await fetch(`/api/campaigns/${campaignId}/keys`);
  if (!res.ok) return null;
  return (await res.json()) as InviteKeys;
}

export async function fetchCampaignInfo(campaignId: string, key: string | null): Promise<CampaignInfo> {
  const url = key
    ? `/api/campaigns/${campaignId}?key=${encodeURIComponent(key)}`
    : `/api/campaigns/${campaignId}`;
  return jsonOrThrow(await fetch(url));
}

export async function joinCampaign(
  campaignId: string,
  key: string,
  name: string,
): Promise<{ seatId: string; role: 'dm' | 'player' }> {
  const res = await fetch(`/api/campaigns/${campaignId}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, name }),
  });
  return jsonOrThrow(res);
}

export interface MapThumb {
  mapId: string;
  /** Path of the first visible image layer, or null. */
  image: string | null;
  hexCount: number;
}

/** DM only: per-map summaries for the map manager (maps you aren't viewing). */
export async function fetchMapThumbs(campaignId: string): Promise<MapThumb[]> {
  const body = await jsonOrThrow<{ maps: MapThumb[] }>(
    await fetch(`/api/campaigns/${campaignId}/map-thumbs`),
  );
  return body.maps;
}

export interface WikiPage {
  /** Canonical page title as the wiki resolved it (redirects followed). */
  title: string;
  /** Server-sanitized HTML (scripts/handlers stripped) — see http/wiki.ts. */
  html: string;
}

/**
 * Fetch a wiki page through the server proxy (#66). Any seated member may
 * read; errors come back as JSON, so a missing page or an unreachable wiki
 * surfaces as a thrown Error with a readable message.
 */
export async function fetchWikiPage(campaignId: string, title: string): Promise<WikiPage> {
  return jsonOrThrow<WikiPage>(
    await fetch(
      `/api/campaigns/${campaignId}/wiki-page?title=${encodeURIComponent(title)}`,
    ),
  );
}

export async function uploadMapImage(
  campaignId: string,
  mapId: string,
  file: File,
): Promise<void> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`/api/campaigns/${campaignId}/maps/${mapId}/images`, {
    method: 'POST',
    body: form,
  });
  await jsonOrThrow(res);
}
