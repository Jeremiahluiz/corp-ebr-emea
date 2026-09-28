const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { EBR_USERS } = require("./manager-html-dashboards/src/config");
const { deriveHeldCredits } = require("./manager-html-dashboards/src/held-sql");
const { datePart, monday, midnight, timestamp } = require("./reporting-time");

const ROOT = __dirname;
const cliPackage = "@salesforce/cli@2.150.6";
const orgAlias = process.env.SF_ORG_ALIAS || "ebr-dashboard";
const quarter = { start: "2026-07-01", end: "2026-10-01" };
const asOf = process.env.DASHBOARD_AS_OF || new Date().toISOString();
const namesById = Object.fromEntries(
  Object.entries(EBR_USERS).map(([name, id]) => [id, name])
);
const userIds = Object.values(EBR_USERS);
const quarterStart = new Date(midnight(quarter.start)).toISOString();
const auditDirectory = process.env.DASHBOARD_AUDIT_DIR || path.join(ROOT, ".dashboard-audit");
const queryAudit = [];

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
  if (!Array.isArray(payload.result.records) || payload.result.totalSize !== payload.result.records.length ||
      payload.result.done === false) throw new Error("Incomplete Salesforce query result");
  queryAudit.push({ soql, totalSize: payload.result.totalSize, records: payload.result.records });
  return payload.result.records;
}

function quote(value) {
  return `'${String(value).replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
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
      `WHERE CreatedById IN (${ids}) AND CreatedDate >= ${quarterStart} ` +
      `AND CreatedDate <= ${asOf}`
  );
  const sqlEvents = query(
    `SELECT Id, Subject, CreatedDate, CreatedById, Booker__c, Meeting_Set_By__c, ` +
      `Meeting_Status__c, Account.Owner.Name FROM Event ` +
      `WHERE (` +
      `Booker__c IN (${ids}) OR Meeting_Set_By__c IN (${Object.keys(EBR_USERS).map(quote).join(",")}) ` +
      `OR (Booker__c = NULL AND Meeting_Set_By__c = NULL AND CreatedById IN (${ids}))) ` +
      `AND LastModifiedDate >= ${quarterStart} AND CreatedDate <= ${asOf}`
  );
  const history = [];
  for (let index = 0; index < sqlEvents.length; index += 100) {
    const eventIds = sqlEvents.slice(index, index + 100).map(event => quote(event.Id)).join(",");
    history.push(...query(
      `SELECT Id, TracRTC__Object_Id__c, TracRTC__Log_Date__c, ` +
      `TracRTC__Record_Start_State__c, TracRTC__Record_End_State__c ` +
      `FROM TracRTC__History_Log__c WHERE TracRTC__Object_Id__c IN (${eventIds}) ` +
      `AND TracRTC__Log_Date__c <= ${asOf} ORDER BY TracRTC__Log_Date__c, Id`
    ));
  }
  const sqlObservations = deriveHeldCredits(sqlEvents, history, { namesById, quarter, asOf });

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
  for (const credit of sqlObservations.credits) {
    addGrouped(
      activity.sql,
      credit.week,
      credit.ebr,
      credit.ae,
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
      `AND CreatedDate >= ${quarterStart} AND CreatedDate <= ${asOf} ` +
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
      `AND CreatedDate >= ${quarterStart} AND CreatedDate <= ${asOf}`
  );
  const milestones = query(
    `SELECT Id, CreatedById, CreatedDate, Opportunity__c, Total_Expected_Change__c, ` +
      `Opportunity__r.Name, Opportunity__r.Owner.Name, Opportunity__r.StageName ` +
      `FROM Product_Milestone__c WHERE CreatedById IN (${ids}) ` +
      `AND CreatedDate >= ${quarterStart} AND CreatedDate <= ${asOf}`
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
  fs.mkdirSync(auditDirectory, { recursive: true });
  fs.writeFileSync(path.join(auditDirectory, "salesforce-query-audit.json"),
    `${JSON.stringify({ asOf: timestamp(asOf), queries: queryAudit }, null, 2)}\n`);
  fs.writeFileSync(path.join(auditDirectory, "held-sql-observation-audit.json"),
    `${JSON.stringify({ asOf: timestamp(asOf), ...sqlObservations }, null, 2)}\n`);
  const coverageByAe = {};
  for (const record of sqlObservations.excluded) {
    if (!["cross_week_interval", "missing_same_week_non_held_observation", "no_held_observation", "conflicting_observations", "invalid_creation_boundary"].includes(record.reason)) continue;
    const coverage = coverageByAe[record.ae] ||= {};
    coverage[record.reason] = (coverage[record.reason] || 0) + 1;
  }
  fs.writeFileSync(path.join(ROOT, "sales_leader_sql_observation_status.json"),
    `${JSON.stringify({ asOf: timestamp(asOf), quarter, coverageByAe,
      basis: "Conservative TracRTC status observations, not exact field-change timestamps. Earliest observed Held is counted once per Event only when a prior non-Held observation is in the same Amsterdam week, or the Event was created in that week. Cross-week and unsupported observations are excluded. EBR Booker, then Meeting Set By, then creator only when both are absent; current account-owner AE determines manager."
    }, null, 2)}\n`);
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
      held: sqlObservations.credits.length,
      sqlCandidates: sqlEvents.length,
      historyRows: history.length,
      sqlExcluded: sqlObservations.excluded.length,
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
