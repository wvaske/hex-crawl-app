import { pgTable, text, integer, index, unique } from "drizzle-orm/pg-core";
import { campaign } from "./campaign";

export const campaignHex = pgTable(
  "campaign_hex",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaign.id, { onDelete: "cascade" }),
    hexKey: text("hex_key").notNull(),
    terrain: text("terrain").notNull(),
    terrainVariant: integer("terrain_variant").notNull().default(0),
  },
  (table) => [
    index("campaign_hex_campaign_idx").on(table.campaignId),
    unique("campaign_hex_unique").on(table.campaignId, table.hexKey),
  ]
);
