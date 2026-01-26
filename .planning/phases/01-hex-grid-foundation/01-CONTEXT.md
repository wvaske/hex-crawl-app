# Phase 1: Hex Grid Foundation - Context

**Gathered:** 2026-01-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Interactive hex grid rendering in the browser with terrain display, pan/zoom navigation, multi-select interaction, and correct axial/cube coordinate math. Includes simple terrain generation, manual terrain assignment, and basic map import/export. This is the visual and mathematical foundation every future feature depends on.

</domain>

<decisions>
## Implementation Decisions

### Hex orientation & sizing
- Hex orientation: Claude's discretion (flat-top vs pointy-top — pick what works best for hex crawl conventions)
- Default grid size: small (10-15 hex radius, ~200-700 hexes)
- DM sets grid size at map creation via a creation dialog, with a pre-populated default they can change
- Grids are expandable — DM can add to the grid dimensions after creation
- View zoom: smooth scroll-wheel zoom (magnify/shrink the current view), not discrete steps
- Multi-scale map switching (3mi → 6mi → 18mi etc.) is deferred to v2 — not part of Phase 1

### Terrain visuals
- 10 built-in terrain types: forest, desert, grassland, mountain, water, swamp, arctic, coast, underdark, urban
- DMs can create custom terrain types and upload icons for them
- Terrain displayed using pre-made art asset textures (not procedural patterns or solid colors)
- Multiple art variants per terrain type, randomly assigned to hexes for visual variety
- Use placeholder images for first pass; final assets will be AI-generated later
- Coordinates shown on hover only (not always visible)

### Interaction & feedback
- Click selects a hex and shows info in a persistent side panel (coordinates, terrain type)
- Strong hover highlight (obvious color overlay or thick border)
- Multi-select supported: shift-click to add/remove, drag-select for area selection
- Multi-select is foundation for future batch fog reveals and terrain painting

### Initial grid state
- New maps created via a creation dialog (name, grid size, then generate)
- Default terrain: random generation with simple clustering (water connects to water/coast, terrain forms multi-hex regions — not pure random noise)
- Smarter terrain generation algorithms deferred to later
- DM can manually set terrain on selected hexes (single or multi-select, pick from terrain palette)
- Simple JSON/YAML import/export: covers hex coordinates and terrain types only in Phase 1

### Claude's Discretion
- Flat-top vs pointy-top hex orientation
- Exact hover highlight style
- Side panel layout and positioning
- Zoom level bounds (min/max zoom)
- Clustering algorithm for terrain generation
- Import/export file format preference (JSON vs YAML as default)
- Placeholder texture art style

</decisions>

<specifics>
## Specific Ideas

- Multiple art assets per terrain type randomly assigned — the map should not look repetitive
- Terrain generation should have adjacency intelligence even in Phase 1: water connects to water/coast, terrain types cluster into multi-hex regions
- The creation dialog should pre-populate defaults but let the DM override everything before generating
- Import/export format will expand in future phases to include fog state, hex content, influence radius, and DC requirements
- Grid alignment to uploaded map images belongs in Phase 6 — "Many programs zoom into a specific area and let you line up the lines. An automatic process is a nice to have."

</specifics>

<deferred>
## Deferred Ideas

- Multi-scale map switching (ZOOM-01/02/03) — v2
- Terrain brush/paint tool (PAINT-01) — v2
- Smarter terrain generation algorithms (biome simulation, noise-based) — future enhancement
- Expanded import/export format with fog state, content, influence radius, DC requirements — future phases
- Automatic hex grid alignment to uploaded map images — Phase 6 nice-to-have
- Custom terrain type icons uploaded by DM — implementation may be simple enough for Phase 1, but full custom terrain management could extend to later phases at Claude's discretion

</deferred>

---

*Phase: 01-hex-grid-foundation*
*Context gathered: 2026-01-26*
