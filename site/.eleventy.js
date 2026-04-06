module.exports = function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy("src/assets");

  eleventyConfig.addFilter("dateDisplay", (dateStr) => {
    return new Date(dateStr).toLocaleDateString("en-GB", {
      day: "numeric", month: "long", year: "numeric",
    });
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

  return {
    pathPrefix: "/positiviteiten/",
    dir: {
      input: "src",
      output: "_site",
      includes: "_includes",
    },
  };
};
