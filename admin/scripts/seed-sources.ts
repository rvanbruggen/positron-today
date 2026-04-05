import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.DATABASE_URL ?? "file:../local.db",
});

const sources = [
  { name: "De Standaard", url: "https://www.standaard.be/", type: "website", language: "nl" },
  { name: "De Morgen", url: "https://www.demorgen.be/", type: "website", language: "nl" },
  { name: "Het Laatste Nieuws", url: "https://www.hln.be/", type: "website", language: "nl" },
  { name: "Het Belang van Limburg", url: "https://www.hbvl.be/", type: "website", language: "nl" },
  { name: "Le Soir", url: "https://www.lesoir.be/", type: "website", language: "fr" },
  { name: "L'Echo", url: "https://www.lecho.be/", type: "website", language: "fr" },
  { name: "De Tijd", url: "https://www.tijd.be/", type: "website", language: "nl" },
  { name: "The New York Times", url: "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml", type: "rss", language: "en" },
  { name: "The Washington Post", url: "https://feeds.washingtonpost.com/rss/world", type: "rss", language: "en" },
  { name: "Le Figaro", url: "https://www.lefigaro.fr/rss/figaro_actualites.xml", type: "rss", language: "fr" },
  { name: "CNN", url: "http://rss.cnn.com/rss/edition.rss", type: "rss", language: "en" },
  { name: "Humo", url: "https://www.humo.be/", type: "website", language: "nl" },
  { name: "Dansende Beren", url: "https://www.dansendeberen.be/", type: "website", language: "nl" },
];

async function seed() {
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      url TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL CHECK(type IN ('rss', 'website')),
      language TEXT NOT NULL DEFAULT 'en',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  let added = 0;
  for (const source of sources) {
    try {
      await db.execute({
        sql: "INSERT INTO sources (name, url, type, language) VALUES (?, ?, ?, ?)",
        args: [source.name, source.url, source.type, source.language],
      });
      console.log(`+ ${source.name}`);
      added++;
    } catch {
      console.log(`- ${source.name} (already exists)`);
    }
  }
  console.log(`\nDone. ${added} sources added.`);
}

seed().catch(console.error);
