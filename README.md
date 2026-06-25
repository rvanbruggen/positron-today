# Positron Today

> A positive-news aggregator that uses AI to filter, summarise, and publish only uplifting stories — while openly logging the negative articles it skips.

**Version:** 3.0.0 · **Live site:** [positron.today](https://positron.today)

---

## Overview

Positron Today automatically scans RSS feeds from news sources around the world, filters out negative and anxiety-inducing stories using an AI model, and publishes the remaining good-news articles to a public website. It also maintains a transparent "What gets skipped" log — a public record of every rejected story, illustrating just how skewed mainstream news coverage tends to be.

The project has two parts:

| Part | Tech | Purpose |
|------|------|---------|
| **Admin** (`/admin`) | Next.js 16, TypeScript, Tailwind v4 | Content pipeline, source management, review & publish workflow. Self-hosted via Docker |
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
│  index.njk       — card grid with tag + date-range filters │
│  negativity.njk  — "What gets skipped" rejection log (EN/NL/FR) │
│  about.njk       — project description + RSS subscribe  │
│  contact.njk     — contact page                        │
└─────────────────────────────────────────────────────────┘
```

---

## AI Providers

Each task in the pipeline can independently use **Anthropic**, **OpenAI**, or **Ollama**. You configure this at runtime in **Admin → Settings** — no code changes or restarts needed.

| Task | Recommended local model | Recommended cloud model |
|------|------------------------|------------------------|
| Positivity filter | `llama3.2:3b` (fast, ~2 GB) | Claude Haiku 4.5 / GPT-4o mini |
| Summarisation | `gemma3:27b` (best quality, ~17 GB) | Claude Sonnet 4.6 / GPT-4o |

**Ollama** is the free, local option — models run entirely on your machine using Apple Metal on M-series Macs. No API key needed, no per-call cost. Highly recommended for the filter task which runs on every fetched article.

**Anthropic** is the cloud option — highest quality, especially for multilingual summarisation. Requires an `ANTHROPIC_API_KEY` and has per-token costs.

**OpenAI** (ChatGPT) is the second cloud option — comparable quality to Anthropic, with a different model family (GPT-4o, GPT-4o mini, o3, o3-mini). Requires an `OPENAI_API_KEY` and has per-token costs.

You can mix and match freely, e.g. Ollama for filtering (high volume, low cost) and Anthropic or OpenAI for summarisation (low volume, higher quality).

---

## Prerequisites

- Node.js 20+ (for local development) or Docker (for self-hosted deployment)
- A GitHub Personal Access Token (with `repo` scope) for committing to the site repo
- SQLite (local file — used in both development and self-hosted Docker mode) or a [Turso](https://turso.tech/) database (Vercel serverless mode)
- **At least one of:**
  - An [Anthropic API key](https://console.anthropic.com/) — for cloud AI (Haiku/Sonnet/Opus)
  - An [OpenAI API key](https://platform.openai.com/) — for cloud AI (GPT-4o, o3, etc.)
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

# OpenAI — only required if you use OpenAI as a provider in Settings
OPENAI_API_KEY=sk-...

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

There are two ways to run the pipeline: **manual** (step by step from the admin UI) or **automated** via Positronitron (configured on the Settings page). The built-in scheduler triggers a unified pipeline that runs the full flow in a single server-side invocation — the browser is only a status viewer, not a driver.

---

### Manual pipeline

#### Step 1 — Manage sources

Go to **Admin → Sources** and add RSS feeds. Each source has:
- **Name** — display name
- **Website URL** — original site URL
- **Feed URL** — RSS/Atom feed URL (required for auto-fetching)
- **Active** toggle

#### Step 2 — Configure AI providers (optional)

Go to **Admin → Settings** to choose which AI provider and model to use for each task. The defaults are Anthropic Haiku (filter) and Anthropic Sonnet (summarise). Changes take effect immediately without a restart.

Additional settings available in the Settings page:

- **Filter threshold** (1–10 slider) — controls how strict the positivity filter is. 1–2 = very lenient (almost everything passes), 5 = balanced (default), 8–10 = very strict. A live prompt preview updates as you drag the slider.
- **Custom filter prompt** — override the auto-generated filter instructions entirely with your own prompt.
- **Summarisation style/voice** — override the default summarisation style with custom instructions.
- **Ollama base URL** — change the Ollama server endpoint (default: `http://localhost:11434`).

#### Step 3 — Fetch new articles

Click **Fetch New Articles** on the Preview page. The admin:

1. Creates a task queue in the database — one task per chunk of sources (fetch), a planning task, one task per batch of queued items (classify), and an export task
2. For each fetch task: queries a chunk of active sources, retrieves up to 10 recent RSS items per feed, skips articles already in `raw_articles`, `rejected_articles`, or `articles`, and queues genuinely new items in `pending_items`
3. For each classify task: sends a batch of queued items to the **configured filter model** with the positivity filter prompt
4. The model returns `{"verdict":"YES"}` or `{"verdict":"NO","reason":"..."}`
5. Positive articles → `raw_articles` table (status: pending)
6. Negative articles → `rejected_articles` table with rejection reason
7. After all items are classified, auto-exports the rejection log to `site/src/_data/rejections.json` via the GitHub API, triggering a site rebuild

The browser polls `/api/pipeline/tick` every 2 seconds; each tick picks the next pending task, executes it, and returns progress. If the browser tab is closed or the mobile app is backgrounded, the tasks remain in the database — reopening the page resumes from where it left off. An external cron (e.g. Synology NAS) can also call the same endpoint to keep the pipeline moving without a browser.

#### Step 3b — Manual URL submission (optional)

You can also submit individual article URLs manually from the **Admin → Preview** page. The admin fetches the URL, runs it through the positivity filter, and adds it to the queue if it passes — without needing an RSS feed.

#### Step 4 — Review and summarise

Go to **Admin → Preview** to approve or discard each pending article. Approved articles move to **Admin → Scheduled** as drafts, where you can:
- **Summarise** — the configured summarisation model reads the full article URL, writes a 4-5 sentence summary in English, Dutch, and French, suggests topic tags, adds an emoji, and captures the article's `og:image` thumbnail
- **Summarise all** — when there are 2+ drafts, a bulk button summarises every draft **server-side in the background**. It POSTs once to `/api/summarise-drafts/start`; the run then proceeds entirely on the server (progress tracked in the `summarise_runs` table) while the page polls `/api/summarise-drafts/status` as a read-only viewer. You can close the tab or background the app and the run keeps going — reopening the Scheduled page resumes the live progress view, exactly like the Fetch & Filter pipeline. A **Stop** button requests cancellation after the current article finishes.
- **Edit** — tweak the title, summary, emoji, or tags before publishing
- **Discard** — remove from the queue

#### Step 5 — Publish

Click **Publish** on any reviewed article. The admin commits a Markdown file to `site/src/posts/YYYY-MM-DD-slug.md` via the GitHub Contents API. GitHub Actions then rebuilds and deploys the Eleventy site to GitHub Pages within ~1 minute.

Re-publishing an already-published article (after editing) always overwrites the same file — no duplicates are created.

---

### Scheduled publishing

Articles assigned a `publish_date` (via the Scheduled page or by Positronitron in `summarise`/`full` mode) are held in a queue and published automatically when their time arrives.

**How it works:**

- **Self-hosted mode:** Each article gets an exact-time timer (`setTimeout`) that fires at its `publish_date`. When the timer fires, the article is published to GitHub, the system waits for the Pages deploy, then posts to social media. No polling — articles publish at the exact scheduled minute.
- **Serverless mode:** An external cron task calls `POST /api/publish-scheduled` every 30 minutes. The endpoint finds all scheduled articles whose `publish_date ≤ now` (compared in `SCHEDULE_TZ`, default `Europe/Brussels`) and commits them to GitHub. Social posts are deferred until the site-deploy workflow calls back to `/api/post-pending-social` once the URL is actually live.
- **Local development:** A macOS launchd agent (`~/Library/LaunchAgents/today.positron.publish-scheduled.plist`) hits `POST http://localhost:3000/api/publish-scheduled` every hour.

**Managing the queue:**

Go to **Admin → Scheduled** to see queued articles, edit their publish times, trigger immediate publish, or remove them from the queue. The **Suggest schedule** button auto-assigns evenly spaced times starting from the next available slot.

---

## Rejection Log ("What gets skipped")

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

## Social Publishing

Positron Today posts to social media via [Post for Me](https://www.postforme.dev/). There are two paths to a social post — **manual** (one click on History) and **automatic** (opt-in per article when scheduling). Both paths produce the same post; they differ only in what triggers it.

**Platforms supported:** Bluesky, X (Twitter), Threads, Facebook, Instagram

### Manual: the 📣 button

From **Admin → History**, the 📣 button on any published article posts it to every enabled social platform in one click.

### Automatic: auto-post on publish

On **Admin → Scheduled**, each article in the "Ready to publish" list carries a **"📣 Announce on social"** checkbox. Ticking it sets `post_to_social_on_publish=1` on that article. When the article is later published — manually or by the scheduled-publish cron — the commit to GitHub happens immediately but the social post is deliberately deferred until the URL is actually live on GitHub Pages. Otherwise link previews on Bluesky / X / etc. resolve to a 404.

The deferred post is triggered by the site-deploy workflow. After [.github/workflows/deploy-site.yml](.github/workflows/deploy-site.yml) finishes publishing the site to GitHub Pages, its final step POSTs to `https://admin.positron.today/api/post-pending-social` with a bearer token. That endpoint finds every article where `post_to_social_on_publish=1 AND social_posted_at IS NULL AND published_at >= now()-24h`, HEAD-checks each URL, and posts the live ones via Post for Me.

### How the post is assembled (both paths)

1. Generates a branded 1080×1080 PNG card for the article (same image as the 📸 download button)
2. Uploads the card to Post for Me's media hosting
3. Posts **text + URL** to Bluesky, X, Threads, and Facebook
4. Posts the **card image + caption** to Instagram
5. Caption is capped to fit both X's 280-char limit (URLs via t.co = 23 chars) and Bluesky's 300-char limit (full URL length)

### Configuration

Go to **Admin → Settings → Social publishing** to toggle which accounts posts go to. The list is fetched live from Post for Me — any account connected in the Post for Me dashboard appears here immediately. Changes take effect without a restart.

To add a new platform, connect it via OAuth in the [Post for Me dashboard](https://app.postforme.dev), then enable it in Settings.

### Required environment variables

```env
POSTFORME_API_KEY=pfm_live_...
SOCIAL_POST_TOKEN=...    # shared secret for the deploy-time callback
```

`SOCIAL_POST_TOKEN` must be set on the admin deployment (e.g. Vercel) **and** as a GitHub repo secret of the same name, so the deploy workflow can authenticate when it calls `/api/post-pending-social`. Without it the automatic path silently skips social posting; the manual 📣 button still works.

Account IDs (`POSTFORME_ACCOUNT_*`) are no longer needed in `.env.local` — they are managed through the Settings UI and stored in the database.

---

## Admin Authentication

The admin panel is protected by a session cookie. Set `ADMIN_SECRET` in `.env.local` to enable authentication. The login page at `/login` prompts for the secret; on success a signed `httpOnly` cookie is set for 30 days.

If `ADMIN_SECRET` is not set, authentication is disabled (useful for local development).

```env
ADMIN_SECRET=your-long-random-secret
```

Generate a strong secret with: `openssl rand -hex 24`

---

## Backup and Restore

Go to **Admin → Settings → Data & migration** to:

- **Download backup** — exports all database tables (sources, topics, articles, tags, rejections, settings) as a dated JSON file
- **Restore from backup** — upload a backup JSON to wipe and repopulate the database

This is the migration path between environments (e.g. local SQLite → Turso cloud):

1. Download backup from local admin
2. Point `DATABASE_URL` at the new database and restart
3. Upload the backup in the new environment's admin

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
| `pending_items` | Staging queue for RSS items awaiting LLM classification |
| `pipeline_runs` | Tracks each fetch-classify cycle (status, phase, counters, log) |
| `pipeline_tasks` | Task queue for pipeline work items (fetch chunks, classify batches, export) |
| `summarise_runs` | Tracks each server-side "Summarise all drafts" run (status, counts, current article, log) so the browser can disconnect mid-run |
| `settings` | Key-value store for LLM provider/model configuration |

---

## Admin Pages

| Route | Purpose |
|-------|---------|
| `/` | Dashboard — quick stats |
| `/sources` | Manage RSS sources (add, edit inline, toggle active) |
| `/tags` | Manage topic tags |
| `/preview` | Review pending articles, summarise, edit, publish |
| `/scheduled` | Drafts awaiting summarisation (single + bulk "Summarise all") and scheduled publish queue — set publish times, suggest schedule, publish on demand. Each "Ready to publish" card has one tap-friendly **digest toggle**; featured + announce-on-social live in the per-article Edit dialog |
| `/history` | Published article history — edit, re-publish, generate Instagram card, post to socials |
| `/rejections` | Browse rejection log, override or delete entries |
| `/settings` | LLM providers, social publishing accounts, backup/restore, sign out |

---

## Public Site Pages

| Page | Purpose |
|------|---------|
| `/` | Home — card grid (round-robin columns, newest first) with topic tag + date-range filters |
| `/negativity/` | "What gets skipped" — the rejection log with category breakdown (EN/NL/FR) |
| `/about/` | About the project, the positron metaphor, active sources, and RSS subscription links |
| `/contact/` | Contact page with links to email, LinkedIn, and Instagram (@positron_today) |
| `/archive/` | Full archive of all articles older than the 60 shown on the homepage |
| `/<article-slug>/` | Article detail — hero image, trilingual title/summary, source link, social share buttons |
| `/feed.xml` | RSS feed (English) |
| `/feed-nl.xml` | RSS feed (Dutch) |
| `/feed-fr.xml` | RSS feed (French) |

### Card grid

- Articles are distributed into columns using round-robin JS, so the newest articles always appear across the **top row** (not stacked in the leftmost column)
- Cards show a thumbnail image sourced from the article's `og:image` where available
- **Topic tags** — multi-select dropdown above the grid; filter by one or more topics (persisted in `localStorage`)
- **Date range** — dropdown filter: last 7 days, 30 days, 3 months, 6 months, this year, or all time (persisted in `localStorage`)
- Both filters support a **Clear** button and are fully translated into EN, NL, and FR

### RSS feeds

All three language editions publish RSS 2.0 feeds. Subscribe directly or use the language-aware RSS link in the site footer. Feed autodiscovery `<link>` tags are included in every page `<head>`.

---

## Deployment

### Public site

The public site is deployed automatically via GitHub Actions:

- **Workflow:** `.github/workflows/deploy-site.yml`
- **Trigger:** any push to `main` that touches `site/**`
- **Build:** `cd site && npm run build` (Eleventy outputs to `site/_site/`)
- **Deploy:** GitHub Pages from the `gh-pages` branch, served at [positron.today](https://positron.today)

### Admin: three deployment options

The admin app can run in three ways. The **deployment mode** (serverless vs self-hosted) is selectable in **Admin → Settings → Deployment mode** and controls how the pipeline and scheduling work.

| Option | Infrastructure | Deployment mode | Scheduling | Pipeline | Best for |
|--------|---------------|----------------|------------|----------|----------|
| **Vercel** | Vercel / cloud functions | Serverless | External cron (NAS, GitHub Actions) | Chunked — each API call stays within 60s | Vercel free tier, zero maintenance |
| **Docker** | Docker on any machine | Self-hosted | Built-in node-cron scheduler | Unified — single long-running flow, no time limits | Your own server, old laptop, Raspberry Pi |
| **Local dev** | Node.js directly | Either | Manual from the UI, or external cron | Both (depends on mode setting) | Development, testing, local use |

#### Serverless mode (Vercel)

The traditional deployment. Each pipeline phase is a separate API endpoint called by external cron jobs. Work is chunked into small batches (5 sources, 1 item per tick) to stay within Vercel's 60-second function timeout. Scheduled articles are published by a periodic cron call to `/api/publish-scheduled`.

#### Self-hosted mode (Docker)

Deploy the admin app in a Docker container on any machine with Docker installed. Set `DEPLOYMENT_MODE=self-hosted` in your environment.

**What you get:**
- **Built-in scheduler** — the app manages its own cron schedule using the run times configured in Settings. No external cron jobs needed.
- **Unified pipeline** — fetch ALL sources → classify ALL pending items → positronitron → publish → social post, all in a single run with no time limits.
- **Exact-time publish timers** — when an article is scheduled for 10:35, it publishes at exactly 10:35. No polling delay.
- **Local SQLite database** — no Turso dependency. The database is a file on disk.

**Docker setup:**

```bash
git clone https://github.com/rvanbruggen/positron-today.git
cd positron-today/admin
cp .env.docker.example .env.docker
# Edit .env.docker with your API keys
docker compose up -d --build
```

**Redeploying after code changes:**

```bash
./admin/deploy.sh
```

#### Local development

Run the admin directly with Node.js — no Docker needed. See the [Setup](#setup) section for details. The deployment mode defaults to serverless, but you can set `DEPLOYMENT_MODE=self-hosted` in `.env.local` to activate the built-in scheduler locally. Ollama (local AI) is only available in this mode.

---

## Environment Variable Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | SQLite file path (`file:../local.db`) or Turso URL |
| `DATABASE_AUTH_TOKEN` | Turso only | Auth token for Turso cloud database |
| `ANTHROPIC_API_KEY` | If using Anthropic | Required only when Anthropic is selected as a provider in Settings |
| `OPENAI_API_KEY` | If using OpenAI | Required only when OpenAI is selected as a provider in Settings |
| `GITHUB_TOKEN` | Yes | PAT with `repo` scope for committing to the site |
| `GITHUB_REPO` | Yes | `owner/repo` format |
| `GITHUB_BRANCH` | No | Target branch (default: `main`) |
| `ADMIN_SECRET` | Recommended | Password for the admin login page. If unset, auth is disabled. Generate with `openssl rand -hex 24` |
| `DEPLOYMENT_MODE` | No | `serverless` (default) or `self-hosted`. Controls whether the built-in scheduler and unified pipeline are active |
| `SCHEDULE_TZ` | No | Timezone for schedule calculations (default: `Europe/Brussels`) |
| `POSTFORME_API_KEY` | If using social publishing | API key from [postforme.dev](https://www.postforme.dev/) |
| `SOCIAL_POST_TOKEN` | If using auto-post-on-publish | Shared secret for the deploy-time callback to `/api/post-pending-social`. Must match a repo secret of the same name on GitHub |
| `BLUESKY_HANDLE` | If using direct Bluesky | Handle for the legacy direct Bluesky posting route |
| `BLUESKY_APP_PASSWORD` | If using direct Bluesky | App password for the legacy direct Bluesky posting route |

> **Note:** If you use Ollama for both tasks, neither `ANTHROPIC_API_KEY` nor `OPENAI_API_KEY` is needed. Social account IDs for Post for Me are managed through the Settings UI and stored in the database — no env vars needed.

---

## Version History

See [CHANGELOG.md](CHANGELOG.md) for the full release history.

---

## Version Tracking

The canonical version lives in **five places** — keep them in sync when bumping:

1. `admin/lib/version.ts` — `export const APP_VERSION = "x.y.z";`
2. `admin/package.json` — `"version": "x.y.z"` (the public site reads its footer version from here too)
3. `package.json` (root) — kept in sync with admin since v2.25.0
4. `README.md` — the **Version:** badge at the top of this file
5. `CHANGELOG.md` — a new row at the top of the history table

After every version bump:

```bash
git tag vX.Y.Z
git push origin main --follow-tags
```
