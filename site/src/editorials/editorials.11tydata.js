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
