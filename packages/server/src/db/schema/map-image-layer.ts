import { pgTable, text, integer, real, boolean, timestamp } from "drizzle-orm/pg-core";
import { campaignMap } from "./map";

export const mapImageLayer = pgTable("map_image_layer", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  mapId: text("map_id")
    .notNull()
    .references(() => campaignMap.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  storageKey: text("storage_key").notNull(),
  contentType: text("content_type").notNull(),
  fileSize: integer("file_size").notNull(),
  offsetX: real("offset_x").notNull().default(0),
  offsetY: real("offset_y").notNull().default(0),
  scaleX: real("scale_x").notNull().default(1.0),
  scaleY: real("scale_y").notNull().default(1.0),
  sortOrder: integer("sort_order").notNull().default(0),
  visible: boolean("visible").notNull().default(true),
  playerVisible: boolean("player_visible").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
