import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { db } from "../db/index.js";
import { campaign, campaignMember, campaignHex } from "../db/schema/index.js";
import { requireAuth } from "../middleware/auth.js";
import type { AppVariables } from "../app.js";

const mapRoutes = new Hono<{ Variables: AppVariables }>()
  .use("*", requireAuth)
  .post(
    "/:id/map",
    zValidator(
      "json",
      z.object({
        hexes: z.array(
          z.object({
            key: z.string(),
            terrain: z.string(),
            terrainVariant: z.number().int().default(0),
          })
        ),
      })
    ),
    async (c) => {
      const user = c.get("user")!;
      const campaignId = c.req.param("id");

      // Verify user is DM of campaign
      const membership = await db
        .select()
        .from(campaignMember)
        .where(
          and(
            eq(campaignMember.campaignId, campaignId),
            eq(campaignMember.userId, user.id)
          )
        )
        .limit(1);

      if (!membership.length || membership[0].role !== "dm") {
        return c.json({ error: "Forbidden" }, 403);
      }

      const { hexes } = c.req.valid("json");

      await db.transaction(async (tx) => {
        // Delete existing hex data for this campaign
        await tx
          .delete(campaignHex)
          .where(eq(campaignHex.campaignId, campaignId));

        // Insert new hex data
        if (hexes.length > 0) {
          await tx.insert(campaignHex).values(
            hexes.map((h) => ({
              id: crypto.randomUUID(),
              campaignId,
              hexKey: h.key,
              terrain: h.terrain,
              terrainVariant: h.terrainVariant,
            }))
          );
        }
      });

      return c.json({ ok: true });
    }
  )
  .get("/:id/map", async (c) => {
    const user = c.get("user")!;
    const campaignId = c.req.param("id");

    // Verify user is member of campaign
    const membership = await db
      .select()
      .from(campaignMember)
      .where(
        and(
          eq(campaignMember.campaignId, campaignId),
          eq(campaignMember.userId, user.id)
        )
      )
      .limit(1);

    if (!membership.length) {
      return c.json({ error: "Not found" }, 404);
    }

    const rows = await db
      .select()
      .from(campaignHex)
      .where(eq(campaignHex.campaignId, campaignId));

    return c.json({
      hexes: rows.map((r) => ({
        key: r.hexKey,
        terrain: r.terrain,
        terrainVariant: r.terrainVariant,
      })),
    });
  });

export default mapRoutes;
