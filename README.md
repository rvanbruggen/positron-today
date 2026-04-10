# Positron Today

> A positive-news aggregator that uses AI to filter, summarise, and publish only uplifting stories — while openly logging the negative articles it skips.

**Version:** 1.7.5 · **Live site:** [positron.today](https://positron.today)

---

## Overview

Positron Today automatically scans RSS feeds from news sources around the world, filters out negative and anxiety-inducing stories using an AI model, and publishes the remaining good-news articles to a public website. It also maintains a transparent "What We Skip" log — a public record of every rejected story, illustrating just how skewed mainstream news coverage tends to be.

The project has two parts:

| Part | Tech | Purpose |
|------|------|---------|
| **Admin** (`/admin`) | Next.js 16, TypeScript, Tailwind v4 | Content pipeline, source management, review & publish workflow |
| **Site** (`/site`) | Eleventy v3, Nunjucks, vanilla JS | Public-facing website served via GitHub Pages |

### Why "Positron"?

A positron is the antimatter counterpart of an electron — positively charged, fundamental, always present but invisible. It's a fitting metaphor: positive news exists everywhere, but it rarely surfaces through the noise of mainstream media. Positron Today makes it visible.

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
│  Preview → Summarise (AI model) → articles DB           │
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
│  about.njk       — project description + RSS subscribe  │
│  contact.njk     — contact page                        │
└─────────────────────────────────────────────────────────┘
```

---

## AI Providers

Each task in the pipeline can independently use either **Anthropic** (cloud) or **Ollama** (local, free). You configure this at runtime in **Admin → Settings** — no code changes or restarts needed.

| Task | Recommended local model | Recommended cloud model |
|------|------------------------|------------------------|
| Positivity filter | `llama3.2:3b` (fast, ~2 GB) | Claude Haiku 4.5 |
| Summarisation | `gemma3:27b` (best quality, ~17 GB) | Claude Sonnet 4.6 |

**Ollama** is the free, local option — models run entirely on your machine using Apple Metal on M-series Macs. No API key needed, no per-call cost. Highly recommended for the filter task which runs on every fetched article.

**Anthropic** is the cloud option — higher quality, especially for multilingual summarisation. Requires an API key and has per-token costs.

You can mix and match freely, e.g. Ollama for filtering (high volume, low cost) and Anthropic for summarisation (low volume, higher quality).

---

## Prerequisites

- Node.js 18+
- A GitHub Personal Access Token (with `repo` scope) for committing to the site repo
- SQLite (local development) or a [Turso](https://turso.tech/) database (production)
- **At least one of:**
  - An [Anthropic API key](https://console.anthropic.com/) — for cloud AI (Haiku/Sonnet/Opus)
  - [Ollama](https://ollama.com/) installed locally — for free local AI

---

## Setup

### 1. Clone

```bash
git clone https://github.com/rvanbruggen/positron-today.git
cd positron-today
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

# Anthropic — only required if you use Anthropic as a provider in Settings
ANTHROPIC_API_KEY=sk-ant-...

# GitHub — required for publishing articles and the rejection log to the site repo
GITHUB_TOKEN=ghp_...
GITHUB_REPO=rvanbruggen/positron-today   # format: owner/repo
GITHUB_BRANCH=main                        # branch to commit to
```

### 4. (Optional) Set up Ollama for local AI

If you want to run models locally instead of (or alongside) Anthropic:

```bash
# Install Ollama
brew install ollama

# Start the Ollama server (keep this running in a terminal)
ollama serve

# Pull models — choose based on your available RAM
ollama pull llama3.2:3b    # ~2 GB  — great for the positivity filter
ollama pull gemma3:27b     # ~17 GB — best local quality for summarisation
```

**RAM guide for M-series Macs:**

| Available RAM | Best local summarisation model |
|--------------|-------------------------------|
| 8 GB | `qwen2.5:7b` (~5 GB) |
| 16 GB | `qwen2.5:14b` (~9 GB) |
| 24 GB | `gemma3:27b` (~17 GB) ✓ recommended |
| 32 GB+ | `llama3.3:32b` (~20 GB) |

Once Ollama is running, go to **Admin → Settings**, set the provider for each task, click **Test connection** to verify Ollama is reachable and see your pulled models, then click **Save**.

### 5. Initialise the database

The schema is applied automatically when the admin app starts. Just run the dev server and the tables will be created.

### 6. Run locally

```bash
# From the repo root — starts Admin + Site (Ollama not started by default):
./start.sh

# To also start Ollama (only needed when using a local AI model):
./start.sh --with-ollama

# Stop Admin + Site (Ollama left alone):
./stop.sh

# Stop everything including Ollama:
./stop.sh --with-ollama

# Or manually:
# Terminal 1 — Admin
cd admin && npm run dev          # http://localhost:3000

# Terminal 2 — Ollama (if using local models)
ollama serve                     # http://localhost:11434

# Terminal 3 — Public site (optional, for local preview)
cd site && npm run dev           # http://localhost:8080/
```

`start.sh` launches the admin and public site, and opens the browser automatically once the admin is ready. Pass `--with-ollama` to also start the local Ollama LLM server and open a live activity log in a separate Terminal window.

---

## Article Pipeline

### Step 1 — Manage sources

Go to **Admin → Sources** and add RSS feeds. Each source has:
- **Name** — display name
- **Website URL** — original site URL
- **Feed URL** — RSS/Atom feed URL (required for auto-fetching)
- **Active** toggle

### Step 2 — Configure AI providers (optional)

Go to **Admin → Settings** to choose which AI provider and model to use for each task. The defaults are Anthropic Haiku (filter) and Anthropic Sonnet (summarise). Changes take effect immediately.

### Step 3 — Fetch new articles

Click **Fetch New Articles** on the Preview page. The admin:

1. Queries all active sources that have a `feed_url`
2. For each feed, retrieves up to 20 recent items
3. Skips articles already in `raw_articles` or `rejected_articles`
4. Sends each new headline + snippet to the **configured filter model** with the positivity filter prompt
5. The model returns `{"verdict":"YES"}` or `{"verdict":"NO","reason":"..."}`
6. Positive articles → `raw_articles` table (status: pending)
7. Negative articles → `rejected_articles` table with rejection reason
8. After all sources are processed, auto-exports the rejection log to `site/src/_data/rejections.json` via the GitHub API, triggering a site rebuild

Progress is streamed to the browser as newline-delimited JSON (NDJSON) so you see a live log as articles are processed.

### Step 4 — Review and summarise

Go to **Admin → Preview**. For each pending article you can:
- **Summarise** — the configured summarisation model reads the full article URL, writes a 4-5 sentence summary in English, Dutch, and French, suggests topic tags, adds an emoji, and captures the article's `og:image` thumbnail
- **Edit** — tweak the title, summary, emoji, or tags before publishing
- **Discard** — remove from the queue

### Step 5 — Publish

Click **Publish** on any reviewed article. The admin commits a Markdown file to `site/src/posts/YYYY-MM-DD-slug.md` via the GitHub Contents API. GitHub Actions then rebuilds and deploys the Eleventy site to GitHub Pages within ~1 minute.

Re-publishing an already-published article (after editing) always overwrites the same file — no duplicates are created.

---

## Rejection Log ("What We Skip")

Every article rejected by the AI filter is stored in `rejected_articles` and published to the public site at `/negativity/`.

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
| `articles` | Published articles (title_en/nl/fr, summary_en/nl/fr, emoji, tags, image_url, published_at, published_path) |
| `article_tags` | Many-to-many join between articles and topics |
| `rejected_articles` | Articles rejected by the AI filter (source_name, url, title, snippet, rejection_reason, fetched_at) |
| `settings` | Key-value store for LLM provider/model configuration |

---

## Admin Pages

| Route | Purpose |
|-------|---------|
| `/` | Dashboard — quick stats |
| `/sources` | Manage RSS sources (add, edit inline, toggle active) |
| `/tags` | Manage topic tags |
| `/preview` | Review pending articles, summarise, publish |
| `/rejections` | Browse rejection log, override or delete entries |
| `/scheduled` | Scheduled fetch history with inline article editing |
| `/history` | Published article history with inline editing and re-publish |
| `/settings` | Configure LLM providers and models per task |

---

## Public Site Pages

| Page | Purpose |
|------|---------|
| `/` | Home — card grid (round-robin columns, newest first) with tag + month filters |
| `/negativity/` | "What We Skip" — the rejection log (EN/NL/FR) |
| `/about/` | About the project, the positron metaphor, and RSS subscription links |
| `/contact/` | Contact page |
| `/feed.xml` | RSS feed (English) |
| `/feed-nl.xml` | RSS feed (Dutch) |
| `/feed-fr.xml` | RSS feed (French) |

### Card grid

- Articles are distributed into columns using round-robin JS, so the newest articles always appear across the **top row** (not stacked in the leftmost column)
- Cards show a thumbnail image sourced from the article's `og:image` where available
- **Topic tags** — pill buttons above the grid; click to filter by topic (persisted in `localStorage`)
- **Month** — pill buttons showing months with published articles; click to filter by month

### RSS feeds

All three language editions publish RSS 2.0 feeds. Subscribe directly or use the language-aware RSS link in the site footer. Feed autodiscovery `<link>` tags are included in every page `<head>`.

---

## Deployment

The public site is deployed automatically via GitHub Actions:

- **Workflow:** `.github/workflows/deploy-site.yml`
- **Trigger:** any push to `main` that touches `site/**`
- **Build:** `cd site && npm run build` (Eleventy outputs to `site/_site/`)
- **Deploy:** GitHub Pages from the `gh-pages` branch, served at [positron.today](https://positron.today)

The admin is a standard Next.js app — deploy it anywhere (Vercel, Railway, etc.). Note that Ollama is only available when running the admin locally; a cloud-deployed admin must use Anthropic.

---

## Environment Variable Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | SQLite file path (`file:../local.db`) or Turso URL |
| `DATABASE_AUTH_TOKEN` | Turso only | Auth token for Turso cloud database |
| `ANTHROPIC_API_KEY` | If using Anthropic | Required only when Anthropic is selected as a provider in Settings |
| `GITHUB_TOKEN` | Yes | PAT with `repo` scope for committing to the site |
| `GITHUB_REPO` | Yes | `owner/repo` format |
| `GITHUB_BRANCH` | No | Target branch (default: `main`) |

> **Note:** If you use Ollama for both tasks, `ANTHROPIC_API_KEY` is not needed at all.

---

## Version History

| Version | Highlights |
|---------|-----------|
| **1.7.5** | Make Ollama optional in start.sh/stop.sh; default is without Ollama, use --with-ollama to include it |
| **1.7.4** | Fix fetch progress bar exceeding 100% when sources error |
| **1.7.3** | Translate date-range dropdown, Clear button, and no-match message into NL and FR |
| **1.7.2** | Add social share buttons (X, Bluesky, Facebook, copy-for-Instagram) to article detail page |
| **1.7.1** | Show hero image on article detail page when image_url is present |
| **1.7.0** | Update Instagram handle on contact page to @positron_today |
| **1.6.0** | OpenAI ChatGPT as a third provider option; tunable positivity threshold slider (1–10) with live prompt preview and manual override; editable summarisation voice/style; auto-open browser on `start.sh` |
| **1.5.1** | Bug fixes: source deletion now cascades raw_articles (FK fix); favicon switched to white background; LLM reason crash fixed when model returns object instead of string |
| **1.5.0** | Instagram profile picture (Charged Luminism design philosophy); RSS links in footer and About page |
| **1.4.0** | Article editing UI (inline edit modal on Scheduled and History pages, Save & Republish); trilingual RSS feeds (EN/NL/FR); show only selected tags in Ready-to-publish section |
| **1.3.0** | og:image thumbnails captured during summarisation and displayed on article cards; round-robin column layout so newest articles appear at top row; mobile layout flash fix |
| **1.2.0** | Ollama activity log in separate Terminal window on start; site renamed Positron Today; "Why Positron?" section on About page (EN/NL/FR) |
| **1.1.0** | Source publication dates captured from RSS, shown on cards and in admin tables; date-range filter on homepage; dual dates in History and Rejections admin tables; `start.sh` / `stop.sh` scripts |
| **1.0.0** | Language switcher in nav bar (global, all pages); compact multi-select tag filter; 5 rejection categories; fetch counter and language restore fixes |
| **0.9.0** | Sortable rejections table; stop/reset backfill controls; Ollama model mismatch guard; settings empty-string fallback |
| **0.8.1** | History page redesigned as compact table with live-post link, source, tags, date, Republish / Re-summarise / Remove actions; Remove deletes the GitHub file |
| **0.8.0** | Configurable LLM providers — Anthropic or local Ollama per task; new Settings admin page with connection test and model browser |
| **0.7.0** | RSS feed support for all sources; streaming fetch progress; rejection log with auto-export; "What We Skip" public page (EN/NL/FR) |
| **0.6.0** | Date/month filter on homepage with localStorage persistence |
| **0.5.2** | Card layout; atom logo |
| **0.5.0** | Tag filtering; deterministic topic colours; many-to-many article_tags |
| **0.4.0** | Multilingual summaries (EN/NL/FR); language switcher |
| **0.3.0** | Claude Sonnet summarisation pipeline |
| **0.2.0** | Admin review workflow; manual URL submission |
| **0.1.0** | Initial release — basic RSS fetch and publish |

---

## Version Tracking

The canonical version lives in **three places** — keep them in sync when bumping:

1. `admin/lib/version.ts` — `export const APP_VERSION = "x.y.z";`
2. `package.json` (root) — `"version": "x.y.z"`
3. This `README.md` — the **Version:** badge at the top and the Version History table

After every version bump:

```bash
git tag vX.Y.Z
git push origin main --follow-tags
```
