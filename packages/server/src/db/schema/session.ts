import { pgTable, pgEnum, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { campaign } from "./campaign";
import { user } from "./auth";

export const sessionStatusEnum = pgEnum("session_status", [
  "active",
  "paused",
  "ended",
]);

export const gameSession = pgTable("game_session", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id")
    .notNull()
    .references(() => campaign.id, { onDelete: "cascade" }),
  startedBy: text("started_by")
    .notNull()
    .references(() => user.id),
  status: sessionStatusEnum("status").notNull().default("active"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  endedAt: timestamp("ended_at"),
});

export const sessionEventTypeEnum = pgEnum("session_event_type", [
  "session_start",
  "session_pause",
  "session_resume",
  "session_end",
  "hex_reveal",
  "hex_update",
  "player_join",
  "player_leave",
  "token_move",
]);

export const sessionEvent = pgTable(
  "session_event",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => gameSession.id, { onDelete: "cascade" }),
    eventType: sessionEventTypeEnum("event_type").notNull(),
    userId: text("user_id").references(() => user.id),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("session_event_session_idx").on(table.sessionId),
    index("session_event_created_idx").on(table.createdAt),
  ]
);
