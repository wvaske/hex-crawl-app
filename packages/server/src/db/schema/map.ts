import { pgTable, text, integer, real, boolean, timestamp } from "drizzle-orm/pg-core";
import { campaign } from "./campaign";

export const campaignMap = pgTable("campaign_map", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  campaignId: text("campaign_id")
    .notNull()
    .references(() => campaign.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  gridLineColor: text("grid_line_color").notNull().default("#ffffff"),
  gridLineThickness: real("grid_line_thickness").notNull().default(1.0),
  gridLineOpacity: real("grid_line_opacity").notNull().default(0.4),
  terrainOverlayEnabled: boolean("terrain_overlay_enabled").notNull().default(false),
  terrainOverlayOpacity: real("terrain_overlay_opacity").notNull().default(0.3),
  gridOffsetX: real("grid_offset_x").notNull().default(0),
  gridOffsetY: real("grid_offset_y").notNull().default(0),
  hexSizeX: real("hex_size_x").notNull().default(40),
  hexSizeY: real("hex_size_y").notNull().default(40),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
