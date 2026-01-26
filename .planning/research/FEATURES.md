# Feature Research

**Domain:** Hex crawl exploration tool (web application, not full VTT)
**Researched:** 2026-01-26
**Confidence:** MEDIUM — based on survey of existing products (Foundry VTT modules, Roll20, Owlbear Rodeo, Worldographer, HEXROLL, Hextml) and community discussions across RPG forums. No single authoritative source for "hex crawl exploration tool" as a product category since it does not exist as a standalone product today.

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = product feels incomplete.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Hex grid map display** | Fundamental unit of the product. Users expect to see a hex grid they can interact with. Every competitor has this. | MEDIUM | Must support flat-top and pointy-top orientations. Rendering performance matters at scale (hundreds of hexes visible). |
| **Fog of war (DM-controlled)** | Core exploration mechanic. Every VTT and hex crawl tool has some form of this. Roll20, Foundry, Owlbear Rodeo, HEXROLL all provide it. Without it, there is no "exploration" — just a map. | HIGH | Must be per-hex, not freeform polygon. HEXROLL does two-stage reveal (terrain first, then details). Roll20's hex fog is notoriously bad (square-grid-based internally). This is where Roll20 fails and where value is created. |
| **DM and player roles with different views** | Every VTT separates GM and player perspectives. DMs see everything; players see only what has been revealed. Foundry, Roll20, Owlbear Rodeo all enforce this. | MEDIUM | Authentication and authorization model. DM sees full map + notes; players see only revealed hexes. |
| **Token placement and movement** | Players need visual representation on the map. HEXROLL, Foundry modules, Owlbear Rodeo all support tokens. Without tokens, there is no sense of "being somewhere." | MEDIUM | Snap-to-hex-center movement. Party token vs. individual tokens is a design decision (most hex crawls use a single party token, but individual tokens add value for split-party scenarios). |
| **Real-time sync between DM and players** | This is a web app; users expect changes to propagate instantly. HEXROLL does this. Hextml does "near real-time." Foundry VTT is real-time via WebSocket. Any lag breaks immersion. | HIGH | WebSocket architecture. State synchronization for fog reveals, token movement, and hex content. This is the core technical challenge. |
| **Terrain types on hexes** | Hex crawls are defined by terrain. Every hex map tool (Worldographer, Hexographer, HexGen, Hextml) supports terrain painting. Users expect forest, mountain, plains, desert, swamp, water, etc. | LOW | Color-coded or icon-based terrain display. Need a reasonable default set (8-12 terrain types). |
| **Upload custom map images** | Many DMs have existing maps they want to use. Foundry VTT supports image backgrounds with grid overlay. Worldographer exports images. DMs will revolt if forced to only use generated maps. | MEDIUM | Image upload + hex grid overlay alignment. Must support pan, zoom, and grid sizing to align with uploaded image. |
| **Campaign persistence** | Sessions span weeks/months. Map state, revealed hexes, token positions, and hex content must persist between sessions. Every VTT persists campaign state. | MEDIUM | Database-backed storage. Campaign as the organizing unit. |
| **Account-based authentication** | Multi-user web app requires accounts. DMs need to own campaigns; players need to join them. Every VTT has this. | MEDIUM | Standard auth flow. Campaign invite/join mechanism. |
| **Hex content/notes (DM-side)** | DMs need to attach information to hexes — encounters, lore, descriptions, POIs. Foundry has journal entries linked to map pins. Worldographer has hex crawl detail dialogs. Without this, DMs must track content externally, which defeats the purpose. | MEDIUM | Rich text or structured data per hex. DM-only until revealed. |
| **Hex numbering/coordinates** | DMs reference hexes by number in their notes and published modules. Worldographer, Hexographer, and classic hex maps all number hexes (e.g., "0305"). | LOW | Standard hex coordinate system (offset or axial). Display toggleable. |

### Differentiators (Competitive Advantage)

Features that set the product apart. Not required, but valuable. Ordered by alignment with stated core value.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Per-hex fog of war with hex-native reveal** | Roll20's fog is square-grid-based and terrible for hexes. Foundry requires modules (World Explorer, Hexplorer). No existing tool does hex-native fog of war as a first-class, built-in feature with real-time multiplayer sync. This IS the product. | HIGH | Two-stage reveal (terrain silhouette, then full detail) as HEXROLL does is compelling. Click-to-reveal per hex. Batch reveal for adjacent hexes. |
| **Multi-scale hex maps with zoom** | Worldographer has child maps but they are disconnected views, not a seamless zoom experience. No existing tool offers Google-Maps-style zoom between continental (40-100mi hexes), regional (6-24mi hexes), and local (1mi hexes) scales with consistent positioning. | VERY HIGH | Hex nesting is geometrically hard. Multiples of 3 work cleanly (6mi to 18mi to 54mi). Need coordinate mapping between scales. Content at one scale must be accessible from another. This is the hardest technical feature and the strongest differentiator. |
| **Influence radius / content bleed across zoom levels** | When a DM places a dragon's lair in a 1-mile hex, adjacent hexes and the parent 6-mile hex should reflect that (danger markers, rumors). No existing tool does this. | HIGH | Requires data model that links content across scales. Propagation rules for how content "bleeds" upward and outward. |
| **DM-configurable encounter tables with dice rolling** | Foundry's Hex-Assist module outputs weather, pace, encounters via macro. But it is a bolt-on module, not a first-class feature. Built-in encounter tables with terrain-aware generation, configurable by the DM, with proper dice mechanics (d6, d8, d12, d20, percentile) is a differentiator. | MEDIUM | Per-terrain-type encounter tables. DMG-compatible dice expressions. DM can edit tables. Results feed into hex content/notes. |
| **Hex content reveal to players** | DM reveals not just fog, but specific content — "you see a ruined tower" vs. "you find the entrance to the Tomb of Horrors." Staged information disclosure per hex. Foundry's World Explorer partially does this (tiles removed to show underlying map). | MEDIUM | Content has visibility states: hidden, terrain-only, partial, full. DM controls what players see about each hex independently of fog. |
| **Paint terrain on generated hex grids** | Worldographer does this well for offline editing. No real-time collaborative terrain painting exists for hex maps. DMs painting terrain live while players watch fog lift is a unique experience. | MEDIUM | Terrain brush tool. Click or drag to paint. Undo/redo. DM-only tool. |
| **Travel/time tracking integration** | Hex-Assist tracks pace, distance, and time. Prismatic Wasteland's checklist structures travel into watches. Built-in travel mechanics (movement cost per terrain, travel pace, day/watch structure) that automatically update token position constraints would streamline hex crawl gameplay. | MEDIUM | Terrain movement costs. Pace selection (careful/normal/fast). Watch-based time structure (morning/afternoon/evening/night). |
| **Weather generation** | Multiple hex crawl frameworks (Alexandrian, Tomb of Annihilation, Hex-Assist) include weather. Per-day or per-watch weather that affects travel speed and encounters. | LOW | Random weather tables. Terrain and season modifiers. Display to players as atmospheric flavor. |
| **Navigation and getting lost mechanics** | Core to the Alexandrian's hex crawl framework. When the party fails navigation, they veer to an adjacent hex without knowing it. No digital tool implements this natively with the map — the DM must track it manually. | MEDIUM | Navigation DC per terrain. Failed check = silent veer (DM sees true position, players see intended position until they realize they are lost). This is a powerful DM tool. Depends on: DM/player role separation, token movement. |
| **Session sharing via URL** | HEXROLL does this — click Share, get a link, players join. No account required for players. Lowers friction dramatically. | LOW | Session-based join link. Players get a simplified view. Could be in addition to account-based auth, not instead of. |

### Anti-Features (Deliberately NOT Building)

Features that seem good but create problems, or that violate the product's identity.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Combat grid / tactical map** | VTT users expect it. Roll20, Foundry, Owlbear Rodeo all have it. | Scope explosion. Combat grids require initiative tracking, range calculation, AoE templates, condition markers, line-of-sight, walls/doors. This is what makes VTTs take years to build. The product is an exploration tool, not a combat tool. | Link out to existing VTTs for combat. Or: provide a simple "zoom into hex" view for theater-of-mind combat without tactical features. |
| **Character sheets** | VTT users expect integrated character management. | Massive scope. System-specific (5e, PF2e, OSR all different). D&D Beyond, Foundry, Roll20 all do this and do it better. Building this dilutes focus. | Integration points: link to D&D Beyond character, or simple name/class/HP display on tokens. |
| **Dice rolling (general purpose)** | Every VTT has dice. Players expect /roll 2d6+3. | Scope creep toward full VTT. General dice rolling has nothing to do with hex exploration. | Dice rolling ONLY for encounter table generation (DM-side). Not a general-purpose dice roller for players. |
| **Chat / messaging system** | VTTs have in-app text chat. | Users already have Discord, which is better. Building chat is significant effort with moderation implications. | Assume Discord/voice chat runs alongside. No in-app messaging. |
| **Video/voice integration** | Roll20 has built-in video. | Terrible to build, worse to maintain. Discord/Zoom/Google Meet all do this better. | External voice chat. |
| **Marketplace / content store** | Roll20 and Foundry have marketplaces for maps, modules, tokens. | Requires content pipeline, licensing, payment processing, creator tools. This is a business, not a feature. | Support import of standard formats (image files, possibly UVTT format). |
| **Procedural world generation** | HEXROLL, Azgaar, Worldographer all generate worlds. | Procedural generation is a deep rabbit hole. Quality output requires months of tuning. The product's value is in the exploration experience, not in generating the world. | Support importing generated content from other tools. Allow DMs to populate hexes manually or paste content. |
| **Mobile-first design** | Users play on phones/tablets. | Hex maps require precision interaction (clicking individual hexes, painting terrain, managing fog). Touch interfaces for map editors are notoriously frustrating. Worldographer and CC3 are desktop-only for good reason. | Desktop-first responsive design. Player view should be usable on tablet (view-only + token movement). DM tools desktop-only. |
| **Dungeon maps / interior maps** | HEXROLL has dungeon maps. Foundry has battle maps. | Different rendering engine, different interaction model, different content structure. Dungeon mapping is its own product category. | Hex content can link to external resources (e.g., a URL to a dungeon map in another tool). |
| **System-specific rules automation** | Foundry has game system modules that automate 5e, PF2e, etc. | System lock-in. Massive maintenance burden as rules change. The product should be system-agnostic. | Configurable encounter tables and travel rules that the DM sets up for their system. Provide templates for common systems (5e, OSR, PF2e) but do not hard-code rules. |

## Feature Dependencies

```
[Account Auth]
    └──requires──> (nothing, foundational)

[Campaign Persistence]
    └──requires──> [Account Auth]

[Hex Grid Display]
    └──requires──> (nothing, foundational)

[Terrain Types]
    └──requires──> [Hex Grid Display]

[Upload Map Images]
    └──requires──> [Hex Grid Display]

[Paint Terrain]
    └──requires──> [Hex Grid Display] + [Terrain Types]

[Hex Numbering]
    └──requires──> [Hex Grid Display]

[Token Placement]
    └──requires──> [Hex Grid Display]

[DM/Player Roles]
    └──requires──> [Account Auth]

[Fog of War]
    └──requires──> [Hex Grid Display] + [DM/Player Roles]

[Real-time Sync]
    └──requires──> [DM/Player Roles] + [Campaign Persistence]

[Hex Content/Notes]
    └──requires──> [Hex Grid Display] + [Campaign Persistence]

[Hex Content Reveal]
    └──requires──> [Hex Content/Notes] + [Fog of War] + [Real-time Sync]

[Encounter Tables]
    └──requires──> [Hex Content/Notes] + [Terrain Types]

[Multi-scale Zoom]
    └──requires──> [Hex Grid Display] + [Hex Numbering] + [Campaign Persistence]

[Influence Radius]
    └──requires──> [Multi-scale Zoom] + [Hex Content/Notes]

[Travel/Time Tracking]
    └──requires──> [Token Placement] + [Terrain Types]

[Navigation/Getting Lost]
    └──requires──> [Token Placement] + [DM/Player Roles] + [Travel/Time Tracking]

[Weather Generation]
    └──requires──> [Travel/Time Tracking]

[Session URL Sharing]
    └──requires──> [Real-time Sync]
```

### Dependency Notes

- **Fog of War requires DM/Player Roles:** Fog only makes sense when there are two different views to maintain. Build role separation before fog.
- **Real-time Sync requires Campaign Persistence:** You cannot sync state that is not persisted. The database model must exist before WebSocket sync layers on top.
- **Multi-scale Zoom requires Hex Numbering:** Coordinate systems must be consistent across scales. The hex coordinate model is the foundation for zoom.
- **Influence Radius requires Multi-scale Zoom:** Content bleed only matters when there are multiple scales to bleed across.
- **Navigation/Getting Lost requires Travel/Time Tracking:** The "lost" mechanic modifies travel outcomes. Travel must exist first.
- **Hex Content Reveal is the convergence point:** It requires fog, content, and sync. This is where the core value proposition lives.

## MVP Definition

### Launch With (v1)

Minimum viable product — what is needed to validate "real-time hex crawl exploration with fog of war."

- [ ] **Hex grid display** — foundational rendering
- [ ] **Terrain types (paint or assign)** — hexes must have visual meaning
- [ ] **Fog of war (DM-controlled, per-hex)** — the core mechanic
- [ ] **DM and player roles** — two different views of the same map
- [ ] **Real-time sync** — DM reveals hex, player sees it instantly
- [ ] **Token placement (party token)** — visual marker for "you are here"
- [ ] **Hex content/notes (DM-side)** — DM attaches text to hexes
- [ ] **Hex content reveal** — DM pushes content to players selectively
- [ ] **Campaign persistence** — state survives session end
- [ ] **Account auth** — DM creates campaign, players join

### Add After Validation (v1.x)

Features to add once core is working and validated with real DM sessions.

- [ ] **Upload map images with grid overlay** — trigger: DMs ask "can I use my existing map?"
- [ ] **Encounter tables with dice rolling** — trigger: DMs want automated encounter generation
- [ ] **Travel/time tracking** — trigger: DMs want structured travel procedures
- [ ] **Weather generation** — trigger: pairs naturally with travel tracking
- [ ] **Session URL sharing (no account for players)** — trigger: friction in player onboarding
- [ ] **Individual player tokens** — trigger: split-party scenarios requested
- [ ] **Hex numbering display** — trigger: DMs referencing published module hex codes

### Future Consideration (v2+)

Features to defer until product-market fit is established.

- [ ] **Multi-scale hex maps with zoom** — trigger: DMs want continent-to-local zoom. Defer because: VERY HIGH complexity, geometrically hard, requires mature coordinate system and data model. This is the biggest differentiator but also the biggest risk.
- [ ] **Influence radius / content bleed** — trigger: multi-scale zoom is working. Defer because: depends entirely on multi-scale, and content propagation rules need real-world testing.
- [ ] **Navigation/getting lost mechanics** — trigger: travel tracking is working and DMs want more depth. Defer because: niche mechanic, not all hex crawl styles use it.
- [ ] **Paint terrain collaboratively** — trigger: DMs want to build maps live in-session. Defer because: collaborative editing is harder than single-user editing.
- [ ] **Import from Worldographer/other tools** — trigger: DMs have existing hex maps in other formats. Defer because: format parsing is tedious and tool-specific.

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Hex grid display | HIGH | MEDIUM | P1 |
| Terrain types | HIGH | LOW | P1 |
| Fog of war (per-hex) | HIGH | HIGH | P1 |
| DM/Player roles | HIGH | MEDIUM | P1 |
| Real-time sync (WebSocket) | HIGH | HIGH | P1 |
| Token placement | HIGH | MEDIUM | P1 |
| Hex content/notes | HIGH | MEDIUM | P1 |
| Hex content reveal | HIGH | MEDIUM | P1 |
| Campaign persistence | HIGH | MEDIUM | P1 |
| Account auth | HIGH | MEDIUM | P1 |
| Upload map images | HIGH | MEDIUM | P2 |
| Encounter tables + dice | MEDIUM | MEDIUM | P2 |
| Travel/time tracking | MEDIUM | MEDIUM | P2 |
| Weather generation | LOW | LOW | P2 |
| Session URL sharing | MEDIUM | LOW | P2 |
| Individual player tokens | MEDIUM | LOW | P2 |
| Hex numbering | LOW | LOW | P2 |
| Multi-scale zoom | HIGH | VERY HIGH | P3 |
| Influence radius | MEDIUM | HIGH | P3 |
| Navigation/getting lost | MEDIUM | MEDIUM | P3 |
| Collaborative terrain painting | LOW | HIGH | P3 |
| Import from other tools | LOW | MEDIUM | P3 |

**Priority key:**
- P1: Must have for launch — validates the core value proposition
- P2: Should have, add after core is validated
- P3: Nice to have, future consideration (high value but high cost, or depends on P2 features)

## Competitor Feature Analysis

| Feature | Roll20 | Foundry VTT (+ modules) | HEXROLL | Worldographer | Owlbear Rodeo | Hextml | **Our Approach** |
|---------|--------|-------------------------|---------|---------------|---------------|--------|-----------------|
| Hex grid | Yes (basic) | Yes (good) | Yes | Yes (excellent) | Yes | Yes | First-class hex grid, not adapted from square grid |
| Fog of war on hex map | Poor (square-based internally, polygon workaround) | Good via modules (World Explorer, Hexplorer) | Good (two-stage reveal) | No (offline tool) | Good (hex shape fog + Smoke & Spectre persistence) | Basic | Excellent — hex-native, per-hex, two-stage reveal, real-time |
| Real-time multiplayer | Yes | Yes (self-hosted or Forge) | Yes (built-in VTT mode) | No | Yes | Near real-time | Yes — WebSocket, instant sync |
| Multi-scale maps | No | No (separate scenes) | No | Yes (child maps, 3 levels) | No | No | Future (v2+) — seamless zoom between scales |
| Terrain painting | No (image upload only) | No (image upload only) | No (procedural) | Yes (excellent) | No | Yes | Yes — paint terrain on generated grids |
| Encounter tables | Via macros/API | Via modules (Hex-Assist) | Built-in (procedural) | Built-in (basic) | No | No | Built-in, DM-configurable, terrain-aware |
| Hex content/notes | Journal entries (not hex-linked natively) | Journal entries + map pins | Built-in (procedural content per hex) | Hex crawl detail dialog | No | Basic | Per-hex structured content with selective reveal |
| Travel mechanics | No | Via modules (Hex-Assist) | No | No | No | No | Built-in travel/time tracking |
| Token movement | Yes | Yes | Yes (basic) | No | Yes | Yes (drag) | Yes — snap-to-hex, party or individual |
| Navigation/lost | No | Partial (Hex-Assist macro) | No | No | No | No | Future — silent veer mechanic |
| Cost model | Subscription ($6-$10/mo) | One-time ($50) + hosting | Free / Patreon | One-time ($35) | Free / subscription | Free | TBD |
| Purpose | General VTT | General VTT | Procedural sandbox generator | Offline hex map editor | Lightweight VTT | Hex map maker | Hex crawl exploration (focused) |

### Competitive Positioning Summary

No existing product is purpose-built for real-time hex crawl exploration. The landscape breaks down as:

1. **General VTTs (Roll20, Foundry, Owlbear Rodeo):** Powerful but hex crawl is an afterthought. Roll20's hex support is notably poor. Foundry requires cobbling together 3-4 modules. Owlbear Rodeo is lightweight but has no hex-crawl-specific features.

2. **Hex map editors (Worldographer, Hextml, HexGen):** Great for creating maps offline but are not multiplayer exploration tools. No fog of war, no real-time sync, no DM/player role separation.

3. **Procedural generators (HEXROLL, Azgaar):** Generate content but are not exploration-focused session tools. HEXROLL comes closest with its VTT mode but is fundamentally a content generator that added VTT features, not an exploration tool that generates content.

The gap: **A purpose-built, real-time, multiplayer hex crawl exploration tool with first-class fog of war, hex content management, and DM-controlled reveal.** This is the product.

## Sources

- [RPG PUB: VTT exploratory hexcrawl discussion](https://www.rpgpub.com/threads/vtt-exploratory-hexcrawl-how.9511/) — community discussion of hex crawl VTT approaches
- [Foundry VTT: World Explorer module](https://foundryvtt.com/packages/world-explorer) — manual fog of war for hex crawl
- [Foundry VTT: Hexplorer module](https://foundryvtt.com/packages/hexplorer) — hex exploration toolkit
- [Foundry VTT: Hex Crawl Assist module](https://foundryvtt.com/packages/Hex-Assist) — automated hex crawl mechanics
- [Foundry VTT: Hexploration module](https://foundryvtt.com/packages/hexploration) — hex vision restriction
- [Foundry VTT: Pathfinder Kingmaker module](https://foundryvtt.com/packages/pf2e-kingmaker) — hex exploration with custom fog
- [HEXROLL 2E](https://hexroll.app/) — procedural hex sandbox with built-in VTT
- [HEXROLL VTT Projection docs](https://docs.hexroll.app/playing-with-hexroll/vtt-projection/) — how HEXROLL's real-time sharing works
- [Roll20 community: Fog of War on hex maps](https://app.roll20.net/forum/post/10529444/fog-of-war-on-hex-map-deserves-some-tough-love) — user complaints about hex fog
- [Roll20 Wiki: Fog of War](https://wiki.roll20.net/Fog_of_War) — Roll20's fog documentation
- [Roll20 Wiki: Advanced Fog of War](https://wiki.roll20.net/Advanced_Fog_of_War) — Roll20's dynamic fog (square-grid-based)
- [Owlbear Rodeo: Fog documentation](https://docs.owlbear.rodeo/docs/fog/) — hex-shaped fog support
- [Owlbear Rodeo: Smoke & Spectre extension](https://extensions.owlbear.rodeo/smoke) — persistence/trailing fog for exploration
- [Owlbear Rodeo 2.3: Dynamic Fog](https://blog.owlbear.rodeo/owlbear-rodeo-2-3-release-week-day-3/) — GPU-accelerated fog
- [Inkwell Ideas: Hexographer vs Worldographer](https://inkwellideas.com/2018/06/hexographer-vs-worldographer/) — feature comparison
- [Worldographer: How Map Levels Work](https://worldographer.com/instructions/how-map-levels-work/) — multi-level/child map documentation
- [Worldographer: Picking a Hex Map Scale](https://worldographer.com/2022/10/picking-a-fantasy-hex-map-scale/) — hex scale guidance
- [Worldographer: Hex Crawl Details](https://worldographer.com/instructions/how-to-add-edit-hex-crawl-details/) — hex content editing
- [The Alexandrian: Hexcrawl series](https://thealexandrian.net/wordpress/17308/roleplaying-games/hexcrawl) — definitive hex crawl framework
- [The Alexandrian: Navigating the Wilderness](https://thealexandrian.net/wordpress/17329/roleplaying-games/hexcrawl-part-3-navigating-the-wilderness) — navigation/getting lost rules
- [The Alexandrian: Wilderness Travel](https://thealexandrian.net/wordpress/17320/roleplaying-games/hexcrawl-part-2-wilderness-travel) — travel mechanics
- [Hextml](https://hextml.playest.net/) — online collaborative hex map maker
- [Hex Crawler (NullSheen)](https://www.nullsheen.com/tools/hex-crawler/) — hex generation and exploration tool
- [HexGen Free](https://arminprime.itch.io/hexgen) — hex map editor with terrain painting
- [Awesome-Hexcrawl GitHub](https://github.com/HextoryWorld/Awesome-Hexcrawl) — curated hex crawl resource list
- [Prismatic Wasteland: Hexcrawl Checklist](https://www.prismaticwasteland.com/blog/hexcrawl-checklist-part-one) — structured hex crawl procedures
- [Sly Flourish: Running Hex Crawls](https://slyflourish.com/hex_crawling.html) — simplified hex crawl approach
- [Cairn RPG: Hexcrawl Procedures](https://cairnrpg.com/hacks/third-party/hexcrawl-procedures/) — lightweight hex crawl rules
- [Engine of Oracles: Hex Maps at Three Scales](https://engineoforacles.wordpress.com/2019/06/17/hex-maps-of-the-ultimate-west-at-three-different-scales/) — multi-scale hex map example
- [EN World: Preferred scale for hexcrawling](https://www.enworld.org/threads/preferred-scale-for-hexcrawling.273611/) — community discussion of hex scales
- [EN World: DMG hex scale templates](https://www.enworld.org/threads/templates-for-dmg-recommended-wilderness-hex-scale.396138/) — hex scale nesting analysis
- [Figma: How multiplayer technology works](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/) — WebSocket architecture reference
- [Azgaar's Fantasy Map Generator](https://azgaar.github.io/Fantasy-Map-Generator/) — procedural map generation (not hex-native)

---
*Feature research for: Hex crawl exploration web application*
*Researched: 2026-01-26*
