const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PAGE_SLUGS } = require("../src/config");

test("shared presentation and all eight standalone pages omit internal SQL notices", () => {
  const files = [
    "public/manager.html", "public/app.js", "generate-pages.js",
    ...Object.values(PAGE_SLUGS).map(slug => `output/${slug}.html`)
  ];
  for (const file of files) {
    const content = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
    assert.doesNotMatch(content,
      /Conservative TracRTC status observations|SQL history coverage:|sql-method|sql-coverage/,
      file);
    if (file.startsWith("output/")) {
      const data = JSON.parse(content.match(/<script>window\.DASHBOARD = ([\s\S]*?);<\/script>/)[1]);
      assert.equal(Object.hasOwn(data, "sqlObservation"), false, file);
      assert.equal(data.reportingPeriod.timezone, "Europe/Amsterdam", file);
    }
  }
});
