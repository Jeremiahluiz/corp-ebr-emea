const path = require("node:path");
const { datePart, fiscalQuarter, reportingPeriod, midnight, monday, addDays } = require("../../reporting-time");

const Q1 = Object.freeze({ start: "2026-07-01", end: "2026-10-01" });
const Q1_PAGES = Object.freeze({
  "Gilles Chalon": "q1-fy27-gilles-chalon",
  "Fernando Munoz Drinot": "q1-fy27-fernando-munoz-drinot"
});

function reportContext(asOf, env = process.env) {
  const root = path.resolve(__dirname, "../..");
  const snapshot = env.DASHBOARD_SNAPSHOT;
  if (snapshot && snapshot !== "fy27-q1") throw new Error(`Unsupported snapshot: ${snapshot}`);
  if (!snapshot) {
    const quarter = fiscalQuarter(asOf);
    return {
      snapshot: false, quarter, dataDirectory: root,
      sourceStart: [quarter.start, reportingPeriod(asOf).monday].sort()[0],
      createdUpperBound: `CreatedDate <= ${asOf}`
    };
  }
  if (datePart(asOf) < Q1.end) throw new Error("FY27 Q1 must be completed before snapshot generation");
  if (!env.DASHBOARD_DATA_DIR) throw new Error("Q1 snapshots require an isolated DASHBOARD_DATA_DIR");
  const dataDirectory = path.resolve(env.DASHBOARD_DATA_DIR);
  if (dataDirectory === root) throw new Error("Q1 snapshots must not overwrite weekly source files");
  return {
    snapshot: true, quarter: { ...Q1 }, sourceStart: Q1.start, dataDirectory,
    createdUpperBound: `CreatedDate < ${new Date(midnight(Q1.end)).toISOString()}`
  };
}

function quarterWeeks(quarter) {
  const weeks = [];
  for (let week = monday(quarter.start); week < quarter.end; week = addDays(week, 7)) weeks.push(week);
  return weeks;
}

function q1ReportingPeriod() {
  return {
    start: Q1.start, endInclusive: addDays(Q1.end, -1),
    startInclusive: midnight(Q1.start), endExclusive: midnight(Q1.end),
    timezone: "Europe/Amsterdam", label: "FY27 Q1 completed quarter"
  };
}

module.exports = { Q1, Q1_PAGES, reportContext, quarterWeeks, q1ReportingPeriod };
