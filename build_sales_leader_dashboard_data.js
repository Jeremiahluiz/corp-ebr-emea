const fs = require("fs");
const path = require("path");
const { monday, reportingPeriod } = require("./reporting-time");
const { reportContext, quarterWeeks } = require("./manager-html-dashboards/src/report-context");
const asOf = process.env.DASHBOARD_AS_OF || new Date().toISOString();
const context = reportContext(asOf);
const { dataDirectory } = context;
const auditDirectory = process.env.DASHBOARD_AUDIT_DIR || path.join(__dirname, ".dashboard-audit");

const mapping = JSON.parse(
  fs.readFileSync(path.join(__dirname, "sales_leader_team_mapping.json"), "utf8"),
);
const activity = JSON.parse(
  fs.readFileSync(path.join(dataDirectory, "sales_leader_activity_data.json"), "utf8"),
);
const pipeline = JSON.parse(
  fs.readFileSync(path.join(dataDirectory, "sales_leader_pipeline_data.json"), "utf8"),
);
const closedWon = JSON.parse(
  fs.readFileSync(path.join(__dirname, "sales_leader_closed_won_data.json"), "utf8"),
);
const pipelineStages = JSON.parse(
  fs.readFileSync(path.join(dataDirectory, "sales_leader_pipeline_stage_data.json"), "utf8"),
);
const featuredAccounts = JSON.parse(
  fs.readFileSync(path.join(dataDirectory, "sales_leader_featured_accounts.json"), "utf8"),
);

const normalize = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();

const aliases = {
  amraljarhi: "amraljarhi",
  josepezzi: "josepezzi",
};

const normalized = (value) => aliases[normalize(value)] || normalize(value);
const currentWeek = monday(asOf);
const weeks = context.snapshot ? quarterWeeks(context.quarter) : [...new Set([
  ...Object.keys(activity.scheduled),
  ...Object.keys(activity.sql),
  ...Object.keys(pipeline.licensed),
  ...Object.keys(pipeline.metered),
  currentWeek,
  reportingPeriod(asOf).monday,
])].sort();

const segments = {};
const aeIndex = new Map();
const aeEbrIndex = new Map();

for (const [segment, leaders] of Object.entries(mapping)) {
  segments[segment] = { leaders: {} };
  for (const [leaderName, entries] of Object.entries(leaders)) {
    const ics = entries.map(({ ae, ebr }) => ({
      ae,
      ebr,
      scheduled: 0,
      sql: 0,
      licensed: 0,
      metered: 0,
      licensedClosedWon: 0,
      meteredClosedWon: 0,
      closedWon: 0,
      stagePipeline: {},
    }));
    const weekly = Object.fromEntries(
      weeks.map((week) => [
        week,
        { scheduled: 0, sql: 0, licensed: 0, metered: 0, pipeline: 0 },
      ]),
    );
    segments[segment].leaders[leaderName] = {
      scheduled: 0,
      sql: 0,
      licensed: 0,
      metered: 0,
      licensedClosedWon: 0,
      meteredClosedWon: 0,
      closedWon: 0,
      stagePipeline: {},
      featuredAccounts: {
        "Business Selected": [],
        "Closed Won": [],
      },
      weekly,
      ics,
    };
    for (const ic of ics) {
      if (aeIndex.has(normalized(ic.ae))) throw new Error(`Duplicate mapped AE: ${ic.ae}`);
      aeIndex.set(normalized(ic.ae), { segment, leaderName, ic });
      aeEbrIndex.set(`${normalized(ic.ae)}\u0000${normalized(ic.ebr)}`, { segment, leaderName, ic });
    }
  }
}

const unmapped = {
  scheduled: [],
  sql: [],
  licensed: [],
  metered: [],
  closedWon: [],
  stagePipeline: [],
  featuredAccounts: [],
};

function add(metric, week, record) {
  const match = aeEbrIndex.get(`${normalized(record.ae)}\u0000${normalized(record.ebr)}`);
  if (!match) {
    const mappedAe = aeIndex.get(normalized(record.ae));
    unmapped[metric].push({
      week,
      ...record,
      reason: mappedAe ? "ae_ebr_mapping_mismatch" : "ae_not_mapped",
      mappedManager: mappedAe?.leaderName || null,
      mappedEbr: mappedAe?.ic.ebr || null
    });
    return;
  }
  const leader = segments[match.segment].leaders[match.leaderName];
  if (!Number.isFinite(record.qtdValue)) throw new Error("Refresh required: missing quarter-specific source value");
  leader[metric] += record.qtdValue;
  leader.weekly[week][metric] += record.value;
  leader.weekly[week].pipeline =
    leader.weekly[week].licensed + leader.weekly[week].metered;
  match.ic[metric] += record.qtdValue;
}

for (const metric of ["scheduled", "sql"]) {
  for (const [week, records] of Object.entries(activity[metric])) {
    for (const record of records) add(metric, week, record);
  }
}

for (const metric of ["licensed", "metered"]) {
  for (const [week, records] of Object.entries(pipeline[metric])) {
    for (const record of records) add(metric, week, record);
  }
}

for (const opportunity of closedWon.opportunities) {
  const match = aeIndex.get(normalized(opportunity.owner));
  const value = opportunity.amount || 0;
  if (!match) {
    unmapped.closedWon.push({
      id: opportunity.id,
      ae: opportunity.owner,
      value,
    });
    continue;
  }
  const leader = segments[match.segment].leaders[match.leaderName];
  leader.licensedClosedWon += value;
  leader.closedWon += value;
  match.ic.licensedClosedWon += value;
  match.ic.closedWon += value;
}

for (const milestone of closedWon.meteredMilestones || []) {
  const match = aeIndex.get(normalized(milestone.owner));
  const value = milestone.amount || 0;
  if (!match) {
    unmapped.closedWon.push({
      id: milestone.id,
      ae: milestone.owner,
      value,
      type: "metered"
    });
    continue;
  }
  const leader = segments[match.segment].leaders[match.leaderName];
  leader.meteredClosedWon += value;
  leader.closedWon += value;
  match.ic.meteredClosedWon += value;
  match.ic.closedWon += value;
}

for (const entry of pipelineStages.entries) {
  const match = aeIndex.get(normalized(entry.ae));
  if (!match) {
    unmapped.stagePipeline.push(entry);
    continue;
  }
  const leader = segments[match.segment].leaders[match.leaderName];
  leader.stagePipeline[entry.stage] =
    (leader.stagePipeline[entry.stage] || 0) + entry.total;
  match.ic.stagePipeline[entry.stage] =
    (match.ic.stagePipeline[entry.stage] || 0) + entry.total;
}

for (const entry of featuredAccounts.entries) {
  const match = aeIndex.get(normalized(entry.ae));
  if (!match) {
    unmapped.featuredAccounts.push(entry);
    continue;
  }
  const leader = segments[match.segment].leaders[match.leaderName];
  if (!leader.featuredAccounts[entry.stage]) {
    leader.featuredAccounts[entry.stage] = [];
  }
  leader.featuredAccounts[entry.stage].push(entry);
}

fs.writeFileSync(
  path.join(dataDirectory, "sales_leader_dashboard_data.json"),
  `${JSON.stringify({
    quarter: context.quarter,
    weeks,
    pipelineStages: pipelineStages.stages,
    segments,
    unmapped,
  }, null, 2)}\n`,
);

const mappedTotals = {};
const segmentTotals = {};
for (const segment of Object.values(segments)) {
  for (const [leaderName, leader] of Object.entries(segment.leaders)) {
    mappedTotals[leaderName] = {
      scheduled: leader.scheduled,
      sql: leader.sql,
      licensed: leader.licensed,
      metered: leader.metered
    };
  }
}
for (const [segmentName, segment] of Object.entries(segments)) {
  segmentTotals[segmentName] = Object.values(segment.leaders).reduce((total, leader) => ({
    scheduled: total.scheduled + leader.scheduled,
    sql: total.sql + leader.sql,
    licensed: total.licensed + leader.licensed,
    metered: total.metered + leader.metered
  }), { scheduled: 0, sql: 0, licensed: 0, metered: 0 });
}
const sourcePipelineTotals = {};
for (const metric of ["licensed", "metered"]) {
  sourcePipelineTotals[metric] = Object.values(pipeline[metric]).flat()
    .reduce((sum, record) => sum + record.qtdValue, 0);
}
const mappedPipelineTotals = Object.values(mappedTotals).reduce((total, leader) => ({
  licensed: total.licensed + leader.licensed,
  metered: total.metered + leader.metered
}), { licensed: 0, metered: 0 });
const unmappedPipelineTotals = {
  licensed: unmapped.licensed.reduce((sum, record) => sum + record.qtdValue, 0),
  metered: unmapped.metered.reduce((sum, record) => sum + record.qtdValue, 0)
};
const stagePipelineTotal = pipelineStages.entries.reduce((sum, record) => sum + record.total, 0);
const nearlyEqual = (left, right) => Math.abs(left - right) < 0.005;
for (const metric of ["licensed", "metered"]) {
  if (!nearlyEqual(
    sourcePipelineTotals[metric],
    mappedPipelineTotals[metric] + unmappedPipelineTotals[metric]
  )) {
    throw new Error(`Pipeline reconciliation failed for ${metric}`);
  }
}
if (!nearlyEqual(
  stagePipelineTotal,
  sourcePipelineTotals.licensed + sourcePipelineTotals.metered
)) {
  throw new Error("Pipeline stage reconciliation failed");
}
fs.mkdirSync(auditDirectory, { recursive: true });
fs.writeFileSync(
  path.join(auditDirectory, "dashboard-attribution-audit.json"),
  `${JSON.stringify({
    asOf,
    quarter: context.quarter,
    mappedTotals,
    segmentTotals,
    pipelineReconciliation: {
      source: sourcePipelineTotals,
      mapped: mappedPipelineTotals,
      unmapped: unmappedPipelineTotals,
      stages: stagePipelineTotal
    },
    unmapped
  }, null, 2)}\n`
);
