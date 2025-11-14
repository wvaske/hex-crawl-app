<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import HexMap from '$components/HexMap.svelte';
  import { client, Queries } from '$graphql/client';
  import type { MapDetail } from '$graphql/types';
  import { subscribeToMap } from '$realtime/socket';
  import type { Channel } from 'phoenix';
  import { page } from '$app/stores';
  import { get } from 'svelte/store';

  let mapDetail: MapDetail | null = null;
  let channel: Channel | null = null;

  async function load(mapId: string) {
    const data = await client.request<{ map: MapDetail }>(Queries.MapDetail, { id: mapId });
    mapDetail = data.map;
  }

  onMount(async () => {
    const { params } = get(page);
    const mapId = params.token;
    await load(mapId);
    channel = subscribeToMap(mapId, {
      onPlayerMoved: ({ coords }) => {
        if (!mapDetail) return;
        mapDetail = { ...mapDetail, current_player_hex: coords };
      },
      onHexReveal: ({ hexes }) => {
        if (!mapDetail) return;
        const merged = [...mapDetail.explored_hexes];
        for (const hex of hexes) {
          if (!merged.find((h) => h.q === hex.q && h.r === hex.r)) {
            merged.push(hex);
          }
        }
        mapDetail = { ...mapDetail, explored_hexes: merged };
      }
    });
  });

  onDestroy(() => {
    channel?.leave();
  });
</script>

{#if mapDetail}
  <h2>{mapDetail.campaign.name}: {mapDetail.name}</h2>
  <HexMap mapDetail={mapDetail} interactive={false} />
{:else}
  <p>Loading map…</p>
{/if}

<style>
  h2 {
    margin-bottom: 1rem;
  }
</style>
