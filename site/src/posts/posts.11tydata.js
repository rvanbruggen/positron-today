// Directory data file for every post under /posts/.
//
// eleventyComputed runs during the data cascade, so anything set here is
// available to both post.njk and its parent base.njk. A {% set %} inside
// post.njk is only locally-scoped and never reaches base.njk — which is why
// every post was previously serving the generic site description as its
// meta/OG description tag.
module.exports = {
  eleventyComputed: {
    description: (data) => {
      const s = data.summary;
      if (!s || typeof s !== "string") return undefined;
      const trimmed = s.trim();
      if (trimmed.length <= 155) return trimmed;
      return trimmed.slice(0, 154).trimEnd() + "…";
    },
  },
};
