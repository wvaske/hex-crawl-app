import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { campaign, campaignMember } from "../db/schema/index.js";
import { requireAuth } from "../middleware/auth.js";
import type { AppVariables } from "../app.js";

const campaigns = new Hono<{ Variables: AppVariables }>()
  .use("*", requireAuth)
  .post(
    "/",
    zValidator("json", z.object({ name: z.string().min(1).max(100) })),
    async (c) => {
      const user = c.get("user")!;
      const { name } = c.req.valid("json");
      const id = crypto.randomUUID();

      await db.transaction(async (tx) => {
        await tx.insert(campaign).values({
          id,
          name,
          ownerId: user.id,
        });
        await tx.insert(campaignMember).values({
          id: crypto.randomUUID(),
          campaignId: id,
          userId: user.id,
          role: "dm",
        });
      });

      return c.json({ id, name, ownerId: user.id }, 201);
    }
  )
  .get("/", async (c) => {
    const user = c.get("user")!;

    const results = await db
      .select()
      .from(campaignMember)
      .innerJoin(campaign, eq(campaign.id, campaignMember.campaignId))
      .where(eq(campaignMember.userId, user.id));

    return c.json({
      campaigns: results.map((r) => ({
        id: r.campaign.id,
        name: r.campaign.name,
        ownerId: r.campaign.ownerId,
        role: r.campaign_member.role,
        createdAt: r.campaign.createdAt,
      })),
    });
  })
  .get("/:id", async (c) => {
    const user = c.get("user")!;
    const campaignId = c.req.param("id");

    const results = await db
      .select()
      .from(campaignMember)
      .innerJoin(campaign, eq(campaign.id, campaignMember.campaignId))
      .where(eq(campaignMember.campaignId, campaignId));

    const membership = results.find((r) => r.campaign_member.userId === user.id);
    if (!membership) {
      return c.json({ error: "Not found" }, 404);
    }

    return c.json({
      id: membership.campaign.id,
      name: membership.campaign.name,
      ownerId: membership.campaign.ownerId,
      role: membership.campaign_member.role,
      createdAt: membership.campaign.createdAt,
    });
  });

export default campaigns;
