const fs = require("fs");
const path = require("path");
const { PAGE_SLUGS } = require("./src/config");
const { buildSnapshot } = require("./src/dashboard");
const { timestamp, reportingPeriod } = require("../reporting-time");
const { reportContext, Q1_PAGES, q1ReportingPeriod } = require("./src/report-context");
const context = reportContext(process.env.DASHBOARD_AS_OF || new Date().toISOString());
const sqlStatus = JSON.parse(fs.readFileSync(path.join(context.dataDirectory, "sales_leader_sql_observation_status.json"), "utf8"));
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
let template = fs.readFileSync(path.join(publicDirectory, "manager.html"), "utf8");
if (context.snapshot) {
  template = template
    .replaceAll("Weekly Performance", "FY27 Q1 Snapshot")
    .replace("WEEKLY PERFORMANCE DASHBOARD", "FY27 Q1 COMPLETED QUARTER")
    .replace("Quarter-to-date activity and pipeline", "Full-quarter activity and pipeline")
    .replace("Previous completed week", "Completed quarter")
    .replace("current quarter to date", "full FY27 Q1 quarter")
    .replace("Saved dashboard. Use the Salesforce report link for current SQL held data.",
      "FY27 Q1 snapshot: July 1-September 30, 2026 (Europe/Amsterdam). Weekly boundary bars include only in-quarter dates. Ownership, pipeline amounts and stages reflect the Salesforce extraction time, not a historical quarter-end reconstruction.");
}
const styles = fs.readFileSync(path.join(publicDirectory, "styles.css"), "utf8");
const app = fs.readFileSync(path.join(publicDirectory, "app.js"), "utf8");
const outputDirectory = path.join(__dirname, "output");
fs.mkdirSync(outputDirectory, { recursive: true });

for (const [manager, slug] of Object.entries(context.snapshot ? Q1_PAGES : PAGE_SLUGS)) {
  const dashboard = buildSnapshot(manager, context.dataDirectory);
  dashboard.generatedAt = timestamp(asOf);
  dashboard.reportingPeriod = context.snapshot ? q1ReportingPeriod() : reportingPeriod(asOf);
  if (context.snapshot) dashboard.periodKind = "quarter";
  dashboard.sqlMethodology = sqlStatus.basis;
  dashboard.qtd.meteredUniqueAccountUplift = dashboard.qtd.meteredClosedWon;
  dashboard.enrichment = {
    metered: { status: "saved_snapshot", asOfDate: closedWon.meteredSnapshotStatus.latestAsOfDate,
      baselineAsOfDate: closedWon.meteredSnapshotStatus.baselineAsOfDate },
    licensed: { status: "saved_source", asOfDate: licensedAsOf },
    roleHistory: { status: "saved_history", asOfDate: roleHistory.source.refreshedAt }
  };
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

if (!context.snapshot) fs.copyFileSync(
  path.join(publicDirectory, "index.html"),
  path.join(outputDirectory, "index.html")
);
