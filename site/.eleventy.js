module.exports = function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy("src/assets");

  eleventyConfig.addFilter("dateDisplay", (dateStr) => {
    return new Date(dateStr).toLocaleDateString("en-GB", {
      day: "numeric", month: "long", year: "numeric",
    });
  });

  // Returns one of 10 colour names based on a 1-based loop index.
  // The sequence is shuffled so adjacent cards rarely share a colour.
  const CARD_COLORS = [
    "yellow", "teal", "rose", "blue", "lime",
    "purple", "orange", "cyan", "green", "pink",
  ];
  eleventyConfig.addFilter("cardColor", (index) => {
    return CARD_COLORS[(Number(index) - 1) % CARD_COLORS.length];
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
