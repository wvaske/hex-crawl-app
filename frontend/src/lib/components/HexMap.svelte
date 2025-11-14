<script lang="ts">
  import maplibregl from 'maplibre-gl';
  import { onDestroy, onMount } from 'svelte';
  import type { HexCoords, HexItem, MapDetail } from '$graphql/types';

  export let mapDetail: MapDetail;
  export let interactive = true;

  let mapContainer: HTMLDivElement | null = null;
  let map: maplibregl.Map | null = null;
  const scale = 0.01;

  const hexRadius = 0.008;

  function coordsToLngLat(coords: HexCoords) {
    return [coords.q * scale, coords.r * scale];
  }

  function hexPolygon(coords: HexCoords) {
    const [cx, cy] = coordsToLngLat(coords);
    const points: [number, number][] = [];
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i + Math.PI / 6;
      const x = cx + hexRadius * Math.cos(angle);
      const y = cy + hexRadius * Math.sin(angle);
      points.push([x, y]);
    }
    points.push(points[0]);
    return points;
  }

  function buildHexFeatureCollection(hexes: HexCoords[]) {
    return {
      type: 'FeatureCollection',
      features: hexes.map((hex) => ({
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [hexPolygon(hex)]
        },
        properties: { q: hex.q, r: hex.r }
      }))
    };
  }

  function buildItemsFeatureCollection(items: HexItem[]) {
    return {
      type: 'FeatureCollection',
      features: items.map((item) => {
        const [q, r] = item.hex_id.split(':').map((v) => Number(v));
        return {
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: coordsToLngLat({ q, r })
          },
          properties: {
            title: item.name,
            icon: item.icon ?? 'marker'
          }
        };
      })
    };
  }

  function updateSources() {
    if (!map) return;

    const exploredSource = map.getSource('explored-hexes') as maplibregl.GeoJSONSource;
    exploredSource?.setData(buildHexFeatureCollection(mapDetail.explored_hexes || []));

    const itemsSource = map.getSource('hex-items') as maplibregl.GeoJSONSource;
    itemsSource?.setData(buildItemsFeatureCollection(mapDetail.items || []));

    const playerSource = map.getSource('player-position') as maplibregl.GeoJSONSource;
    if (playerSource) {
      if (mapDetail.current_player_hex) {
        playerSource.setData({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: {
                type: 'Point',
                coordinates: coordsToLngLat(mapDetail.current_player_hex)
              },
              properties: {}
            }
          ]
        });
      } else {
        playerSource.setData({ type: 'FeatureCollection', features: [] });
      }
    }
  }

  function fitBounds() {
    if (!map) return;
    const bounds = new maplibregl.LngLatBounds();
    const { min_q, max_q, min_r, max_r } = mapDetail.bounds;
    bounds.extend(coordsToLngLat({ q: min_q, r: min_r }));
    bounds.extend(coordsToLngLat({ q: max_q, r: max_r }));
    map.fitBounds(bounds, { padding: 40, animate: false });
  }

  onMount(() => {
    if (!mapContainer) return;
    map = new maplibregl.Map({
      container: mapContainer,
      style: {
        version: 8,
        name: 'blank',
        sources: {},
        layers: [
          {
            id: 'background',
            type: 'background',
            paint: {
              'background-color': '#05060a'
            }
          }
        ]
      },
      center: [0, 0],
      zoom: 1,
      interactive
    });

    map.on('load', () => {
      map!.addSource('explored-hexes', {
        type: 'geojson',
        data: buildHexFeatureCollection(mapDetail.explored_hexes || [])
      });

      map!.addLayer({
        id: 'hex-fill',
        type: 'fill',
        source: 'explored-hexes',
        paint: {
          'fill-color': '#34d399',
          'fill-opacity': 0.35
        }
      });

      map!.addLayer({
        id: 'hex-outline',
        type: 'line',
        source: 'explored-hexes',
        paint: {
          'line-color': '#10b981',
          'line-width': 1.5
        }
      });

      map!.addSource('hex-items', {
        type: 'geojson',
        data: buildItemsFeatureCollection(mapDetail.items || [])
      });

      map!.addLayer({
        id: 'hex-items-label',
        type: 'symbol',
        source: 'hex-items',
        layout: {
          'text-field': ['get', 'title'],
          'text-size': 12,
          'text-offset': [0, 1.2],
          'text-anchor': 'top'
        },
        paint: {
          'text-color': '#facc15'
        }
      });

      map!.addSource('player-position', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: []
        }
      });

      map!.addLayer({
        id: 'player-circle',
        type: 'circle',
        source: 'player-position',
        paint: {
          'circle-radius': 6,
          'circle-color': '#f97316',
          'circle-stroke-color': '#fff',
          'circle-stroke-width': 1.5
        }
      });

      updateSources();
      fitBounds();
    });
  });

  $: if (map) {
    updateSources();
  }

  onDestroy(() => {
    map?.remove();
    map = null;
  });
</script>

<div bind:this={mapContainer} class="hex-map"></div>

<style>
  .hex-map {
    width: 100%;
    height: 480px;
    border-radius: 16px;
    overflow: hidden;
    border: 1px solid rgba(88, 166, 255, 0.2);
  }
</style>
