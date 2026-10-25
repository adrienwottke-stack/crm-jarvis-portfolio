import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Migrationen laufen über die direkte Verbindung (Session Pooler),
    // die App selbst nutzt DATABASE_URL (Transaction Pooler).
    url: process.env["DIRECT_URL"] ?? process.env["DATABASE_URL"],
  },
});
