import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  campaign,
  campaignMember,
  invitation,
} from "../db/schema/index.js";
import { requireAuth } from "../middleware/auth.js";
import type { AppVariables } from "../app.js";

const invitations = new Hono<{ Variables: AppVariables }>()
  .use("*", requireAuth)

  // POST /campaigns/:campaignId/invitations -- DM invites a player by email
  .post(
    "/campaigns/:campaignId/invitations",
    zValidator("json", z.object({ email: z.string().email() })),
    async (c) => {
      const user = c.get("user")!;
      const campaignId = c.req.param("campaignId");
      const { email } = c.req.valid("json");

      // Verify the authenticated user is a DM of this campaign
      const [membership] = await db
        .select()
        .from(campaignMember)
        .where(
          and(
            eq(campaignMember.campaignId, campaignId),
            eq(campaignMember.userId, user.id),
            eq(campaignMember.role, "dm")
          )
        );

      if (!membership) {
        return c.json(
          { error: "Forbidden: only DMs can invite players" },
          403
        );
      }

      // Check if invitation already exists (same campaign + email + status "pending")
      const [existing] = await db
        .select()
        .from(invitation)
        .where(
          and(
            eq(invitation.campaignId, campaignId),
            eq(invitation.email, email),
            eq(invitation.status, "pending")
          )
        );

      if (existing) {
        return c.json(
          { error: "Invitation already pending for this email" },
          409
        );
      }

      const id = crypto.randomUUID();

      await db.insert(invitation).values({
        id,
        campaignId,
        email,
        invitedBy: user.id,
        status: "pending",
      });

      return c.json({ invitation: { id, email, status: "pending" } }, 201);
    }
  )

  // GET /campaigns/:campaignId/invitations -- DM lists invitations for a campaign
  .get("/campaigns/:campaignId/invitations", async (c) => {
    const user = c.get("user")!;
    const campaignId = c.req.param("campaignId");

    // Verify the authenticated user is a DM of this campaign
    const [membership] = await db
      .select()
      .from(campaignMember)
      .where(
        and(
          eq(campaignMember.campaignId, campaignId),
          eq(campaignMember.userId, user.id),
          eq(campaignMember.role, "dm")
        )
      );

    if (!membership) {
      return c.json(
        { error: "Forbidden: only DMs can view invitations" },
        403
      );
    }

    const results = await db
      .select()
      .from(invitation)
      .where(eq(invitation.campaignId, campaignId));

    return c.json({
      invitations: results.map((inv) => ({
        id: inv.id,
        email: inv.email,
        status: inv.status,
        createdAt: inv.createdAt,
      })),
    });
  })

  // GET /campaigns/:campaignId/members -- List campaign members
  .get("/campaigns/:campaignId/members", async (c) => {
    const user = c.get("user")!;
    const campaignId = c.req.param("campaignId");

    // Verify the authenticated user is a member of this campaign
    const [membership] = await db
      .select()
      .from(campaignMember)
      .where(
        and(
          eq(campaignMember.campaignId, campaignId),
          eq(campaignMember.userId, user.id)
        )
      );

    if (!membership) {
      return c.json({ error: "Not found" }, 404);
    }

    const results = await db
      .select()
      .from(campaignMember)
      .where(eq(campaignMember.campaignId, campaignId));

    return c.json({
      members: results.map((m) => ({
        id: m.id,
        userId: m.userId,
        role: m.role,
        joinedAt: m.joinedAt,
      })),
    });
  })

  // GET /invitations/pending -- List current user's pending invitations
  .get("/invitations/pending", async (c) => {
    const user = c.get("user")!;
    const userEmail = user.email;

    const results = await db
      .select()
      .from(invitation)
      .innerJoin(campaign, eq(campaign.id, invitation.campaignId))
      .where(
        and(
          eq(invitation.email, userEmail),
          eq(invitation.status, "pending")
        )
      );

    return c.json({
      invitations: results.map((r) => ({
        id: r.invitation.id,
        campaignId: r.invitation.campaignId,
        campaignName: r.campaign.name,
        invitedBy: r.invitation.invitedBy,
        createdAt: r.invitation.createdAt,
      })),
    });
  })

  // POST /invitations/:id/accept -- Accept an invitation
  .post("/invitations/:id/accept", async (c) => {
    const user = c.get("user")!;
    const invitationId = c.req.param("id");

    const [inv] = await db
      .select()
      .from(invitation)
      .where(
        and(
          eq(invitation.id, invitationId),
          eq(invitation.email, user.email),
          eq(invitation.status, "pending")
        )
      );

    if (!inv) {
      return c.json({ error: "Invitation not found" }, 404);
    }

    await db.transaction(async (tx) => {
      await tx
        .update(invitation)
        .set({ status: "accepted" })
        .where(eq(invitation.id, invitationId));

      await tx.insert(campaignMember).values({
        id: crypto.randomUUID(),
        campaignId: inv.campaignId,
        userId: user.id,
        role: "player",
      });
    });

    return c.json({ campaignId: inv.campaignId, role: "player" });
  })

  // POST /invitations/:id/decline -- Decline an invitation
  .post("/invitations/:id/decline", async (c) => {
    const user = c.get("user")!;
    const invitationId = c.req.param("id");

    const [inv] = await db
      .select()
      .from(invitation)
      .where(
        and(
          eq(invitation.id, invitationId),
          eq(invitation.email, user.email),
          eq(invitation.status, "pending")
        )
      );

    if (!inv) {
      return c.json({ error: "Invitation not found" }, 404);
    }

    await db
      .update(invitation)
      .set({ status: "declined" })
      .where(eq(invitation.id, invitationId));

    return c.json({ success: true });
  });

export default invitations;
