const { DIRECTORS, EBR_USERS, MANAGERS, ROOT } = require("./config");
const fs = require("fs");
const path = require("path");

const STAGES = [
  "Problem Identification & Research",
  "Qualified",
  "Proposal & Negotiation",
  "Business Selected",
  "Verbal Agreement",
  "Pending Acceptance",
  "Closed Won",
  "Closed Lost",
  "Manage & Optimize",
  "Omit"
];
const normalize = (value) =>
  String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/gi, "").toLowerCase();
const datePart = (value) => String(value || "").slice(0, 10);
const number = (value) => Number(value || 0);
const roundMoney = (value) =>
  Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const monday = (value) => {
  const date = new Date(`${datePart(value)}T00:00:00Z`);
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - (day === 0 ? 6 : day - 1));
  return date.toISOString().slice(0, 10);
};
const addDays = (value, days) => {
  const date = new Date(`${datePart(value)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
const inRange = (value, start, end) => datePart(value) >= start && datePart(value) < end;
const isAnnaJuly = (ebr, value) =>
  ebr === "Anna Sobala" && datePart(value) >= "2026-07-01" && datePart(value) < "2026-08-01";
const metric = () => ({ value: 0, records: [] });
const recordUrl = (instanceUrl, type, id) =>
  instanceUrl
    ? `${instanceUrl}/lightning/r/${type}/${id}/view`
    : `https://login.salesforce.com/${id}`;

function fiscalQuarter(value = new Date()) {
  const date = new Date(value);
  const month = date.getUTCMonth();
  const year = date.getUTCFullYear();
  const fiscalStartYear = month >= 6 ? year : year - 1;
  const index = Math.floor(((month - 6 + 12) % 12) / 3);
  const start = new Date(Date.UTC(fiscalStartYear, 6 + index * 3, 1));
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 3, 1));
  return { start: datePart(start.toISOString()), end: datePart(end.toISOString()) };
}

function weeksInQuarter(quarter) {
  const result = [];
  const today = datePart(new Date().toISOString());
  const end = today >= quarter.start && today < quarter.end
    ? addDays(monday(today), 7)
    : quarter.end;
  for (let week = monday(quarter.start); week < end; week = addDays(week, 7)) result.push(week);
  return result;
}

function emptyDashboard(managerName, quarter, instanceUrl) {
  const manager = MANAGERS[managerName];
  const weeks = weeksInQuarter(quarter);
  return {
    manager: managerName,
    segment: manager.segment,
    quarter,
    generatedAt: new Date().toISOString(),
    instanceUrl,
    weeks,
    qtd: {
      scheduled: 0,
      sql: 0,
      licensed: 0,
      metered: 0,
      pipeline: 0,
      licensedClosedWon: 0,
      meteredClosedWon: 0,
      meteredUniqueAccountUplift: 0,
      closedWon: 0
    },
    weekly: Object.fromEntries(weeks.map((week) => [week, {
      scheduled: metric(), sql: metric(), licensed: metric(), metered: metric(), pipeline: metric()
    }])),
    ics: manager.assignments.map(({ ae, ebr }) => ({
      ae, ebr, scheduled: metric(), sql: metric(), licensed: metric(),
      metered: metric(), pipeline: metric(), licensedClosedWon: metric(),
      meteredClosedWon: metric(), closedWon: metric()
    })),
    stages: [],
    featured: { "Business Selected": [], "Closed Won": [] },
    breakdownType: "ic",
    tableTitle: "IC breakdown",
    tablePrimaryHeader: "AE / IC",
    tableSecondaryHeader: "EBR"
  };
}

function directorRow(managerName, leader) {
  const ebrs = [...new Set(leader.ics.map(({ ebr }) => ebr).filter(Boolean))];
  const row = {
    ae: managerName,
    ebr: ebrs.join(", "),
    scheduled: metric(),
    sql: metric(),
    licensed: metric(),
    metered: metric(),
    pipeline: metric(),
    licensedClosedWon: metric(),
    meteredClosedWon: metric(),
    closedWon: metric()
  };
  for (const name of [
    "scheduled",
    "sql",
    "licensed",
    "metered",
    "licensedClosedWon",
    "meteredClosedWon",
    "closedWon"
  ]) {
    row[name].value = leader[name] || 0;
  }
  row.pipeline.value = row.licensed.value + row.metered.value;
  return row;
}

function buildDirectorSnapshot(directorName, data, closedWon, featured) {
  const director = DIRECTORS[directorName];
  const leaders = director.managers.map((managerName) => [
    managerName,
    data.segments[director.segment].leaders[managerName]
  ]);
  const quarter = { start: "2026-07-01", end: "2026-10-01" };
  const dashboard = {
    manager: directorName,
    segment: director.segment,
    quarter,
    generatedAt: new Date().toISOString(),
    weeks: data.weeks,
    qtd: {
      scheduled: 0,
      sql: 0,
      licensed: 0,
      metered: 0,
      pipeline: 0,
      licensedClosedWon: 0,
      meteredClosedWon: 0,
      meteredUniqueAccountUplift: 0,
      closedWon: 0
    },
    weekly: Object.fromEntries(data.weeks.map((week) => [week, {
      scheduled: metric(),
      sql: metric(),
      licensed: metric(),
      metered: metric(),
      pipeline: metric()
    }])),
    ics: leaders.map(([managerName, leader]) => directorRow(managerName, leader)),
    stages: [],
    featured: { "Business Selected": [], "Closed Won": [] },
    breakdownType: "manager",
    tableTitle: "Manager breakdown",
    tablePrimaryHeader: "Manager",
    tableSecondaryHeader: "EBR coverage",
    closedWonPanelTitle: "EBR-attributed revenue details",
    snapshot: true,
    meteredSnapshotStatus: closedWon.meteredSnapshotStatus
  };

  for (const [, leader] of leaders) {
    for (const name of [
      "scheduled",
      "sql",
      "licensed",
      "metered",
      "licensedClosedWon",
      "meteredClosedWon",
      "closedWon"
    ]) {
      dashboard.qtd[name] += leader[name] || 0;
    }
    for (const week of data.weeks) {
      for (const name of ["scheduled", "sql", "licensed", "metered", "pipeline"]) {
        dashboard.weekly[week][name].value += leader.weekly[week]?.[name] || 0;
      }
    }
  }
  for (const name of [
    "licensed",
    "metered",
    "licensedClosedWon",
    "meteredClosedWon",
    "closedWon"
  ]) {
    dashboard.qtd[name] = roundMoney(dashboard.qtd[name]);
  }
  dashboard.qtd.pipeline = roundMoney(
    dashboard.qtd.licensed + dashboard.qtd.metered
  );
  dashboard.qtd.meteredUniqueAccountUplift = dashboard.qtd.meteredClosedWon;

  dashboard.stages = STAGES.map((stage) => ({
    stage,
    value: leaders.reduce(
      (sum, [, leader]) => sum + (leader.stagePipeline[stage] || 0),
      0
    ),
    records: []
  })).filter(({ value }) => value > 0);

  const directorAes = new Set(
    director.managers.flatMap((managerName) =>
      MANAGERS[managerName].assignments.map(({ ae }) => normalize(ae))
    )
  );
  const managerByAe = new Map(
    director.managers.flatMap((managerName) =>
      MANAGERS[managerName].assignments.map(({ ae }) => [
        normalize(ae),
        managerName
      ])
    )
  );
  for (const entry of featured.entries.filter((item) =>
    directorAes.has(normalize(item.ae))
  )) {
    dashboard.featured[entry.stage].push({
      id: entry.opportunityId,
      label: entry.opportunityName,
      subtitle: `AE: ${entry.ae}`,
      amount: entry.total,
      url: recordUrl(process.env.SF_INSTANCE_URL, "Opportunity", entry.opportunityId)
    });
  }
  dashboard.featured["Closed Won"] = [];
  for (const opportunity of (closedWon.opportunities || []).filter((item) =>
    directorAes.has(normalize(item.owner))
  )) {
    dashboard.featured["Closed Won"].push({
      id: opportunity.id,
      label: opportunity.name,
      subtitle: `Licensed Closed Won · ${(opportunity.attributionEbrs || []).join(", ")} · ${managerByAe.get(normalize(opportunity.owner))} · Closed ${opportunity.closeDate}`,
      amount: opportunity.amount,
      url: recordUrl(process.env.SF_INSTANCE_URL, "Opportunity", opportunity.id)
    });
  }
  for (const milestone of (closedWon.meteredMilestones || []).filter((item) =>
    directorAes.has(normalize(item.owner))
  )) {
    dashboard.featured["Closed Won"].push({
      id: milestone.id,
      label: milestone.opportunityName || milestone.accountName,
      subtitle: `Metered Commission ARR · ${milestone.product} · ${milestone.ebr} · ${managerByAe.get(normalize(milestone.owner))} · ${milestone.name}`,
      amount: milestone.amount,
      url: recordUrl(
        process.env.SF_INSTANCE_URL,
        "Product_Milestone__c",
        milestone.id
      )
    });
  }
  return dashboard;
}

function aggregateLive(managerName, quarter, source) {
  const dashboard = emptyDashboard(managerName, quarter, source.instanceUrl);
  const aeMap = new Map(dashboard.ics.map((row) => [normalize(row.ae), row]));
  const namesById = source.namesById;
  const stageMap = new Map();
  const add = (name, ae, value, record, date) => {
    const row = aeMap.get(normalize(ae));
    if (!row) return false;
    row[name].value += value;
    row[name].records.push(record);
    if (date && dashboard.weekly[monday(date)]?.[name]) {
      dashboard.weekly[monday(date)][name].value += value;
      dashboard.weekly[monday(date)][name].records.push(record);
    }
    return true;
  };
  for (const event of source.events) {
    const ebr = namesById[event.CreatedById];
    const ae = event.Account?.Owner?.Name;
    const record = {
      id: event.Id,
      label: event.Subject || "Salesforce Event",
      subtitle: `${event.Account?.Name || "No account"} · ${ebr}`,
      url: recordUrl(source.instanceUrl, "Event", event.Id)
    };
    if (inRange(event.CreatedDate, quarter.start, quarter.end) && !isAnnaJuly(ebr, event.CreatedDate)) {
      add("scheduled", ae, 1, record, event.CreatedDate);
    }
    if (event.Meeting_Status__c === "Held" && inRange(event.StartDateTime, quarter.start, quarter.end) && !isAnnaJuly(ebr, event.StartDateTime)) {
      add("sql", ae, 1, record, event.StartDateTime);
    }
  }
  const attribution = new Map();
  for (const opportunity of source.directOpportunities) {
    const ebr = namesById[opportunity.CreatedById];
    if (!isAnnaJuly(ebr, opportunity.CreatedDate)) {
      attribution.set(opportunity.Id, { ebr, date: opportunity.CreatedDate });
    }
  }
  for (const quote of source.quotes) {
    const ebr = namesById[quote.CreatedById];
    const opportunityId = quote[source.quoteOpportunityField];
    if (!isAnnaJuly(ebr, quote.CreatedDate) && !attribution.has(opportunityId)) {
      attribution.set(opportunityId, { ebr, date: quote.CreatedDate });
    }
  }
  const pipelineRecords = [];
  for (const [id, credit] of attribution) {
    const opportunity = source.opportunityById.get(id);
    if (!opportunity) throw new Error(`Salesforce did not return attributed opportunity ${id}`);
    if (!["Order", "Upgrade"].includes(opportunity.Type)) continue;
    const amount = number(opportunity.License_New_ARR_10__c) +
      number(opportunity.License_Upsell_ARR_10__c) +
      number(opportunity.Net_Services_Amount__c) +
      number(opportunity.Support_New_ARR_10__c) +
      number(opportunity.Support_Upsell_ARR_10__c);
    if (amount > 0) pipelineRecords.push({
      kind: "licensed", amount, date: credit.date, ebr: credit.ebr,
      ae: opportunity.Owner?.Name, stage: opportunity.StageName,
      id: opportunity.Id, type: "Opportunity", opportunityId: opportunity.Id,
      label: opportunity.Name
    });
  }
  for (const milestone of source.milestones) {
    const ebr = namesById[milestone.CreatedById];
    if (!inRange(milestone.CreatedDate, quarter.start, quarter.end) || isAnnaJuly(ebr, milestone.CreatedDate)) continue;
    const amount = number(milestone.Total_Expected_Change__c) * 3;
    if (amount > 0) pipelineRecords.push({
      kind: "metered", amount, date: milestone.CreatedDate, ebr,
      ae: milestone.Opportunity__r?.Owner?.Name, stage: milestone.Opportunity__r?.StageName,
      id: milestone.Id, type: "Product_Milestone__c", opportunityId: milestone.Opportunity__c,
      label: milestone.Opportunity__r?.Name || milestone.Name
    });
  }
  for (const entry of pipelineRecords) {
    const record = {
      id: entry.id,
      label: entry.label,
      subtitle: `${entry.ebr} · ${entry.stage || "No stage"}`,
      amount: entry.amount,
      url: recordUrl(source.instanceUrl, entry.type, entry.id),
      opportunityUrl: recordUrl(source.instanceUrl, "Opportunity", entry.opportunityId)
    };
    if (!add(entry.kind, entry.ae, entry.amount, record, entry.date)) continue;
    add("pipeline", entry.ae, entry.amount, record, entry.date);
    const stage = entry.stage || "Unknown";
    const bucket = stageMap.get(stage) || { stage, value: 0, records: [] };
    bucket.value += entry.amount;
    bucket.records.push(record);
    stageMap.set(stage, bucket);
    if (dashboard.featured[stage]) dashboard.featured[stage].push(record);
  }
  const wonById = new Map();
  for (const opportunity of source.wonDirect) {
    const ebr = namesById[opportunity.CreatedById];
    if (!isAnnaJuly(ebr, opportunity.CreatedDate)) wonById.set(opportunity.Id, { opportunity, ebr });
  }
  for (const milestone of source.milestones) {
    const opportunity = milestone.Opportunity__r;
    const ebr = namesById[milestone.CreatedById];
    if (opportunity?.IsWon && inRange(opportunity.CloseDate, quarter.start, quarter.end) && !isAnnaJuly(ebr, milestone.CreatedDate) && !wonById.has(milestone.Opportunity__c)) {
      wonById.set(milestone.Opportunity__c, { opportunity: {
        Id: milestone.Opportunity__c, Name: opportunity.Name, Owner: opportunity.Owner,
        Amount: opportunity.Amount, CloseDate: opportunity.CloseDate
      }, ebr });
    }
  }
  for (const { opportunity, ebr } of wonById.values()) {
    const record = {
      id: opportunity.Id,
      label: opportunity.Name,
      subtitle: `${ebr} · Closed ${opportunity.CloseDate}`,
      amount: number(opportunity.Amount),
      url: recordUrl(source.instanceUrl, "Opportunity", opportunity.Id)
    };
    add(
      "licensedClosedWon",
      opportunity.Owner?.Name,
      number(opportunity.Amount),
      record,
      null
    );
    add(
      "closedWon",
      opportunity.Owner?.Name,
      number(opportunity.Amount),
      record,
      null
    );
  }
  for (const row of dashboard.ics) {
    for (const name of [
      "scheduled",
      "sql",
      "licensed",
      "metered",
      "pipeline",
      "licensedClosedWon",
      "meteredClosedWon",
      "closedWon"
    ]) {
      dashboard.qtd[name] += row[name].value;
    }
  }
  dashboard.stages = [...stageMap.values()].sort((a, b) => {
    const ai = STAGES.indexOf(a.stage);
    const bi = STAGES.indexOf(b.stage);
    return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
  });
  return dashboard;
}

function buildSnapshot(managerName) {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, "sales_leader_dashboard_data.json"), "utf8"));
  const closedWon = JSON.parse(fs.readFileSync(path.join(ROOT, "sales_leader_closed_won_data.json"), "utf8"));
  const featured = JSON.parse(fs.readFileSync(path.join(ROOT, "sales_leader_featured_accounts.json"), "utf8"));
  if (DIRECTORS[managerName]) {
    return buildDirectorSnapshot(managerName, data, closedWon, featured);
  }
  const segment = Object.keys(data.segments).find((name) => data.segments[name].leaders[managerName]);
  const leader = data.segments[segment].leaders[managerName];
  const quarter = { start: "2026-07-01", end: "2026-10-01" };
  const dashboard = emptyDashboard(managerName, quarter, process.env.SF_INSTANCE_URL);
  dashboard.weeks = data.weeks;
  dashboard.weekly = Object.fromEntries(data.weeks.map((week) => [week, {
    scheduled: metric(), sql: metric(), licensed: metric(), metered: metric(), pipeline: metric()
  }]));
  for (const [week, values] of Object.entries(leader.weekly)) {
    if (!dashboard.weekly[week]) continue;
    for (const name of ["scheduled", "sql", "licensed", "metered", "pipeline"]) {
      dashboard.weekly[week][name].value = values[name];
    }
  }
  for (const row of dashboard.ics) {
    const source = leader.ics.find((item) => normalize(item.ae) === normalize(row.ae));
    if (!source) continue;
    for (const name of [
      "scheduled",
      "sql",
      "licensed",
      "metered",
      "licensedClosedWon",
      "meteredClosedWon",
      "closedWon"
    ]) {
      row[name].value = source[name] || 0;
    }
    row.pipeline.value = source.licensed + source.metered;
  }
  dashboard.qtd = {
    scheduled: leader.scheduled,
    sql: leader.sql,
    licensed: leader.licensed,
    metered: leader.metered,
    pipeline: leader.licensed + leader.metered,
    licensedClosedWon: leader.licensedClosedWon ?? leader.closedWon,
    meteredClosedWon: leader.meteredClosedWon || 0,
    meteredUniqueAccountUplift: closedWon.meteredUniqueAccountUplift || 0,
    closedWon: leader.closedWon
  };
  dashboard.stages = STAGES.map((stage) => ({
    stage,
    value: leader.stagePipeline[stage] || 0,
    records: []
  })).filter((entry) => entry.value > 0);
  const managerAes = new Set(MANAGERS[managerName].assignments.map(({ ae }) => normalize(ae)));
  for (const entry of featured.entries.filter((item) => managerAes.has(normalize(item.ae)))) {
    dashboard.featured[entry.stage].push({
      id: entry.opportunityId,
      label: entry.opportunityName,
      subtitle: `AE: ${entry.ae}`,
      amount: entry.total,
      url: recordUrl(process.env.SF_INSTANCE_URL, "Opportunity", entry.opportunityId)
    });
  }
  for (const opportunity of closedWon.opportunities.filter((item) => managerAes.has(normalize(item.owner)))) {
    const row = dashboard.ics.find((item) => normalize(item.ae) === normalize(opportunity.owner));
    if (row) row.closedWon.records.push({
      id: opportunity.id,
      label: opportunity.name,
      subtitle: `Closed ${opportunity.closeDate}`,
      amount: opportunity.amount,
      url: recordUrl(process.env.SF_INSTANCE_URL, "Opportunity", opportunity.id)
    });
  }
  for (const milestone of (closedWon.meteredMilestones || []).filter((item) =>
    managerAes.has(normalize(item.owner))
  )) {
    const row = dashboard.ics.find(
      (item) => normalize(item.ae) === normalize(milestone.owner)
    );
    if (row) {
      row.closedWon.records.push({
        id: milestone.id,
        label: milestone.accountName,
        subtitle: `${milestone.ebr} · Metered Commission ARR`,
        amount: milestone.amount,
        url: recordUrl(
          process.env.SF_INSTANCE_URL,
          "Product_Milestone__c",
          milestone.id
        )
      });
    }
  }
  dashboard.meteredSnapshotStatus = closedWon.meteredSnapshotStatus;
  dashboard.snapshot = true;
  return dashboard;
}

module.exports = {
  aggregateLive,
  buildDirectorSnapshot,
  buildSnapshot,
  fiscalQuarter,
  monday
};
