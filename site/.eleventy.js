module.exports = function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy("src/assets");
  eleventyConfig.addPassthroughCopy("src/CNAME");
  eleventyConfig.addPassthroughCopy("src/robots.txt");
  // PWA: sw.js and manifest.webmanifest must sit at the site root so the
  // service worker gets full-site scope and the manifest link resolves.
  eleventyConfig.addPassthroughCopy("src/sw.js");
  eleventyConfig.addPassthroughCopy("src/manifest.webmanifest");

  // URL-encode filter for use in meta tag attributes
  eleventyConfig.addFilter("urlencode", (str) => encodeURIComponent(String(str ?? "")));

  eleventyConfig.addFilter("dateDisplay", (dateStr) => {
    return new Date(dateStr).toLocaleDateString("en-GB", {
      day: "numeric", month: "long", year: "numeric",
    });
  });

  // Short date: "6 Apr 2026" — used in cards where space is tight
  eleventyConfig.addFilter("dateShort", (dateOrStr) => {
    // For bare YYYY-MM-DD strings, anchor to noon UTC to avoid timezone shift
    const d = typeof dateOrStr === "string"
      ? new Date(dateOrStr + "T12:00:00Z")
      : dateOrStr;
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  });

  // ISO date string: "2026-04-06" — used as a data attribute for JS date-range filtering
  eleventyConfig.addFilter("dateIso", (date) => {
    if (typeof date === "string") return date.slice(0, 10);
    return date.toISOString().slice(0, 10);
  });

  // Returns "YYYY-MM" for use as a data attribute on cards
  eleventyConfig.addFilter("dateMonthKey", (date) => {
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });

  // Returns "April 2026" style label — accepts a Date object OR a "YYYY-MM" string
  eleventyConfig.addFilter("dateMonthLabel", (dateOrKey) => {
    let d;
    if (typeof dateOrKey === "string" && /^\d{4}-\d{2}$/.test(dateOrKey)) {
      const [year, month] = dateOrKey.split("-");
      d = new Date(year, Number(month) - 1, 1);
    } else {
      d = new Date(dateOrKey);
    }
    return d.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  });

  // Dutch month label — "april 2026"
  eleventyConfig.addFilter("dateMonthLabelNl", (dateOrKey) => {
    let d;
    if (typeof dateOrKey === "string" && /^\d{4}-\d{2}$/.test(dateOrKey)) {
      const [year, month] = dateOrKey.split("-");
      d = new Date(year, Number(month) - 1, 1);
    } else {
      d = new Date(dateOrKey);
    }
    return d.toLocaleDateString("nl-BE", { month: "long", year: "numeric" });
  });

  // French month label — "avril 2026"
  eleventyConfig.addFilter("dateMonthLabelFr", (dateOrKey) => {
    let d;
    if (typeof dateOrKey === "string" && /^\d{4}-\d{2}$/.test(dateOrKey)) {
      const [year, month] = dateOrKey.split("-");
      d = new Date(year, Number(month) - 1, 1);
    } else {
      d = new Date(dateOrKey);
    }
    return d.toLocaleDateString("fr-BE", { month: "long", year: "numeric" });
  });

  // Deterministically maps a topic name to one of 10 colour names.
  // Same topic always gets the same colour; no topic → "yellow".
  const CARD_COLORS = [
    "yellow", "teal", "rose", "blue", "lime",
    "purple", "orange", "cyan", "green", "pink",
  ];
  function hashStr(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
    return Math.abs(h);
  }
  eleventyConfig.addFilter("topicColor", (topic) => {
    if (!topic) return "yellow";
    return CARD_COLORS[hashStr(String(topic)) % CARD_COLORS.length];
  });

  // Returns the first N items from an array — use instead of Nunjucks | slice
  // (which splits into columns, not a range)
  eleventyConfig.addFilter("limit", (array, n) => array.slice(0, n));

  // RFC 822 date string for RSS <pubDate> — e.g. "Mon, 06 Apr 2026 00:00:00 +0000"
  eleventyConfig.addFilter("dateRfc822", (date) => {
    const d = typeof date === "string" ? new Date(date + "T12:00:00Z") : new Date(date);
    return d.toUTCString();
  });

  // "13 Apr 2026, at 08:30" — compact date+time for card meta.
  // If the time component is midnight (00:00) the article predates timed publishing,
  // so we omit the time to avoid showing a confusing "at 00:00".
  eleventyConfig.addFilter("dateTimeShort", (date) => {
    const d = date instanceof Date ? date : new Date(date);
    const dateStr = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    const h = d.getUTCHours(), m = d.getUTCMinutes();
    if (h === 0 && m === 0) return dateStr;
    const time = String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
    return `${dateStr}, at ${time}`;
  });

  // "13 April 2026, at 08:30" — long-form date+time for the article detail page.
  eleventyConfig.addFilter("dateTimeDisplay", (date) => {
    const d = date instanceof Date ? date : new Date(date);
    const dateStr = d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
    const h = d.getUTCHours(), m = d.getUTCMinutes();
    if (h === 0 && m === 0) return dateStr;
    const time = String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
    return `${dateStr}, at ${time}`;
  });

  eleventyConfig.addCollection("posts", function (collectionApi) {
    return collectionApi.getFilteredByGlob("src/posts/*.md").sort((a, b) => {
      return new Date(b.date) - new Date(a.date);
    });
  });

  eleventyConfig.addCollection("editorials", function (collectionApi) {
    return collectionApi.getFilteredByGlob("src/editorials/*.md").sort((a, b) => {
      return new Date(b.date) - new Date(a.date);
    });
  });

  // Unique sorted list of every tag used across posts.
  // Resolves `tags[]` first, falls back to the legacy `topic` string, to match
  // the same precedence index.njk uses when it renders card tag pills — so
  // what shows on the homepage is what gets a tag page.
  eleventyConfig.addCollection("tagsList", function (collectionApi) {
    const tagSet = new Set();
    for (const post of collectionApi.getFilteredByGlob("src/posts/*.md")) {
      const list = (post.data.tags && post.data.tags.length)
        ? post.data.tags
        : (post.data.topic ? [post.data.topic] : []);
      for (const t of list) {
        if (t && String(t).trim()) tagSet.add(String(t).trim());
      }
    }
    return [...tagSet].sort((a, b) => a.localeCompare(b));
  });

  // How many posts each tag has — used by /tags/ index to show counts without
  // iterating every post per tag inside the template.
  eleventyConfig.addCollection("tagCounts", function (collectionApi) {
    const counts = new Map();
    for (const post of collectionApi.getFilteredByGlob("src/posts/*.md")) {
      const list = (post.data.tags && post.data.tags.length)
        ? post.data.tags
        : (post.data.topic ? [post.data.topic] : []);
      for (const t of list) {
        const key = t && String(t).trim();
        if (key) counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
    return Object.fromEntries(counts);
  });

  // Homepage layout collections.
  //
  // The three-column homepage splits posts into three buckets so each region
  // renders without Masonry gaps:
  //   - homeTopFeatured: exactly 2 posts, always shown at the top of the
  //     featured region (with fallback — see below).
  //   - homeRestFeatured: any featured posts beyond the first 2, shown only
  //     in the desktop right rail.
  //   - homeMainFeedItems: everything else (non-featured + rest-featured),
  //     sorted by date, shown in the left 2-column feed. Rest-featured items
  //     appear here for tablet/mobile (where they render as regular cards
  //     via the .feed-dup-featured class), and are hidden via CSS on desktop.
  //
  // Fallback: if fewer than 2 posts are marked featured, fill the top slot(s)
  // with the most-recent non-featured posts so the region always contains
  // exactly 2 items. This is a safety net — under editorial control.
  function computeHomepageBuckets(collectionApi) {
    const all = collectionApi.getFilteredByGlob("src/posts/*.md");
    const sorted = all.slice().sort((a, b) => new Date(b.date) - new Date(a.date));
    const featured = sorted.filter((p) => p.data.featured);
    const regulars = sorted.filter((p) => !p.data.featured);

    const topFeatured = featured.slice(0, 2);
    if (topFeatured.length < 2) {
      const needed = 2 - topFeatured.length;
      for (const r of regulars.slice(0, needed)) topFeatured.push(r);
    }
    const restFeatured = featured.slice(2);

    const topSet = new Set(topFeatured.map((p) => p.inputPath));
    const restSet = new Set(restFeatured.map((p) => p.inputPath));
    const mainFeedItems = sorted.filter((p) => !topSet.has(p.inputPath));

    return { topFeatured, restFeatured, mainFeedItems, restSet };
  }

  eleventyConfig.addCollection("homeTopFeatured", function (api) {
    return computeHomepageBuckets(api).topFeatured;
  });

  eleventyConfig.addCollection("homeRestFeatured", function (api) {
    return computeHomepageBuckets(api).restFeatured;
  });

  eleventyConfig.addCollection("homeMainFeedItems", function (api) {
    return computeHomepageBuckets(api).mainFeedItems;
  });

  // Paths of rest-featured posts so index.njk can tag their dup'd renders
  // in the main feed with .feed-dup-featured (hidden on desktop).
  eleventyConfig.addCollection("homeRestFeaturedPaths", function (api) {
    return [...computeHomepageBuckets(api).restSet];
  });

  // Groups all posts by month (YYYY-MM), sorted newest-first.
  // Each entry: { key: "2026-04", posts: [...] }
  eleventyConfig.addCollection("postsByMonth", function (collectionApi) {
    const posts = collectionApi.getFilteredByGlob("src/posts/*.md").sort((a, b) => {
      return new Date(b.date) - new Date(a.date);
    });
    const monthMap = new Map();
    for (const post of posts) {
      const d = post.date instanceof Date ? post.date : new Date(post.date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (!monthMap.has(key)) monthMap.set(key, []);
      monthMap.get(key).push(post);
    }
    return [...monthMap.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([key, posts]) => ({ key, posts }));
  });

  return {
    pathPrefix: "/",
    dir: {
      input: "src",
      output: "_site",
      includes: "_includes",
    },
  };
};
