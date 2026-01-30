import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "./db/index.js";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    autoSignIn: true,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // refresh every 24h
  },
  trustedOrigins:
    process.env.NODE_ENV !== "production"
      ? ["*"]
      : (process.env.ALLOWED_ORIGINS ?? "http://localhost:5173")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
});
