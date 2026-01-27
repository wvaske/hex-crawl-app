import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { campaign } from "./campaign";
import { user } from "./auth";

export const invitation = pgTable("invitation", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id")
    .notNull()
    .references(() => campaign.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  invitedBy: text("invited_by")
    .notNull()
    .references(() => user.id),
  status: text("status", { enum: ["pending", "accepted", "declined"] })
    .notNull()
    .default("pending"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at"),
});
