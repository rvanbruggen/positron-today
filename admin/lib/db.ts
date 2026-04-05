import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.DATABASE_URL ?? "file:../local.db",
  authToken: process.env.DATABASE_AUTH_TOKEN,
});

export default db;
