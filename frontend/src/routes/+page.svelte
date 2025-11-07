<script lang="ts">
  import { onMount } from 'svelte';
  import { loadCampaignSummaries } from '$stores/campaigns';
  import type { CampaignSummary } from '$graphql/types';

  let summaries: CampaignSummary[] = [];
  let loading = true;
  let error: string | null = null;

  onMount(async () => {
    try {
      summaries = await loadCampaignSummaries();
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load campaigns';
    } finally {
      loading = false;
    }
  });
</script>

<section class="hero">
  <h2>Collaborative exploration for tabletop worlds</h2>
  <p>
    Upload massive regional maps, overlay exploration hexes, and keep your players synchronized with real-time
    reveals.
  </p>
</section>

<section>
  <h3>Active Campaigns</h3>
  {#if loading}
    <p>Loading campaigns…</p>
  {:else if error}
    <p class="error">{error}</p>
  {:else if summaries.length === 0}
    <p>No campaigns yet. Head to the Dungeon Master view to start one.</p>
  {:else}
    <div class="campaign-grid">
      {#each summaries as campaign}
        <article class="campaign-card">
          <h4>{campaign.name}</h4>
          <p>{campaign.description}</p>
          <div class="meta">
            <span>Maps: {campaign.maps.length}</span>
            <span>Default hex: {campaign.default_hex_size} miles</span>
          </div>
        </article>
      {/each}
    </div>
  {/if}
</section>

<style>
  .hero {
    margin-bottom: 2rem;
    background: linear-gradient(135deg, rgba(88, 166, 255, 0.18), rgba(56, 139, 253, 0));
    padding: 2rem;
    border-radius: 16px;
  }

  .campaign-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 1rem;
  }

  .campaign-card {
    background: rgba(13, 17, 23, 0.75);
    border: 1px solid rgba(88, 166, 255, 0.2);
    border-radius: 12px;
    padding: 1rem;
  }

  .meta {
    margin-top: 0.5rem;
    display: flex;
    justify-content: space-between;
    font-size: 0.85rem;
    opacity: 0.8;
  }

  .error {
    color: #ff7b72;
  }
</style>
