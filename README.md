# Positiviteiten 🌟

> A positive-news aggregator that uses AI to filter, summarise, and publish only uplifting stories — while openly logging the negative articles it skips.

**Version:** 0.8.0

---

## Overview

Positiviteiten automatically scans RSS feeds from news sources around the world, filters out negative and anxiety-inducing stories using Claude AI, and publishes the remaining good-news articles to a public website. It also maintains a transparent "What We Skip" log — a public record of every rejected story, illustrating just how skewed mainstream news coverage tends to be.

The project has two parts:

| Part | Tech | Purpose |
|------|------|---------|
| **Admin** (`/admin`) | Next.js 16, TypeScript, Tailwind v4 | Content pipeline, source management, review & publish workflow |
| **Site** (`/site`) | Eleventy v3, Nunjucks, vanilla JS | Public-facing website served via GitHub Pages |

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     ADMIN (Next.js)                      │
│                                                         │
│  Sources → Fetch (RSS) → AI Filter → raw_articles DB   │
│                ↓ rejected                               │
│         rejected_articles DB                            │
│                ↓ export                                 │
│  Preview → Summarise (Claude Sonnet) → articles DB      │
│                ↓ publish                                │
│         GitHub Contents API                             │
└──────────────────┬──────────────────┬───────────────────┘
                   │                  │
         site/src/_data/          site/src/posts/
         rejections.json          YYYY-MM-DD-slug.md
                   │                  │
┌──────────────────▼──────────────────▼───────────────────┐
│                SITE (Eleventy → GitHub Pages)            │
│                                                         │
│  index.njk       — card grid with tag + month filters   │
│  negativity.njk  — "What We Skip" rejection log (EN/NL/FR) │
│  about.njk       — project description                  │
│  contact.njk     — contact page                        │
└─────────────────────────────────────────────────────────┘
```

---

## Prerequisites

- Node.js 18+
- An [Anthropic API key](https://console.anthropic.com/)
- A GitHub Personal Access Token (with `repo` scope) for committing to the site repo
- SQLite (local development) or a [Turso](https://turso.tech/) database (production)

---

## Setup

### 1. Clone

```bash
git clone https://github.com/your-org/positiviteiten.git
cd positiviteiten
```

### 2. Install dependencies

```bash
cd admin && npm install
cd ../site && npm install
```

### 3. Configure environment

Create `admin/.env.local`:

```env
# Database — use file: for local SQLite, or a Turso connection string for production
DATABASE_URL=file:../local.db
DATABASE_AUTH_TOKEN=           # leave empty for local SQLite

# Anthropic (required for AI filtering and summarisation)
ANTHROPIC_API_KEY=sk-ant-...

# GitHub — required for publishing articles and the rejection log to the site repo
GITHUB_TOKEN=ghp_...
GITHUB_REPO=your-org/positiviteiten   # format: owner/repo
GITHUB_BRANCH=main                    # branch to commit to
```

### 4. Initialise the database

The schema is applied automatically when the admin app starts. Just run the dev server and the tables will be created.

### 5. Run locally

```bash
# Terminal 1 — Admin
cd admin
npm run dev          # http://localhost:3000

# Terminal 2 — Public site
cd site
npm run dev          # http://localhost:8080/positiviteiten/
```

---

## Article Pipeline

### Step 1 — Manage sources

Go to **Admin → Sources** and add RSS feeds. Each source has:
- **Name** — display name
- **Website URL** — original site URL
- **Feed URL** — RSS/Atom feed URL (required for auto-fetching)
- **Active** toggle

### Step 2 — Fetch new articles

Click **Fetch New Articles** (or visit **Admin → Preview** and press the button there). The admin:

1. Queries all active sources that have a `feed_url`
2. For each feed, retrieves up to 20 recent items
3. Skips articles already in `raw_articles` or `rejected_articles`
4. Sends each new headline + snippet to **Claude Haiku** with the positivity filter prompt
5. Haiku returns `{"verdict":"YES"}` or `{"verdict":"NO","reason":"..."}`
6. Positive articles → `raw_articles` table (status: pending)
7. Negative articles → `rejected_articles` table with rejection reason
8. After all sources are processed, auto-exports the rejection log to `site/src/_data/rejections.json` via the GitHub API, triggering a site rebuild

Progress is streamed to the browser as newline-delimited JSON (NDJSON) so you see a live log as articles are processed.

### Step 3 — Review and summarise

Go to **Admin → Preview**. For each pending article you can:
- **Summarise** — Claude Sonnet reads the full article URL, writes a 3-5 sentence summary in English, Dutch, and French, suggests topic tags, and adds an emoji
- **Edit** — tweak the title, summary, or tags before publishing
- **Discard** — remove from the queue

### Step 4 — Publish

Click **Publish** on any reviewed article. The admin commits a Markdown file to `site/src/posts/YYYY-MM-DD-slug.md` via the GitHub Contents API. GitHub Actions then rebuilds and deploys the Eleventy site to GitHub Pages within ~1 minute.

---

## Rejection Log ("What We Skip")

Every article rejected by the AI filter is stored in `rejected_articles` and published to the public site at `/positiviteiten/negativity/`.

The rejection log is updated automatically:
1. **After every fetch** — at the end of the fetch pipeline
2. **After every override** — when you approve a rejected article from the Rejections admin page

You can also trigger a manual export from **Admin → Rejections → Export to public site**.

The public page shows:
- Total articles filtered out
- Number of sources scanned
- Each rejected article's title, source, date, and the AI's one-line rejection reason
- Full EN / NL / FR language support

---

## Database Schema

| Table | Purpose |
|-------|---------|
| `sources` | News sources (name, url, feed_url, type, active) |
| `topics` | Manually curated topic tags (name, slug, colour) |
| `raw_articles` | Fetched articles awaiting review (status: pending/discarded) |
| `articles` | Published articles (title, summary_en/nl/fr, tags, published_at) |
| `article_tags` | Many-to-many join between articles and topics |
| `rejected_articles` | Articles rejected by the AI filter (source_name, url, title, snippet, rejection_reason, fetched_at) |

---

## Admin Pages

| Route | Purpose |
|-------|---------|
| `/` | Dashboard — quick stats |
| `/sources` | Manage RSS sources (add, edit inline, toggle active) |
| `/tags` | Manage topic tags |
| `/preview` | Review pending articles, summarise, publish |
| `/rejections` | Browse rejection log, override or delete entries |
| `/scheduled` | Scheduled fetch history |
| `/history` | Published article history |

---

## Public Site Pages

| Page | Purpose |
|------|---------|
| `/` | Home — masonry card grid with tag + month filters |
| `/negativity/` | "What We Skip" — the rejection log (EN/NL/FR) |
| `/about/` | About the project |
| `/contact/` | Contact page |

### Filtering (homepage)

- **Topic tags** — pill buttons above the grid; click to filter by topic (persisted in `localStorage`)
- **Month** — pill buttons showing months with published articles; click to filter by month (persisted in `localStorage`)
- Both filters work together (AND logic)

---

## Deployment

The public site is deployed automatically via GitHub Actions:

- **Workflow:** `.github/workflows/deploy-site.yml`
- **Trigger:** any push to `main` that touches `site/**`
- **Build:** `cd site && npm run build` (Eleventy outputs to `site/_site/`)
- **Deploy:** GitHub Pages from the `gh-pages` branch

The admin is a standard Next.js app — deploy it anywhere (Vercel, Railway, etc.).

---

## Environment Variable Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | SQLite file path (`file:../local.db`) or Turso URL |
| `DATABASE_AUTH_TOKEN` | Turso only | Auth token for Turso cloud database |
| `ANTHROPIC_API_KEY` | Yes | Used for both Haiku (filter) and Sonnet (summarise) |
| `GITHUB_TOKEN` | Yes | PAT with `repo` scope for committing to the site |
| `GITHUB_REPO` | Yes | `owner/repo` format |
| `GITHUB_BRANCH` | No | Target branch (default: `main`) |

---

## Version History

| Version | Highlights |
|---------|-----------|
| **0.8.0** | Configurable LLM providers — pick Anthropic or local Ollama independently for filtering and summarisation; new Settings admin page with Ollama connection test and model browser |
| **0.7.0** | RSS feed support for all sources; streaming fetch progress; rejection log with auto-export; "What We Skip" public page (EN/NL/FR); editable sources; auto-export on fetch and override |
| **0.6.0** | Date/month filter on homepage with localStorage persistence |
| **0.5.2** | Masonry card layout (CSS columns); speech-bubble-star logo |
| **0.5.0** | Tag filtering; deterministic topic colours; many-to-many article_tags |
| **0.4.0** | Multilingual summaries (EN/NL/FR); language switcher |
| **0.3.0** | Claude Sonnet summarisation pipeline |
| **0.2.0** | Admin review workflow; manual URL submission |
| **0.1.0** | Initial release — basic RSS fetch and publish |

---

## Version Tracking

The canonical version lives in **two places** — keep them in sync when bumping:

1. `admin/lib/version.ts` — `export const APP_VERSION = "x.y.z";`
2. `package.json` (root) — `"version": "x.y.z"`
3. This `README.md` — the **Version:** badge at the top and the Version History table

After every version bump:

```bash
git tag vX.Y.Z
git push origin main --follow-tags
```
