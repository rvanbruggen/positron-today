# Positivity Score Analysis — Co-Work Briefing

## Context

Positron Today (https://positron.today) is a positive-news aggregator that uses AI to filter mainstream news. Every article fetched from RSS feeds is classified by an LLM with a positivity score (1–10):

- **1–3** = negative
- **4–6** = neutral  
- **7–10** = positive

Only positive articles are published. Rejected articles (negative/neutral) are logged transparently.

We have **91 days** of positivity score data (2026-04-08 → 2026-07-07) across **38 news sources** from multiple countries and languages. The attached CSV (`positivity-scores.csv`) contains 2,600 data points with these columns:

| Column | Description |
|--------|------------|
| `date` | Publication date (YYYY-MM-DD) |
| `source` | Publication name |
| `url` | Publication URL |
| `score_pct` | Positivity percentage: (positive articles / total articles) × 100 |
| `total_articles` | Total articles classified that day for this source |
| `positive` | Count of articles scored 7–10 |
| `neutral` | Count of articles scored 4–6 |
| `negative` | Count of articles scored 1–3 |

---

## Phase 1: Enrich Source Metadata

For each of the 38 sources below, research and add the following attributes:

| Attribute | Description | Example values |
|-----------|------------|----------------|
| `country` | Country of origin | Belgium, USA, UK, France, etc. |
| `region` | Broader region | Western Europe, North America, Scandinavia, etc. |
| `language` | Primary language | EN, NL, FR, DE, DA, ES, PL, SV |
| `type` | Publication type | public-broadcaster, legacy-newspaper, digital-native, magazine, tech-media, positive-only, academic |
| `ownership` | Public/private/state | public, private, non-profit |
| `audience_tier` | Estimated reach | global, national, regional, niche |
| `editorial_focus` | Primary subject area | general-news, business-finance, science-tech, culture, positive-only |
| `market_position` | Positioning | broadsheet/quality, tabloid/popular, specialist |
| `political_lean` | If well-documented | centre-left, centre, centre-right, varies, N/A |

### Source list (38 sources)

1. **BBC** — bbc.com (UK, EN, public broadcaster)
2. **BBC Top Stories** — bbc.com (UK, EN, public broadcaster, top stories feed)
3. **CNN** — cnn.com (USA, EN)
4. **Chain of thought** — every.to/chain-of-thought (USA, EN, tech/AI newsletter)
5. **DR (Danish Public broadcaster)** — dr.dk (Denmark, DA)
6. **Dagens Nyheter** — dn.se (Sweden, SV)
7. **De Morgen** — demorgen.be (Belgium, NL)
8. **De Standaard Binnenland** — standaard.be domestic news (Belgium, NL)
9. **De Standaard Buitenland** — standaard.be international news (Belgium, NL)
10. **De Standaard Economie** — standaard.be business/economy (Belgium, NL)
11. **El pais** — elpais.com (Spain, ES)
12. **Euroactiv** — euractiv.com (EU-focused, EN)
13. **Euronews** — euronews.com (EU-focused, multilingual)
14. **Frankfurter Allgemeine Zeitung** — faz.net (Germany, DE)
15. **Gazet van Antwerpen** — gva.be (Belgium, NL, regional)
16. **Good News Network** — goodnewsnetwork.org (USA, EN, positive-only)
17. **Het Laatste Nieuws** — hln.be (Belgium, NL, popular/tabloid)
18. **Humo** — humo.be (Belgium, NL, magazine/culture)
19. **Le Figaro** — lefigaro.fr (France, FR)
20. **Le Monde** — lemonde.fr (France, FR)
21. **Microsoft Research** — microsoft.com/research (USA, EN, tech/academic)
22. **NRC** — nrc.nl (Netherlands, NL)
23. **NY Times** — nytimes.com (USA, EN) — note: may overlap with "The New York Times"
24. **Nature** — nature.com (UK, EN, academic/science)
25. **Neue Zürcher Zeitung** — nzz.ch (Switzerland, DE)
26. **Politiken.dk** — politiken.dk (Denmark, DA)
27. **Popular Science** — popsci.com (USA, EN, science/tech)
28. **Positive News** — positive.news (UK, EN, positive-only)
29. **Rzeczpospolita Poland** — rp.pl (Poland, PL)
30. **Science.org news** — science.org (USA, EN, academic/science)
31. **The Guardian** — theguardian.com (UK, EN)
32. **The Guardian Europe** — theguardian.com/europe (UK, EN, European coverage)
33. **The New York Times** — nytimes.com (USA, EN) — see also "NY Times"
34. **The Verge** — theverge.com (USA, EN, tech)
35. **The Washington Post** — washingtonpost.com (USA, EN)
36. **Upworthy** — upworthy.com (USA, EN, positive/uplifting)
37. **VRT Nws** — vrt.be/vrtnws (Belgium, NL, public broadcaster)
38. **Wired** — wired.com (USA, EN, tech)

**Deliverable:** A complete enrichment table in CSV or markdown format. Flag any sources where you're uncertain about an attribute.

---

## Phase 2: Analysis

Using the enriched dataset, perform the following analyses. Use charts/visualisations where they add clarity.

### 2.1 Overall landscape
- What is the average positivity score across all sources? Median? Standard deviation?
- Distribution histogram of scores — is it normal, skewed, bimodal?
- Which sources are consistently the most and least positive?
- Which sources have the most volatile scores (highest variance)?

### 2.2 By country and region
- Average positivity score by country. Do Belgian, US, UK, French, Scandinavian sources differ?
- Is there a European vs North American pattern?
- Do smaller countries' media differ from larger countries'?

### 2.3 By publication type
- Public broadcasters (BBC, DR, VRT) vs legacy newspapers vs digital-native vs positive-only
- Does ownership model (public vs private vs non-profit) correlate with positivity?
- Quality/broadsheet vs popular/tabloid — any difference?

### 2.4 By editorial focus
- General news vs specialist (tech, science, business, culture)
- Do science/tech publications score higher than general news?
- How do the deliberately positive sources (Good News Network, Positive News, Upworthy) compare to mainstream?

### 2.5 Temporal patterns
- **Trend over time:** is global news getting more or less positive over this 91-day window?
- **Day-of-week effect:** are certain weekdays more positive? (Weekend editions may differ)
- **Seasonal/event spikes:** any dates with unusual positivity spikes or dips across many sources? Cross-reference with major news events if possible.
- **Consistency:** which sources show the most day-to-day variation vs steady scores?

### 2.6 Language effect
- Do Dutch-language sources differ from French-language sources within Belgium (same country, different language community)?
- English-language sources vs non-English — any systematic difference?
- Note: the AI classifier processes all languages, so this tests whether the *content* differs, not the classifier's accuracy.

### 2.7 Correlation and clustering
- Are there clusters of sources that move together (similar score patterns over time)?
- Do sources from the same country/type correlate more strongly?
- Is there a "news cycle" effect where all sources dip on the same days?

### 2.8 Control group analysis
- Good News Network, Positive News, and Upworthy are deliberately positive. Use them as a ceiling/control group.
- How close do the best-performing mainstream sources get to the positive-only sources?
- Microsoft Research, Nature, Science.org are academic/scientific — do they form a natural cluster?

---

## Phase 3: Report

Produce a structured analysis report with:

1. **Executive summary** (3–5 key findings, suitable for a non-technical audience)
2. **Methodology** (brief: how scores are calculated, what the data represents, caveats)
3. **Findings** (organised by the sections above, with charts)
4. **Interesting stories** (specific findings that would be compelling in an editorial — surprising results, counterintuitive patterns, cultural insights)
5. **Limitations and caveats** (AI classifier bias, sample size per source, missing data, 91-day window)
6. **Suggestions for the editorial angle** (what narrative threads could an editorial pull from this data?)

### Tone and audience
The eventual editorial will be published on Positron Today — a site about positive news. The analysis should be factual and data-driven, but the editorial suggestions should lean into what makes this interesting for a general audience. Think: "Here's what we learned when we measured how positive the news really is."

### Caveats to keep in mind
- The positivity score is assigned by an AI model (Claude Haiku 4.5). It's consistent but not infallible.
- `score_pct` is the percentage of articles classified as positive (score 7–10). It does NOT mean the other articles are all negative — many are neutral (4–6).
- Some sources have more articles per day than others, so `total_articles` varies.
- The data window is 91 days (April–July 2026). Seasonal effects may not be fully visible.
- Some sources (like "De Standaard Binnenland/Buitenland/Economie") are different sections of the same newspaper — treat them as separate feeds but note the relationship.
- "NY Times" and "The New York Times" may be the same source under different names — check and merge if so.
- "BBC" and "BBC Top Stories" are different feeds from the same broadcaster.

---

## Attached data

The CSV file `positivity-scores.csv` is attached alongside this briefing. It contains all 2,600 data points ready for analysis.
