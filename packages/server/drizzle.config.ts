import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: [
    "./src/db/schema/auth.ts",
    "./src/db/schema/campaign.ts",
    "./src/db/schema/invitation.ts",
    "./src/db/schema/session.ts",
    "./src/db/schema/fog.ts",
    "./src/db/schema/hex-data.ts",
    "./src/db/schema/token.ts",
  ],
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
