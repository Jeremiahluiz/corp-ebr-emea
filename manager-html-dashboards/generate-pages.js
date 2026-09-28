const fs = require("fs");
const path = require("path");
const { PAGE_SLUGS, MANAGERS, DIRECTORS } = require("./src/config");
const { buildSnapshot } = require("./src/dashboard");
const { timestamp, reportingPeriod } = require("../reporting-time");
const sqlStatus = require("../sales_leader_sql_observation_status.json");
const closedWon = require("../sales_leader_closed_won_data.json");
const roleHistory = require("../ebr_role_history.json");
const licensedAsOf = (closedWon.caveats || []).join(" ").match(/Salesforce queried on (\d{4}-\d{2}-\d{2})/)?.[1];
if (!licensedAsOf || !closedWon.meteredSnapshotStatus?.latestAsOfDate || !roleHistory.source?.refreshedAt) {
  throw new Error("Missing revenue or role-history source as-of date");
}
const asOf = process.env.DASHBOARD_AS_OF || sqlStatus.asOf;
if (timestamp(asOf) !== timestamp(sqlStatus.asOf)) {
  throw new Error("Dashboard as-of must match the successful Salesforce observation refresh");
}

const publicDirectory = path.join(__dirname, "public");
const template = fs.readFileSync(path.join(publicDirectory, "manager.html"), "utf8");
const styles = fs.readFileSync(path.join(publicDirectory, "styles.css"), "utf8");
const app = fs.readFileSync(path.join(publicDirectory, "app.js"), "utf8");
const outputDirectory = path.join(__dirname, "output");
fs.mkdirSync(outputDirectory, { recursive: true });

for (const [manager, slug] of Object.entries(PAGE_SLUGS)) {
  const dashboard = buildSnapshot(manager);
  dashboard.generatedAt = timestamp(asOf);
  dashboard.reportingPeriod = reportingPeriod(asOf);
  dashboard.qtd.meteredUniqueAccountUplift = dashboard.qtd.meteredClosedWon;
  dashboard.enrichment = {
    metered: { status: "saved_snapshot", asOfDate: closedWon.meteredSnapshotStatus.latestAsOfDate,
      baselineAsOfDate: closedWon.meteredSnapshotStatus.baselineAsOfDate },
    licensed: { status: "saved_source", asOfDate: licensedAsOf },
    roleHistory: { status: "saved_history", asOfDate: roleHistory.source.refreshedAt }
  };
  const scopedManagers = DIRECTORS[manager]?.managers || [manager];
  const aes = scopedManagers.flatMap(name => MANAGERS[name].assignments.map(a => a.ae));
  const excluded = {};
  for (const ae of aes) {
    for (const [reason, count] of Object.entries(sqlStatus.coverageByAe[ae] || {})) {
      excluded[reason] = (excluded[reason] || 0) + count;
    }
  }
  dashboard.sqlObservation = { asOf: sqlStatus.asOf, basis: sqlStatus.basis, excluded };
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
