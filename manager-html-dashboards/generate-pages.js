const fs = require("fs");
const path = require("path");
const { PAGE_SLUGS } = require("./src/config");
const { buildSnapshot } = require("./src/dashboard");

const publicDirectory = path.join(__dirname, "public");
const template = fs.readFileSync(path.join(publicDirectory, "manager.html"), "utf8");
const styles = fs.readFileSync(path.join(publicDirectory, "styles.css"), "utf8");
const app = fs.readFileSync(path.join(publicDirectory, "app.js"), "utf8");
const outputDirectory = path.join(__dirname, "output");
fs.mkdirSync(outputDirectory, { recursive: true });

for (const [manager, slug] of Object.entries(PAGE_SLUGS)) {
  const dashboard = buildSnapshot(manager);
  for (const row of dashboard.ics) {
    for (const name of ["scheduled", "sql", "licensed", "metered", "pipeline", "closedWon"]) {
      row[name].records = [];
    }
  }
  for (const week of Object.values(dashboard.weekly)) {
    for (const value of Object.values(week)) value.records = [];
  }
  for (const stage of dashboard.stages) stage.records = [];
  for (const stage of Object.keys(dashboard.featured)) {
    dashboard.featured[stage] = dashboard.featured[stage].map(({ label, subtitle, amount }) => ({
      label,
      subtitle,
      amount
    }));
  }
  const html = template
    .replaceAll("{{MANAGER}}", manager)
    .replace("{{STYLES}}", styles)
    .replace("{{DASHBOARD_DATA}}", JSON.stringify(dashboard).replaceAll("</script", "<\\/script"))
    .replace("{{APP}}", app);
  fs.writeFileSync(
    path.join(outputDirectory, `${slug}.html`),
    html
  );
}

fs.copyFileSync(
  path.join(publicDirectory, "index.html"),
  path.join(outputDirectory, "index.html")
);
