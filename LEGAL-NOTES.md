# Legal notes — positron.today

**Last updated:** 2026-04-20
**Operator:** Rik Van Bruggen (individual, based in Belgium)
**Site:** https://positron.today

This document describes how Positron Today operates with respect to the
news sources it curates and links to, and the specific legal conventions
the operator relies on. It is a factual description written by the
operator for the benefit of reviewers, publishers, and legal advisors.
It is **not legal advice**; see §8.

---

## 1. What Positron Today is

Positron Today is a **personal, non-commercial news-curation website**
run by one individual. It is:

- **Not** a company, a legal entity, or a media outlet.
- **Not** commercially monetised: no advertising, no sponsorships, no
  affiliate links, no paywall, no paid newsletter, no tracking for
  commercial purposes, no monetisation of any kind.
- **Not** intended as a substitute for the sources it links to; it is
  intended as a discovery layer that drives readers *to* those sources.

It is built and maintained as a hobby project, primarily to be shared
with the operator's family, friends, and wider personal network.

The public statement of this posture lives on the site's About page
under "A personal, not-for-profit initiative".

---

## 2. What the site reproduces, and what it does not

For each curated article, Positron Today stores and displays exactly
the following content derived from the source:

| Element | Form on positron.today | Notes |
|---|---|---|
| Summary (EN / NL / FR) | **Newly-written paraphrase** | AI-generated under the operator's supervision; not a verbatim copy of the source text |
| Original headline | As text, attributed | Shown alongside the source name; used as a reference label |
| Source name | As text | Appears on every card and every detail page |
| Source publication date | As text | Displayed alongside the site's own publication date |
| Direct link to the source URL | `<a href="…">` | Present on the card (primary click target), on the detail page ("Read the original article ↗"), and in structured data |
| Preview image | `<img src="…">` pointing at the source's own server | **Only the publisher's own `og:image`** — see §5. Not re-hosted. |

Content that is explicitly **not** reproduced on Positron Today:

- The source article's body text (in any form — neither copied, nor
  lightly paraphrased; summaries are newly authored transformations).
- The source publication's branding, logo, design, layout, or visual
  identity.
- Any archival copy of the source article or its assets.
- Any additional images beyond the single preview image per article.

---

## 3. Attribution and linking

Every article on Positron Today points back to the original publisher,
clearly and in multiple places:

- **On the homepage and archive**, clicking the card opens the source
  article directly in a new tab. The card is, by design, a link to the
  source.
- **On the detail page** (`/posts/<slug>/`), a prominent "Read the
  original article ↗" button opens the source URL; the source name is
  displayed visibly near the headline.
- **In YAML front-matter** of the published markdown file
  (`site/src/posts/<date>-<slug>.md`): `source_url`, `source_name`, and
  `source_pub_date` are embedded in every article file.
- **In JSON-LD `NewsArticle` structured data** on the detail page: a
  machine-readable source URL and publication date.
- **In Open Graph meta tags**: `og:url` points to the Positron Today
  detail page, which itself links to the source.
- **In the site's "Our sources" section** on the About page: every
  curated publication is listed by name and linked to its website.

The project's stated and observable intent is to **drive traffic to the
source publisher** — not to retain the reader on positron.today.

---

## 4. Legal conventions relied on

The operator relies on standard conventions of commentary, curation,
and quotation, with attribution and a direct link back to the source.
The relevant statutory provisions in the most-represented jurisdictions:

### European Union (framework)
- **Directive 2001/29/EC** (InfoSoc Directive), art. 5(3)(d): permits
  Member States to provide an exception for "quotations for purposes
  such as criticism or review", provided the use is "in accordance
  with fair practice" and "to the extent required by the specific
  purpose", with source and author attribution.

### Belgium (operator's jurisdiction)
- **Code de droit économique / Wetboek van economisch recht**, Book XI,
  article XI.189 §1, 1°: permits short quotation "from a work
  lawfully made available to the public" for purposes of criticism,
  polemic, review, teaching, or scientific work, subject to fair
  practice and source attribution.

### Netherlands
- **Auteurswet (Aw), art. 15a** — *het citaatrecht*: permits citation
  from a disclosed work for criticism, review, scientific treatise, or
  a purpose comparable in nature, with mention of source and author,
  and insofar as justified by the citation's purpose.

### France
- **Code de la propriété intellectuelle (CPI), art. L.122-5, 3° a)** —
  *le droit de courte citation*: permits short citations justified by
  the critical, polemic, pedagogical, scientific, or informational
  character of the work in which they are incorporated, with clear
  indication of the author's name and the source.

### General observation
Positron Today's practice — transformative summary + attribution + a
direct link back to the source — aligns with the routine operation of
RSS readers, news aggregators, link-preview systems (OpenGraph, Twitter
Card, IFTTT-style feeds), and search-engine result pages, which
likewise reproduce headlines and preview images as reference labels
pointing back to the original.

---

## 5. Images — technical statement

**Short form:** images on positron.today are hot-linked by URL from the
source publisher's own servers. They are not re-hosted on positron.today,
nor on GitHub Pages, nor in the project's Git repository. If the source
removes an image, it disappears from our site automatically.

### 5.1 Which image, and where it comes from

The image used on a card is **strictly the publisher's own `og:image`**
— the Open Graph meta tag the publisher themselves placed in their
article's HTML head specifically to designate how the article should
be represented on third-party surfaces (social networks, messaging
apps, RSS readers, search-engine previews, link-preview unfurlers).
The code path that extracts it matches only this tag, with no fallback
to article-body `<img>` tags, no scraping of inline content, and no
use of any alternative image source:

```ts
// admin/app/api/summarise/route.ts  and
// admin/app/api/positronitron/route.ts
const imgMatch =
  html.match(/property="og:image"\s+content="([^"]+)"/i) ||
  html.match(/content="([^"]+)"\s+property="og:image"/i);
```

If the publisher has not set an `og:image`, no image URL is captured
and the card renders with no image. By limiting the site to this single
publisher-designated image, Positron Today is honouring the source's
own explicit intent about third-party representation.

### 5.2 What the database stores

An SQLite column `articles.image_url` of type `TEXT` holds the URL
string extracted above, pointing to the source publisher's own CDN,
e.g. `https://cdn.source-publisher.example/…/hero.jpg`. **No binary
image data, no downloaded copy, no base64-embedded copy.**

### 5.3 What is deployed to GitHub Pages

Each published article is a markdown file at
`site/src/posts/YYYY-MM-DD-<slug>.md`. Its YAML front-matter contains
the same URL string. **No image bytes are written to the Git
repository, and no image bytes are included in the GitHub Pages deploy
artifact.**

### 5.4 What the visitor's browser does

When a visitor loads a page on positron.today, the HTML served by
GitHub Pages contains literally:

```html
<img src="https://cdn.source-publisher.example/…/hero.jpg"
     loading="lazy"
     onerror="this.style.display='none'">
```

The visitor's browser issues an HTTP request **directly to the source
publisher's server** for the image bytes. positron.today and GitHub
Pages never see, transmit, or cache those bytes. The source publisher's
own server logs the request and serves its own asset from its own
infrastructure.

### 5.5 Fallback when the source removes the image

The `onerror="this.style.display='none'"` attribute means that if the
source URL returns 404, errors, or is otherwise unavailable, the
`<img>` element is hidden at render time and the rest of the card
displays without it. No stale or cached copy of the image is retained
on positron.today.

### 5.6 Social previews

The `<meta property="og:image" content="URL">` tag on each article
detail page points to the same source-publisher URL. When a third-party
platform (Bluesky, X/Twitter, Facebook, Slack, WhatsApp, etc.) unfurls
a positron.today link and shows a preview, **that platform** fetches
the image from the source publisher and caches it on its own preview
CDN. positron.today does not mediate the fetch or the cache.

### 5.7 Single exception — Instagram card generation

Instagram's publishing API does not accept hot-linked preview images in
feed posts. When (and only when) an article is posted to Instagram, the
admin backend:

1. briefly fetches the source image server-side (in memory, not to disk),
2. composites it into a newly-generated **1080 × 1080 branded PNG
   card** with Positron Today's layout — title text, source name,
   emoji, Positron's decorative border,
3. uploads the composite PNG to [Post for Me](https://postforme.dev),
   the third-party social-publishing service that fan-outs to Instagram.

Post for Me's servers host the resulting composite PNG. positron.today
does not retain it. The source image is not persisted. The output is
not a copy of the source image — it is a derivative composite used
solely to comply with Instagram's technical publishing requirements,
with attribution ("Source: …") baked into the card itself.

---

## 6. Absence of proxying / caching on our side

- The public site (positron.today) is a **pure static Eleventy build**
  deployed to GitHub Pages. No Next.js Image component, no Vercel Image
  Optimization, no custom image-proxy endpoint, no server-side image
  transformation.
- The Progressive Web App (PWA) service worker (`/sw.js`) caches
  same-origin HTML and CSS for offline reading. Because article images
  are served from cross-origin source publisher CDNs, they are **not**
  intercepted by the service worker; no PWA installation carries
  offline image copies.
- The three RSS feeds (`/feed.xml`, `/feed-nl.xml`, `/feed-fr.xml`)
  contain **no image elements at all** — only title text, newly-written
  summary text, and the link to the positron.today detail page.

---

## 7. Takedown path

Any publisher whose article appears on positron.today and who would
rather it did not is invited to contact the operator via:

- the Contact page at [positron.today/contact/](https://positron.today/contact/)
- or directly by email (address listed on that page)

The operator's stated posture, both publicly on the About page and here,
is to remove the article without argument on request. The purpose of
this project is to amplify good journalism, not to create friction for
the people producing it.

Removal of a published article is implemented by:

1. deleting the corresponding markdown file from `site/src/posts/` via a
   Git commit, which triggers a GitHub Pages redeploy (typically live
   within a few minutes),
2. removing the corresponding row from the admin database, which clears
   any remaining references.

After removal, no cached or archival copy of the article or its metadata
remains on positron.today's own infrastructure. (Third-party caches —
search engines, the Internet Archive, social-network preview caches —
are outside the operator's control but are the ordinary, well-known
consequence of any web publication.)

---

## 8. What this document is not

- This document is **not legal advice**. The operator is not a lawyer.
- This document is **not a warranty** of copyright-infringement-free
  operation.
- This document is **not a substitute** for case-by-case assessment of
  any specific article, publisher, or jurisdictional question by
  qualified counsel.

It is a description of how the site operates, provided in good faith
so that reviewers can assess the site's practices against applicable
legal frameworks. Any publisher, lawyer, or rights-holder who
identifies a specific concern is encouraged to reach out via the
Contact page — the operator will engage in good faith.

---

## Appendix — where each claim can be verified in the code

| Section | Claim | Code reference |
|---|---|---|
| §2 | Summaries are newly-written, not copied | `admin/app/api/summarise/route.ts`, `admin/app/api/positronitron/route.ts` (the summariser prompt asks the model to paraphrase + translate) |
| §3 | Every detail page links to the source | `site/src/_includes/post.njk` — "Read the original article ↗" button |
| §3 | Homepage card opens the source on click | `site/src/index.njk` — `<a class="card-link" href="{{ post.data.source_url }}" target="_blank">` |
| §5.1 | Only the publisher's `og:image` is extracted; no scraping of article-body images | `admin/app/api/summarise/route.ts:17-20`, `admin/app/api/positronitron/route.ts:45-47` |
| §5.2 | `image_url` is a URL string, not a blob | `admin/lib/schema.ts` — column declared `TEXT` |
| §5.3 | No image bytes in published markdown | `admin/app/api/publish/route.ts` — `image_url: {{ URL }}` in generated YAML |
| §5.4 | Public `<img>` tags point to source URLs | `site/src/index.njk`, `site/src/_includes/post.njk`, `site/src/archive/month.njk` |
| §5.5 | Broken image is hidden, not cached | `onerror="this.style.display='none'"` on each `<img>` |
| §5.6 | OG image points to source URL | `site/src/_includes/base.njk` — `<meta property="og:image" content="{{ image_url }}">` |
| §5.7 | Instagram card is a derivative composite | `admin/lib/instagram-card-og.tsx` — Satori renders a new 1080×1080 PNG |
| §6 | RSS feeds contain no images | `site/src/feed.njk`, `feed-nl.njk`, `feed-fr.njk` |
