import { writable } from 'svelte/store';
import { client, Queries } from '$graphql/client';
import type { CampaignSummary, MapDetail } from '$graphql/types';

export const campaigns = writable<CampaignSummary[]>([]);

export async function loadCampaignSummaries(): Promise<CampaignSummary[]> {
  const data = await client.request<{ campaigns: CampaignSummary[] }>(Queries.CampaignSummaries);
  campaigns.set(data.campaigns);
  return data.campaigns;
}

export async function loadMap(mapId: string): Promise<MapDetail> {
  const data = await client.request<{ map: MapDetail }>(Queries.MapDetail, { id: mapId });
  return data.map;
}
