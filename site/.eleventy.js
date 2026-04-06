module.exports = function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy("src/assets");

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

  eleventyConfig.addCollection("posts", function (collectionApi) {
    return collectionApi.getFilteredByGlob("src/posts/*.md").sort((a, b) => {
      return new Date(b.date) - new Date(a.date);
    });
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
    pathPrefix: "/positiviteiten/",
    dir: {
      input: "src",
      output: "_site",
      includes: "_includes",
    },
  };
};
