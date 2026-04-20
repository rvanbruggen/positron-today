// Pull the version from admin/package.json — that's the source of truth
// that /admin/lib/version.ts and the version-bump workflow already keep
// in sync. The root package.json isn't bumped, so reading it here would
// leave the site footer forever stale.
const pkg = require("../../../admin/package.json");

module.exports = {
  version: pkg.version,
  siteName: "Positron Today",
  siteUrl: "https://positron.today",
};
