import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.DATABASE_URL ?? "file:../local.db",
  authToken: process.env.DATABASE_AUTH_TOKEN,
});

export default db;

// Assert foreign-key enforcement explicitly. @libsql/client currently enables
// it by default (unlike the stock sqlite3 CLI, where PRAGMA foreign_keys is OFF
// per connection), so ON DELETE CASCADE — e.g. article_tags → articles — already
// works. This makes the site's correctness independent of that client default:
// without it, a libsql default change or maintenance through the sqlite3 CLI
// would silently orphan child rows on delete.
//
// Then run schema migrations once at module load time so every route that
// imports db gets a fully-initialised database regardless of which page is
// visited first. schema is imported lazily to avoid a circular dependency
// (schema → db → schema).
db.execute("PRAGMA foreign_keys = ON")
  .then(() => import("./schema"))
  .then(({ initSchema }) => initSchema())
  .catch(console.error);
