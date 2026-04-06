import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.DATABASE_URL ?? "file:../local.db",
  authToken: process.env.DATABASE_AUTH_TOKEN,
});

export default db;

// Run schema migrations once at module load time so every route
// that imports db gets a fully-initialised database regardless of
// which page is visited first.
// We import lazily to avoid a circular dependency (schema → db → schema).
import("./schema").then(({ initSchema }) => initSchema()).catch(console.error);
