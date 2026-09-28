const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { EBR_USERS } = require("./manager-html-dashboards/src/config");

const ROOT = __dirname;
const cliPackage = "@salesforce/cli@2.150.6";
const orgAlias = process.env.SF_ORG_ALIAS || "ebr-dashboard";
const quarter = { start: "2026-07-01", end: "2026-10-01" };
const asOf = process.env.DASHBOARD_AS_OF || new Date().toISOString();
const namesById = Object.fromEntries(
  Object.entries(EBR_USERS).map(([name, id]) => [id, name])
);
const userIds = Object.values(EBR_USERS);

function query(soql) {
  const stdout = execFileSync(
    "npx",
    [
      "--yes",
      cliPackage,
      "data",
      "query",
      "--target-org",
      orgAlias,
      "--query",
      soql,
      "--result-format",
      "json",
      "--json"
    ],
    { encoding: "utf8", maxBuffer: 100 * 1024 * 1024 }
  );
  const payload = JSON.parse(stdout);
  if (payload.status !== 0) throw new Error(payload.message || "Salesforce query failed");
  return payload.result.records;
}

function quote(value) {
  return `'${String(value).replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

function datePart(value) {
  return String(value || "").slice(0, 10);
}

function monday(value) {
  const date = new Date(`${datePart(value)}T00:00:00Z`);
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - (day === 0 ? 6 : day - 1));
  return date.toISOString().slice(0, 10);
}

function number(value) {
  return Number(value || 0);
}

function isAnnaJuly(ebr, value) {
  const date = datePart(value);
  return ebr === "Anna Sobala" && date >= "2026-07-01" && date < "2026-08-01";
}

function addGrouped(target, week, ebr, ae, value) {
  if (!target[week]) target[week] = [];
  const existing = target[week].find(
    (record) => record.ebr === ebr && record.ae === ae
  );
  if (existing) {
    existing.value += value;
  } else {
    target[week].push({ ebr, ae: ae || "UNMAPPED", value });
  }
}

function licensedAmount(opportunity) {
  return (
    number(opportunity.License_New_ARR_10__c) +
    number(opportunity.License_Upsell_ARR_10__c) +
    number(opportunity.Net_Services_Amount__c) +
    number(opportunity.Support_New_ARR_10__c) +
    number(opportunity.Support_Upsell_ARR_10__c)
  );
}

function main() {
  const ids = userIds.map(quote).join(",");
  const scheduled = query(
    `SELECT Id, CreatedById, CreatedDate, Account.Owner.Name FROM Event ` +
      `WHERE CreatedById IN (${ids}) AND CreatedDate >= ${quarter.start}T00:00:00Z ` +
      `AND CreatedDate <= ${asOf}`
  );
  const held = query(
    `SELECT Id, CreatedById, StartDateTime, Meeting_Status__c, Account.Owner.Name FROM Event ` +
      `WHERE CreatedById IN (${ids}) AND Meeting_Status__c = 'Held' ` +
      `AND StartDateTime >= ${quarter.start}T00:00:00Z AND StartDateTime <= ${asOf}`
  );

  const activity = { scheduled: {}, sql: {} };
  for (const event of scheduled) {
    const ebr = namesById[event.CreatedById];
    if (isAnnaJuly(ebr, event.CreatedDate)) continue;
    addGrouped(
      activity.scheduled,
      monday(event.CreatedDate),
      ebr,
      event.Account?.Owner?.Name,
      1
    );
  }
  for (const event of held) {
    const ebr = namesById[event.CreatedById];
    if (isAnnaJuly(ebr, event.StartDateTime)) continue;
    addGrouped(
      activity.sql,
      monday(event.StartDateTime),
      ebr,
      event.Account?.Owner?.Name,
      1
    );
  }

  const opportunityFields = [
    "Id",
    "Name",
    "CreatedById",
    "CreatedDate",
    "Owner.Name",
    "StageName",
    "Type",
    "Quote_Flag__c",
    "License_New_ARR_10__c",
    "License_Upsell_ARR_10__c",
    "Net_Services_Amount__c",
    "Support_New_ARR_10__c",
    "Support_Upsell_ARR_10__c"
  ].join(",");
  const direct = query(
    `SELECT ${opportunityFields} FROM Opportunity WHERE CreatedById IN (${ids}) ` +
      `AND CreatedDate >= ${quarter.start}T00:00:00Z AND CreatedDate <= ${asOf} ` +
      `AND Type IN ('Order','Upgrade') AND Quote_Flag__c = 'Approved'`
  );
  const quotes = query(
    `SELECT Id, CreatedById, CreatedDate, SBQQ__Opportunity2__c, ` +
      `SBQQ__Opportunity2__r.Name, SBQQ__Opportunity2__r.Owner.Name, ` +
      `SBQQ__Opportunity2__r.StageName, SBQQ__Opportunity2__r.Type, ` +
      `SBQQ__Opportunity2__r.Quote_Flag__c, ` +
      `SBQQ__Opportunity2__r.License_New_ARR_10__c, ` +
      `SBQQ__Opportunity2__r.License_Upsell_ARR_10__c, ` +
      `SBQQ__Opportunity2__r.Net_Services_Amount__c, ` +
      `SBQQ__Opportunity2__r.Support_New_ARR_10__c, ` +
      `SBQQ__Opportunity2__r.Support_Upsell_ARR_10__c ` +
      `FROM SBQQ__Quote__c WHERE CreatedById IN (${ids}) ` +
      `AND CreatedDate >= ${quarter.start}T00:00:00Z AND CreatedDate <= ${asOf}`
  );
  const milestones = query(
    `SELECT Id, CreatedById, CreatedDate, Opportunity__c, Total_Expected_Change__c, ` +
      `Opportunity__r.Name, Opportunity__r.Owner.Name, Opportunity__r.StageName ` +
      `FROM Product_Milestone__c WHERE CreatedById IN (${ids}) ` +
      `AND CreatedDate >= ${quarter.start}T00:00:00Z AND CreatedDate <= ${asOf}`
  );

  const licensedByOpportunity = new Map();
  for (const opportunity of direct) {
    const ebr = namesById[opportunity.CreatedById];
    if (isAnnaJuly(ebr, opportunity.CreatedDate)) continue;
    licensedByOpportunity.set(opportunity.Id, {
      opportunity,
      ebr,
      creditDate: opportunity.CreatedDate
    });
  }
  for (const quoteRecord of quotes) {
    if (licensedByOpportunity.has(quoteRecord.SBQQ__Opportunity2__c)) continue;
    const opportunity = quoteRecord.SBQQ__Opportunity2__r;
    const ebr = namesById[quoteRecord.CreatedById];
    if (
      !opportunity ||
      !["Order", "Upgrade"].includes(opportunity.Type) ||
      opportunity.Quote_Flag__c !== "Approved" ||
      isAnnaJuly(ebr, quoteRecord.CreatedDate)
    ) {
      continue;
    }
    licensedByOpportunity.set(quoteRecord.SBQQ__Opportunity2__c, {
      opportunity: { Id: quoteRecord.SBQQ__Opportunity2__c, ...opportunity },
      ebr,
      creditDate: quoteRecord.CreatedDate
    });
  }

  const pipeline = { licensed: {}, metered: {} };
  const stageByAe = new Map();
  const featuredByOpportunity = new Map();
  const addPipelineRecord = (kind, record) => {
    addGrouped(
      pipeline[kind],
      monday(record.creditDate),
      record.ebr,
      record.ae,
      record.value
    );
    const stageKey = `${record.ae || "UNMAPPED"}\u0000${record.stage || "Unknown"}`;
    const stage = stageByAe.get(stageKey) || {
      ae: record.ae || "UNMAPPED",
      stage: record.stage || "Unknown",
      licensed: 0,
      metered: 0,
      total: 0
    };
    stage[kind] += record.value;
    stage.total += record.value;
    stageByAe.set(stageKey, stage);
    if (["Business Selected", "Closed Won"].includes(record.stage)) {
      const featured = featuredByOpportunity.get(record.opportunityId) || {
        opportunityId: record.opportunityId,
        opportunityName: record.opportunityName,
        ae: record.ae || "UNMAPPED",
        stage: record.stage,
        licensed: 0,
        metered: 0,
        total: 0
      };
      featured[kind] += record.value;
      featured.total += record.value;
      featuredByOpportunity.set(record.opportunityId, featured);
    }
  };

  for (const { opportunity, ebr, creditDate } of licensedByOpportunity.values()) {
    const value = licensedAmount(opportunity);
    if (value <= 0) continue;
    addPipelineRecord("licensed", {
      ebr,
      creditDate,
      ae: opportunity.Owner?.Name,
      stage: opportunity.StageName,
      value,
      opportunityId: opportunity.Id,
      opportunityName: opportunity.Name
    });
  }
  for (const milestone of milestones) {
    const ebr = namesById[milestone.CreatedById];
    if (isAnnaJuly(ebr, milestone.CreatedDate)) continue;
    const value = number(milestone.Total_Expected_Change__c) * 3;
    if (value <= 0) continue;
    addPipelineRecord("metered", {
      ebr,
      creditDate: milestone.CreatedDate,
      ae: milestone.Opportunity__r?.Owner?.Name,
      stage: milestone.Opportunity__r?.StageName,
      value,
      opportunityId: milestone.Opportunity__c,
      opportunityName: milestone.Opportunity__r?.Name
    });
  }

  for (const group of Object.values(activity)) {
    for (const records of Object.values(group)) {
      records.sort((left, right) =>
        left.ebr.localeCompare(right.ebr) || left.ae.localeCompare(right.ae)
      );
    }
  }
  for (const group of Object.values(pipeline)) {
    for (const records of Object.values(group)) {
      records.sort((left, right) =>
        left.ebr.localeCompare(right.ebr) || left.ae.localeCompare(right.ae)
      );
    }
  }

  const stages = [
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
  fs.writeFileSync(
    path.join(ROOT, "sales_leader_activity_data.json"),
    `${JSON.stringify(activity, null, 2)}\n`
  );
  fs.writeFileSync(
    path.join(ROOT, "sales_leader_pipeline_data.json"),
    `${JSON.stringify(pipeline, null, 2)}\n`
  );
  fs.writeFileSync(
    path.join(ROOT, "sales_leader_pipeline_stage_data.json"),
    `${JSON.stringify(
      { stages, entries: [...stageByAe.values()].sort((a, b) => a.ae.localeCompare(b.ae)) },
      null,
      2
    )}\n`
  );
  fs.writeFileSync(
    path.join(ROOT, "sales_leader_featured_accounts.json"),
    `${JSON.stringify(
      { entries: [...featuredByOpportunity.values()].sort((a, b) => b.total - a.total) },
      null,
      2
    )}\n`
  );

  console.log(
    JSON.stringify({
      asOf,
      scheduled: scheduled.length,
      held: held.length,
      licensedOpportunities: licensedByOpportunity.size,
      milestones: milestones.length,
      licensedPipeline: Object.values(pipeline.licensed)
        .flat()
        .reduce((sum, record) => sum + record.value, 0),
      meteredPipeline: Object.values(pipeline.metered)
        .flat()
        .reduce((sum, record) => sum + record.value, 0)
    })
  );
}

if (require.main === module) main();

