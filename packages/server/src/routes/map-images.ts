import { Hono } from "hono";
import { eq, and, desc, max } from "drizzle-orm";
import { db } from "../db/index.js";
import { campaignMap, mapImageLayer, campaignMember } from "../db/schema/index.js";
import { requireAuth } from "../middleware/auth.js";
import type { AppVariables } from "../app.js";
import { LocalStorageBackend } from "../storage/local.js";
import { sessionManager } from "../ws/session-manager.js";

const storage = new LocalStorageBackend("./uploads", "/uploads");

/** Broadcast a layer event to all clients in the campaign room, filtering playerVisible for non-DM */
function broadcastLayerEvent(
  campaignId: string,
  type: "layer:added" | "layer:updated" | "layer:removed",
  payload: Record<string, unknown>,
  playerVisible?: boolean,
) {
  // For layer:added, only send to players if playerVisible is true
  if (type === "layer:added" && playerVisible === false) {
    sessionManager.broadcastToDM(campaignId, { type, ...payload } as never);
  } else {
    sessionManager.broadcastToAll(campaignId, { type, ...payload } as never);
  }
}

function broadcastMapUpdated(campaignId: string, mapId: string, updates: Record<string, unknown>) {
  sessionManager.broadcastToAll(campaignId, {
    type: "map:updated",
    mapId,
    updates,
  } as never);
}

const ALLOWED_EXTENSIONS = new Set(["png", "jpg", "jpeg"]);

/** Helper: verify campaign membership, return role or null */
async function getMemberRole(campaignId: string, userId: string) {
  const rows = await db
    .select()
    .from(campaignMember)
    .where(
      and(
        eq(campaignMember.campaignId, campaignId),
        eq(campaignMember.userId, userId),
      ),
    )
    .limit(1);
  return rows.length ? rows[0].role : null;
}

const mapImages = new Hono<{ Variables: AppVariables }>()
  .use("*", requireAuth)

  // ---- Campaign Maps CRUD ----

  // Create a new campaign map
  .post("/:campaignId/maps", async (c) => {
    const user = c.get("user")!;
    const campaignId = c.req.param("campaignId");
    const role = await getMemberRole(campaignId, user.id);
    if (role !== "dm") return c.json({ error: "Forbidden" }, 403);

    const body = await c.req.json<{ name: string }>();
    if (!body.name) return c.json({ error: "Name required" }, 400);

    // Inherit grid settings from most recent map in campaign
    const existing = await db
      .select()
      .from(campaignMap)
      .where(eq(campaignMap.campaignId, campaignId))
      .orderBy(desc(campaignMap.createdAt))
      .limit(1);

    const defaults = existing.length
      ? {
          gridLineColor: existing[0].gridLineColor,
          gridLineThickness: existing[0].gridLineThickness,
          gridLineOpacity: existing[0].gridLineOpacity,
          terrainOverlayEnabled: existing[0].terrainOverlayEnabled,
          terrainOverlayOpacity: existing[0].terrainOverlayOpacity,
          hexSizeX: existing[0].hexSizeX,
          hexSizeY: existing[0].hexSizeY,
        }
      : {};

    // Determine next sortOrder
    const maxSort = await db
      .select({ val: max(campaignMap.sortOrder) })
      .from(campaignMap)
      .where(eq(campaignMap.campaignId, campaignId));
    const nextSort = (maxSort[0]?.val ?? -1) + 1;

    const id = crypto.randomUUID();
    const [row] = await db
      .insert(campaignMap)
      .values({
        id,
        campaignId,
        name: body.name,
        sortOrder: nextSort,
        ...defaults,
      })
      .returning();

    return c.json(row, 201);
  })

  // List maps for campaign
  .get("/:campaignId/maps", async (c) => {
    const user = c.get("user")!;
    const campaignId = c.req.param("campaignId");
    const role = await getMemberRole(campaignId, user.id);
    if (!role) return c.json({ error: "Not found" }, 404);

    const rows = await db
      .select()
      .from(campaignMap)
      .where(eq(campaignMap.campaignId, campaignId))
      .orderBy(campaignMap.sortOrder);

    return c.json({ maps: rows });
  })

  // Update map properties
  .patch("/:campaignId/maps/:mapId", async (c) => {
    const user = c.get("user")!;
    const campaignId = c.req.param("campaignId");
    const mapId = c.req.param("mapId");
    const role = await getMemberRole(campaignId, user.id);
    if (role !== "dm") return c.json({ error: "Forbidden" }, 403);

    const body = await c.req.json();
    const allowed = [
      "name", "sortOrder",
      "gridLineColor", "gridLineThickness", "gridLineOpacity",
      "terrainOverlayEnabled", "terrainOverlayOpacity",
      "gridOffsetX", "gridOffsetY", "hexSizeX", "hexSizeY",
    ] as const;

    const updates: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in body) updates[key] = body[key];
    }

    if (Object.keys(updates).length === 0) {
      return c.json({ error: "No valid fields to update" }, 400);
    }

    const [row] = await db
      .update(campaignMap)
      .set(updates)
      .where(and(eq(campaignMap.id, mapId), eq(campaignMap.campaignId, campaignId)))
      .returning();

    if (!row) return c.json({ error: "Not found" }, 404);
    broadcastMapUpdated(campaignId, mapId, updates);
    return c.json(row);
  })

  // ---- Image Layer CRUD ----

  // Upload image
  .post("/:campaignId/maps/:mapId/images", async (c) => {
    const user = c.get("user")!;
    const campaignId = c.req.param("campaignId");
    const mapId = c.req.param("mapId");
    const role = await getMemberRole(campaignId, user.id);
    if (role !== "dm") return c.json({ error: "Forbidden" }, 403);

    const body = await c.req.parseBody();
    const file = body["file"];
    if (!(file instanceof File)) {
      return c.json({ error: "File required" }, 400);
    }

    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return c.json({ error: "Only png/jpg/jpeg allowed" }, 400);
    }

    const storageKey = `maps/${mapId}/${crypto.randomUUID()}.${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    await storage.put(storageKey, buffer, file.type);

    // Determine next sortOrder
    const maxSort = await db
      .select({ val: max(mapImageLayer.sortOrder) })
      .from(mapImageLayer)
      .where(eq(mapImageLayer.mapId, mapId));
    const nextSort = (maxSort[0]?.val ?? -1) + 1;

    const [layer] = await db
      .insert(mapImageLayer)
      .values({
        id: crypto.randomUUID(),
        mapId,
        fileName: file.name,
        storageKey,
        contentType: file.type,
        fileSize: buffer.length,
        sortOrder: nextSort,
      })
      .returning();

    const layerWithUrl = { ...layer, url: storage.getUrl(storageKey) };
    broadcastLayerEvent(campaignId, "layer:added", { layer: layerWithUrl }, layer.playerVisible);
    return c.json(layerWithUrl, 201);
  })

  // List image layers for map
  .get("/:campaignId/maps/:mapId/images", async (c) => {
    const user = c.get("user")!;
    const campaignId = c.req.param("campaignId");
    const role = await getMemberRole(campaignId, user.id);
    if (!role) return c.json({ error: "Not found" }, 404);

    const isDM = role === "dm";

    let rows = await db
      .select()
      .from(mapImageLayer)
      .where(eq(mapImageLayer.mapId, c.req.param("mapId")))
      .orderBy(mapImageLayer.sortOrder);

    if (!isDM) {
      rows = rows.filter((r) => r.playerVisible);
    }

    return c.json({
      layers: rows.map((r) => ({ ...r, url: storage.getUrl(r.storageKey) })),
    });
  })

  // Update layer properties
  .patch("/:campaignId/maps/:mapId/images/:layerId", async (c) => {
    const user = c.get("user")!;
    const campaignId = c.req.param("campaignId");
    const layerId = c.req.param("layerId");
    const role = await getMemberRole(campaignId, user.id);
    if (role !== "dm") return c.json({ error: "Forbidden" }, 403);

    const body = await c.req.json();
    const allowed = [
      "offsetX", "offsetY", "scaleX", "scaleY",
      "sortOrder", "visible", "playerVisible",
    ] as const;

    const updates: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in body) updates[key] = body[key];
    }

    if (Object.keys(updates).length === 0) {
      return c.json({ error: "No valid fields to update" }, 400);
    }

    const [row] = await db
      .update(mapImageLayer)
      .set(updates)
      .where(eq(mapImageLayer.id, layerId))
      .returning();

    if (!row) return c.json({ error: "Not found" }, 404);
    broadcastLayerEvent(campaignId, "layer:updated", { layerId, updates: { ...updates, url: storage.getUrl(row.storageKey) } }, row.playerVisible);
    return c.json({ ...row, url: storage.getUrl(row.storageKey) });
  })

  // Delete layer
  .delete("/:campaignId/maps/:mapId/images/:layerId", async (c) => {
    const user = c.get("user")!;
    const campaignId = c.req.param("campaignId");
    const layerId = c.req.param("layerId");
    const role = await getMemberRole(campaignId, user.id);
    if (role !== "dm") return c.json({ error: "Forbidden" }, 403);

    const [row] = await db
      .delete(mapImageLayer)
      .where(eq(mapImageLayer.id, layerId))
      .returning();

    if (!row) return c.json({ error: "Not found" }, 404);

    await storage.delete(row.storageKey);
    broadcastLayerEvent(campaignId, "layer:removed", { layerId });
    return c.body(null, 204);
  });

export default mapImages;
