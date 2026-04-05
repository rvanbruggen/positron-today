// Pulls the version from the root package.json so the site footer
// always shows the same version as the admin.
const pkg = require("../../../package.json");

module.exports = {
  version: pkg.version,
  siteName: "Positiviteiten",
};
