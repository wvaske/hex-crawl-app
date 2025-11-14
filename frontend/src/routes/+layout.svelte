<script lang="ts">
  export let data;
</script>

<svelte:head>
  <title>Hex Crawl Orchestrator</title>
  <link rel="stylesheet" href="https://unpkg.com/maplibre-gl@3.5.1/dist/maplibre-gl.css" />
</svelte:head>

<div class="app-shell">
  <header>
    <h1>Hex Crawl Control Center</h1>
    <nav>
      <a href="/">Overview</a>
      <a href="/dm">Dungeon Master</a>
    </nav>
  </header>
  <main>
    <slot />
  </main>
</div>

<style>
  :global(body) {
    margin: 0;
    font-family: 'Inter', system-ui, sans-serif;
    background: #0d1117;
    color: #e6edf3;
  }

  a {
    color: #58a6ff;
    text-decoration: none;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 2rem;
    border-bottom: 1px solid rgba(88, 166, 255, 0.3);
  }

  nav a {
    margin-left: 1rem;
  }

  .app-shell {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }

  main {
    flex: 1;
    padding: 1.5rem 2rem;
  }
</style>
