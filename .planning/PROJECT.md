# HexCrawl

## What This Is

A web application for managing hex crawl exploration in tabletop RPGs like Dungeons & Dragons. Dungeon Masters create campaigns with multi-scale hex maps, populate hexes with content (encounters, lore, dungeons, towns, points of interest), and invite players to explore. During play, players move their own character tokens on fog-of-war maps while the DM reveals hex details in real time. Designed for personal use first with potential to become a public product.

## Core Value

Real-time hex crawl exploration with fog of war — the DM controls what players see, and when hexes are revealed, every connected player sees it instantly.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] DM can create campaigns and invite players by username/email
- [ ] Account-based authentication (signup, login, session management)
- [ ] Multi-scale hex maps with configurable hex sizes (1-6 mile smallest, 40-100 mile largest)
- [ ] Zoom between map scales with consistent player/token positioning
- [ ] Upload hex map images with hex grid overlay
- [ ] Paint terrain on generated hex grids (forest, desert, grassland, mountain, water, etc.)
- [ ] Fog of war controlled by DM (hide/reveal portions of the map)
- [ ] Individual player character tokens visible to all in real time
- [ ] Players move their own tokens independently
- [ ] DM reveals hex content after party finalizes movement
- [ ] Real-time updates — hex reveals, token movement, fog changes visible to all connected users
- [ ] Hex content types: encounters, lore, dungeons, towns, points of interest
- [ ] Influence radius on hex content — characteristics visible at a range that bleeds across zoom levels
- [ ] DM-configurable encounter tables (monsters with difficulty rating and terrain type)
- [ ] Random encounter generation — dice rolling per DMG rules, suggests encounter from tables based on terrain
- [ ] DM can pre-populate hexes before sessions and add/edit content live during play
- [ ] Campaign state persists across sessions (fog of war, reveals, positions, all content saved)
- [ ] DM sees full map and all content; players see only revealed hexes and tokens

### Out of Scope

- AI-powered map processing (text/marker removal, entity extraction) — complexity too high for v1, may revisit
- Running actual combat encounters — DM uses other tools for combat; this app handles exploration and encounter generation only
- Mobile native app — web-first approach
- Voice/video chat integration — players use Discord or similar
- Character sheet management — other tools handle this

## Context

- **Domain:** Tabletop RPG hex crawl mechanics, specifically D&D 5e style exploration
- **Reference product:** koboldplus.club for encounter generation approach (balanced encounters based on party composition)
- **DMG encounter rules:** Random encounter dice rolling follows Dungeon Master's Guide procedures — roll frequency, terrain-based tables, difficulty scaling
- **Hex scale conventions:** D&D hex crawl uses nested scales — continental (40-100 mile hexes), regional (6-24 mile hexes), local (1-6 mile hexes). A single large hex contains multiple smaller hexes at the next zoom level
- **Influence radius use case:** A black dragon's lair in a 3-mile hex corrupts surrounding terrain. At a 48-mile zoom, the entire area shows signs of corruption. This means hex content needs a "visible at range" property that surfaces at appropriate zoom levels
- **User flow:** DM creates campaign → uploads/paints maps at multiple scales → populates key hexes → configures encounter tables → invites players → runs sessions where players explore, DM reveals, encounters generate
- **Audience:** Personal use initially (DM + their gaming group), with potential to open to other groups

## Constraints

- **Platform**: Web application — must work in modern browsers
- **Real-time**: Must support simultaneous access with low-latency updates (WebSockets or similar)
- **Image handling**: Must handle uploaded map images (potentially large high-resolution files)
- **Persistence**: Full campaign state must persist between sessions with no data loss
- **Remote development**: Development occurs on a remote system — all dev servers must bind to `0.0.0.0` (not localhost) so they are accessible from the developer's machine

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Remove AI map processing from v1 | Too complex, not core to hex crawl experience | — Pending |
| Individual token movement (not party token) | Players move independently, DM reveals after discussion | — Pending |
| Account-based auth with invite system | Supports persistence and access control | — Pending |
| Encounter generation = dice rolling only, not combat runner | Other tools handle combat; this app focuses on exploration | — Pending |
| Support both uploaded map images and painted grids | Flexibility for DMs with different prep styles | — Pending |

---
*Last updated: 2026-01-26 after initialization*
