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
): Promise<{ campaignId: string; dmKey: string; playerKey: string }> {
  const res = await fetch('/api/campaigns', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, dmName }),
  });
  return jsonOrThrow(res);
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
