const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PAGE_SLUGS } = require("../src/config");

test("shared presentation and all eight standalone pages omit internal SQL coverage", () => {
  const files = [
    "public/manager.html", "public/app.js", "generate-pages.js",
    ...Object.values(PAGE_SLUGS).map(slug => `output/${slug}.html`)
  ];
  for (const file of files) {
    const content = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
    assert.doesNotMatch(content,
      /SQL history coverage:|sql-coverage|coverageByAe/,
      file);
    if (file.startsWith("output/")) {
      const data = JSON.parse(content.match(/<script>window\.DASHBOARD = ([\s\S]*?);<\/script>/)[1]);
      assert.equal(Object.hasOwn(data, "sqlObservation"), false, file);
      assert.equal(data.reportingPeriod.timezone, "Europe/Amsterdam", file);
    }
  }
});

test("public presentation renders the conservative SQL methodology", () => {
  const template = fs.readFileSync(path.join(__dirname, "../public/manager.html"), "utf8");
  const app = fs.readFileSync(path.join(__dirname, "../public/app.js"), "utf8");
  assert.match(template, /id="sql-methodology"/);
  assert.match(app, /byId\("sql-methodology"\)\.textContent = data\.sqlMethodology/);
});
