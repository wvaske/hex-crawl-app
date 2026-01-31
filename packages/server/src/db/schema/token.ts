import { pgTable, text, boolean, index } from "drizzle-orm/pg-core";
import { campaign } from "./campaign";
import { user } from "./auth";

export const campaignToken = pgTable(
  "campaign_token",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaign.id, { onDelete: "cascade" }),
    hexKey: text("hex_key").notNull(),
    ownerId: text("owner_id").references(() => user.id, {
      onDelete: "set null",
    }),
    label: text("label").notNull(),
    icon: text("icon").notNull().default("⚔️"),
    color: text("color").notNull().default("#ff0000"),
    tokenType: text("token_type", { enum: ["pc", "npc"] })
      .notNull()
      .default("pc"),
    visible: boolean("visible").notNull().default(true),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
  },
  (table) => [
    index("campaign_token_campaign_idx").on(table.campaignId),
  ]
);
