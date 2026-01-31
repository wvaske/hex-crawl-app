# Phase 6: Map Image Upload - Context

**Gathered:** 2026-01-31
**Status:** Ready for planning

<domain>
## Phase Boundary

DM uploads custom map images that display as background layers beneath the hex grid overlay. DM controls grid alignment (offset, scale) to match the image. Multiple images supported per map with layer ordering and per-layer visibility. Multiple maps per campaign.

</domain>

<decisions>
## Implementation Decisions

### Grid overlay appearance
- Default to wireframe-only hex outlines over the image — no terrain fill colors
- Toggle to enable semi-transparent terrain overlay on top of image
- Terrain overlay opacity controlled by a slider (DM adjustable)
- Wireframe line color and thickness are DM-configurable
- Grid style settings stored per map; new maps inherit most recent settings
- Coordinate labels (q,r) always shown, even over map images
- Fog of war renders on top of map image — unrevealed hexes hide the image for players

### Alignment controls
- Grid moves, image stays fixed — DM adjusts grid offset and hex size
- Independent horizontal and vertical scale (not all maps have square hexes)
- No rotation support
- Drag for rough positioning, numeric inputs for fine-tuning
- Dedicated alignment mode — DM enters mode, special controls appear, exits when done
- Each image layer has its own alignment (offset, scale)

### Upload experience
- No hard file size limit — accept whatever the browser can handle
- PNG and JPG supported
- Direct upload — no preview step, DM can remove if unwanted
- Multiple images per map (layered)
- Multiple maps per campaign (overworld, dungeon, etc.)

### Image-grid relationship
- Hex grid can extend beyond the image — image is just a background layer
- Image layers managed in a simple list in the side panel with drag-to-reorder
- Per-layer visibility toggle (show/hide)
- DM controls per-layer player visibility — each layer can be player-visible or DM-only
- Per-layer alignment (offset/scale) — layers are independently positioned

### Storage
- Local filesystem for development
- S3-compatible storage for production deployment
- Storage backend abstracted to support both

### Claude's Discretion
- Highlight rendering adjustments when image is present (hover, select, multi-select)
- Exact alignment mode UI layout and controls
- Image compression/optimization on upload
- Layer list UI details in side panel
- Storage abstraction implementation

</decisions>

<specifics>
## Specific Ideas

- Not all uploaded maps will have perfectly sized hexes — independent H/V scale is essential for fitting grids to diverse map images
- DM-only layers serve as reference overlays (e.g., secret dungeon annotations) that players never see
- Multiple maps per campaign enables overworld + dungeon + battle maps in one campaign

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 06-map-image-upload*
*Context gathered: 2026-01-31*
