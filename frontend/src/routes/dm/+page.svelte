<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import HexMap from '$components/HexMap.svelte';
  import { client, Mutations, Queries } from '$graphql/client';
  import type { CampaignSummary, MapDetail, HexCoords, ExplorationEvent } from '$graphql/types';
  import { loadCampaignSummaries } from '$stores/campaigns';
  import { subscribeToMap, subscribeToCampaign } from '$realtime/socket';
  import type { Channel } from 'phoenix';

  let campaigns: CampaignSummary[] = [];
  let selectedCampaign: CampaignSummary | null = null;
  let selectedMap: MapDetail | null = null;
  let history: ExplorationEvent[] = [];
  let mapChannel: Channel | null = null;
  let campaignChannel: Channel | null = null;
  let movementInput: HexCoords = { q: 12, r: 18 };
  let revealInput = '13,18;13,19';
  let statusMessage: string | null = null;

  async function refreshCampaigns() {
    campaigns = await loadCampaignSummaries();
    selectedCampaign = campaigns[0] ?? null;
    if (selectedCampaign && selectedCampaign.maps.length > 0) {
      await loadMap(selectedCampaign.maps[0].id);
      await loadHistory();
      attachRealtime();
    }
  }

  async function loadMap(mapId: string) {
    const data = await client.request<{ map: MapDetail }>(Queries.MapDetail, { id: mapId });
    selectedMap = data.map;
  }

  async function loadHistory(limit = 25) {
    if (!selectedMap) return;
    const data = await client.request<{ explorationHistory: ExplorationEvent[] }>(Queries.ExplorationHistory, {
      mapId: selectedMap.id,
      limit
    });
    history = data.explorationHistory;
  }

  function attachRealtime() {
    detachRealtime();
    if (!selectedMap || !selectedCampaign) return;
    mapChannel = subscribeToMap(selectedMap.id, {
      onPlayerMoved: ({ coords }) => {
        if (!selectedMap) return;
        selectedMap = {
          ...selectedMap,
          current_player_hex: coords,
          explored_hexes: mergeHexes(selectedMap.explored_hexes, coords)
        };
      },
      onHexReveal: ({ hexes }) => {
        if (!selectedMap) return;
        const merged = [...selectedMap.explored_hexes];
        for (const hex of hexes) {
          if (!merged.find((h) => h.q === hex.q && h.r === hex.r)) {
            merged.push(hex);
          }
        }
        selectedMap = { ...selectedMap, explored_hexes: merged };
      },
      onItemCreated: ({ item }) => {
        if (!selectedMap || !item) return;
        selectedMap = { ...selectedMap, items: [...selectedMap.items, item] };
      },
      onItemUpdated: ({ item }) => {
        if (!selectedMap || !item) return;
        selectedMap = {
          ...selectedMap,
          items: selectedMap.items.map((existing) => (existing.id === item.id ? item : existing))
        };
      },
      onItemDeleted: ({ item }) => {
        if (!selectedMap || !item) return;
        selectedMap = {
          ...selectedMap,
          items: selectedMap.items.filter((existing) => existing.id !== item.id)
        };
      }
    });

    campaignChannel = subscribeToCampaign(selectedCampaign.id, {
      onHistoryEvent: (event) => {
        if (!event) return;
        history = [event as ExplorationEvent, ...history].slice(0, 25);
      }
    });
  }

  function detachRealtime() {
    mapChannel?.leave();
    campaignChannel?.leave();
    mapChannel = null;
    campaignChannel = null;
  }

  function mergeHexes(existing: HexCoords[], coords: HexCoords): HexCoords[] {
    if (existing.find((hex) => hex.q === coords.q && hex.r === coords.r)) {
      return existing;
    }
    return [...existing, coords];
  }

  async function handleMapSelect(event: Event) {
    const mapId = (event.target as HTMLSelectElement).value;
    if (!mapId) return;
    await loadMap(mapId);
    await loadHistory();
    attachRealtime();
  }

  async function handleCampaignSelect(event: Event) {
    const campaignId = (event.target as HTMLSelectElement).value;
    selectedCampaign = campaigns.find((c) => c.id === campaignId) ?? null;
    if (selectedCampaign && selectedCampaign.maps.length > 0) {
      await loadMap(selectedCampaign.maps[0].id);
      await loadHistory();
      attachRealtime();
    } else {
      selectedMap = null;
      detachRealtime();
    }
  }

  async function movePlayers() {
    if (!selectedMap) return;
    await client.request(Mutations.SetPlayerLocation, {
      mapId: selectedMap.id,
      q: movementInput.q,
      r: movementInput.r
    });
    statusMessage = `Players moved to ${movementInput.q}, ${movementInput.r}`;
  }

  async function revealHexes() {
    if (!selectedMap) return;
    const parsed: HexCoords[] = revealInput
      .split(';')
      .map((pair) => pair.trim())
      .filter(Boolean)
      .map((pair) => {
        const [q, r] = pair.split(',').map((v) => Number(v.trim()));
        return { q, r };
      });

    if (parsed.length === 0) return;

    await client.request(Mutations.RevealHexes, {
      mapId: selectedMap.id,
      hexes: parsed
    });
    statusMessage = `Revealed ${parsed.length} hexes.`;
  }

  onMount(async () => {
    await refreshCampaigns();
  });

  onDestroy(() => {
    detachRealtime();
  });
</script>

<section class="dm-panel">
  <div class="controls">
    <div class="selector">
      <label>Campaign</label>
      <select on:change={handleCampaignSelect} value={selectedCampaign ? selectedCampaign.id : ""}>
        {#each campaigns as campaign}
          <option value={campaign.id}>{campaign.name}</option>
        {/each}
      </select>
    </div>
    {#if selectedCampaign}
      <div class="selector">
        <label>Map</label>
        <select on:change={handleMapSelect} value={selectedMap ? selectedMap.id : ""}>
          {#each selectedCampaign.maps as mapSummary}
            <option value={mapSummary.id}>{mapSummary.name}</option>
          {/each}
        </select>
      </div>
    {/if}
  </div>

  {#if selectedMap}
    {@const currentMap = selectedMap as MapDetail}
    <HexMap mapDetail={currentMap} />

    <div class="actions">
      <div>
        <h3>Move players</h3>
        <div class="grid">
          <label>
            Q
            <input type="number" bind:value={movementInput.q} />
          </label>
          <label>
            R
            <input type="number" bind:value={movementInput.r} />
          </label>
          <button on:click={movePlayers}>Update location</button>
        </div>
      </div>
      <div>
        <h3>Reveal hexes</h3>
        <label>
          Coordinates (q,r pairs separated by semicolons)
          <input bind:value={revealInput} placeholder="13,18;14,19" />
        </label>
        <button on:click={revealHexes}>Reveal</button>
      </div>
    </div>
  {/if}

  {#if statusMessage}
    <p class="status">{statusMessage}</p>
  {/if}
</section>

<section class="history">
  <h2>Exploration history</h2>
  {#if history.length === 0}
    <p>No actions logged yet.</p>
  {:else}
    <ul>
      {#each history as entry}
        <li>
          <span class="timestamp">{new Date(entry.occurred_at).toLocaleString()}</span>
          <strong>{entry.type}</strong>
          <code>{JSON.stringify(entry.payload)}</code>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .dm-panel {
    display: grid;
    gap: 1.5rem;
  }

  .controls {
    display: flex;
    gap: 1.5rem;
  }

  .selector {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  select,
  input,
  button {
    background: rgba(13, 17, 23, 0.75);
    border: 1px solid rgba(88, 166, 255, 0.2);
    color: #e6edf3;
    padding: 0.5rem 0.75rem;
    border-radius: 8px;
  }

  button {
    cursor: pointer;
    background: linear-gradient(135deg, rgba(88, 166, 255, 0.3), rgba(56, 139, 253, 0.5));
    transition: opacity 0.2s ease;
  }

  button:hover {
    opacity: 0.8;
  }

  .actions {
    display: grid;
    gap: 1rem;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(60px, 1fr));
    gap: 0.5rem;
    align-items: end;
  }

  .grid button {
    grid-column: span 2;
  }

  .status {
    color: #34d399;
  }

  .history ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 0.75rem;
  }

  .history li {
    background: rgba(13, 17, 23, 0.7);
    border: 1px solid rgba(88, 166, 255, 0.12);
    padding: 0.75rem;
    border-radius: 8px;
  }

  .timestamp {
    font-size: 0.85rem;
    opacity: 0.7;
    margin-right: 0.5rem;
  }

  code {
    display: block;
    margin-top: 0.25rem;
    font-size: 0.85rem;
    background: rgba(255, 255, 255, 0.05);
    padding: 0.5rem;
    border-radius: 4px;
  }
</style>
