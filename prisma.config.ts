import { defineConfig } from "prisma/config";

// The connection URL lives here (Prisma 7), not in schema.prisma.
// `prisma validate` / `generate` do not need a live DB, so fall back to a placeholder.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    url: process.env.DATABASE_URL ?? "postgresql://placeholder:placeholder@localhost:5432/placeholder",
  },
});
