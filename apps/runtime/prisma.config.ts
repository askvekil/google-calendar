import { defineConfig } from "prisma/config";
import { loadRuntimeEnvironment } from "./src/config/load-environment";

loadRuntimeEnvironment();

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations"
  },
  datasource: {
    url: process.env.GOOGLE_CALENDAR_RUNTIME_DATABASE_URL ?? ""
  }
});
