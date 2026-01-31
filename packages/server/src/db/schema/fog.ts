import { pgTable, text, timestamp, index, unique } from "drizzle-orm/pg-core";
import { campaign } from "./campaign";
import { user } from "./auth";

export const hexVisibility = pgTable(
  "hex_visibility",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaign.id, { onDelete: "cascade" }),
    hexKey: text("hex_key").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    revealedBy: text("revealed_by")
      .notNull()
      .references(() => user.id),
    revealedAt: timestamp("revealed_at").defaultNow().notNull(),
  },
  (table) => [
    index("hex_visibility_campaign_idx").on(table.campaignId),
    index("hex_visibility_campaign_user_idx").on(
      table.campaignId,
      table.userId
    ),
    unique("hex_visibility_unique").on(
      table.campaignId,
      table.hexKey,
      table.userId
    ),
  ]
);
