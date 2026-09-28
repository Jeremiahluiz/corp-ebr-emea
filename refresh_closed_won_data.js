const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = __dirname;
const OUTPUT = path.join(ROOT, "sales_leader_closed_won_data.json");
const METERED_SNAPSHOTS = path.join(
  ROOT,
  "sales_leader_metered_commission_arr_snapshots.json"
);
const mapping = JSON.parse(
  fs.readFileSync(path.join(ROOT, "sales_leader_team_mapping.json"), "utf8")
);
const roleHistory = JSON.parse(
  fs.readFileSync(path.join(ROOT, "ebr_role_history.json"), "utf8")
);
const quarter = { start: "2026-07-01", end: "2026-10-01" };
const METERED_BASELINE_DATE = "2026-08-31";
const orgAlias = process.env.SF_ORG_ALIAS || "ebr-dashboard";
const cliPackage = "@salesforce/cli@2.150.6";

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function buildRoleHistoryIndex(intervals) {
  const index = new Map();
  for (const interval of intervals) {
    const existing = index.get(interval.userId) || [];
    existing.push(interval);
    index.set(interval.userId, existing);
  }
  return index;
}

function wasEbrAt(userId, value, roleHistoryByUserId) {
  if (!userId || !value) return false;
  const timestamp = new Date(value).getTime();
  return (roleHistoryByUserId.get(userId) || []).some((interval) => {
    const validFrom = new Date(interval.validFrom).getTime();
    const validTo = interval.validTo
      ? new Date(interval.validTo).getTime()
      : Number.POSITIVE_INFINITY;
    return timestamp >= validFrom && timestamp < validTo;
  });
}

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

function chunks(values, size = 150) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function quote(value) {
  return `'${String(value).replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

function queryLinked(objectName, opportunityField, fields, opportunityIds) {
  return chunks(opportunityIds).flatMap((ids) =>
    query(
      `SELECT ${fields} FROM ${objectName} WHERE ${opportunityField} IN (${ids
        .map(quote)
        .join(",")})`
    )
  );
}

function attributeClosedWon(
  opportunities,
  milestones,
  quotes,
  roleHistoryByUserId,
  stampedUserIdsByName = new Map()
) {
  const sourceByOpportunity = new Map();
  const addSource = (opportunityId, name, route) => {
    if (!opportunityId) return;
    const source = sourceByOpportunity.get(opportunityId) || {
      ebrs: new Set(),
      routes: new Set()
    };
    if (name) source.ebrs.add(name);
    source.routes.add(route);
    sourceByOpportunity.set(opportunityId, source);
  };

  for (const opportunity of opportunities) {
    const stampedUserIds =
      stampedUserIdsByName.get(opportunity.Stamped_SDR_EBR__c) || [];
    if (
      stampedUserIds.some((userId) =>
        wasEbrAt(userId, opportunity.CreatedDate, roleHistoryByUserId)
      )
    ) {
      addSource(
        opportunity.Id,
        opportunity.Stamped_SDR_EBR__c,
        "Opportunity.Stamped_SDR_EBR__c"
      );
    }
    if (
      wasEbrAt(
        opportunity.CreatedById,
        opportunity.CreatedDate,
        roleHistoryByUserId
      )
    ) {
      addSource(opportunity.Id, opportunity.CreatedBy?.Name, "Opportunity.CreatedById");
    }
  }
  for (const milestone of milestones) {
    if (
      wasEbrAt(
        milestone.CreatedById,
        milestone.CreatedDate,
        roleHistoryByUserId
      )
    ) {
      addSource(
        milestone.Opportunity__c,
        milestone.CreatedBy?.Name,
        "Product_Milestone__c.CreatedById"
      );
    }
  }
  for (const quoteRecord of quotes) {
    if (
      wasEbrAt(
        quoteRecord.CreatedById,
        quoteRecord.CreatedDate,
        roleHistoryByUserId
      )
    ) {
      addSource(
        quoteRecord.SBQQ__Opportunity2__c,
        quoteRecord.CreatedBy?.Name,
        "SBQQ__Quote__c.CreatedById"
      );
    }
  }

  return opportunities
    .filter((opportunity) => sourceByOpportunity.has(opportunity.Id))
    .map((opportunity) => {
      const source = sourceByOpportunity.get(opportunity.Id);
      return {
        id: opportunity.Id,
        name: opportunity.Name,
        owner: opportunity.Owner?.Name,
        amount: Number(opportunity.Amount || 0),
        opportunityCreatedDate: datePart(opportunity.CreatedDate),
        closeDate: opportunity.CloseDate,
        attributionEbrs: [...source.ebrs].sort(),
        attributionRoutes: [...source.routes].sort()
      };
    })
    .sort((left, right) =>
      left.closeDate.localeCompare(right.closeDate) ||
      left.name.localeCompare(right.name)
    );
}

function snapshotAccountMap(snapshot) {
  return new Map(
    (snapshot?.accounts || [])
      .map((account) => [
        account.accountId || account.se_id,
        {
          accountId: account.accountId || account.se_id,
          accountName: account.accountName || account.salesforce_name,
          commissionArr: Number(
            account.commissionArr ??
              account["GHE-GHAS Metered Commission ARR"] ??
              0
          ),
          gheCommissionArr:
            account.gheCommissionArr == null
              ? null
              : Number(account.gheCommissionArr),
          ghasCommissionArr:
            account.ghasCommissionArr == null
              ? null
              : Number(account.ghasCommissionArr)
        }
      ])
      .filter(([accountId]) => accountId)
  );
}

function milestoneProduct(name) {
  const value = String(name || "").toLowerCase();
  if (value.includes("copilot")) return null;
  if (
    value.includes("ghas") ||
    value.includes("code quality") ||
    value.includes("code security") ||
    value.includes("secret protection")
  ) {
    return "GHAS";
  }
  if (value.includes("ghec") || value.includes("github enterprise")) {
    return "GHE";
  }
  return null;
}

function latestSingleProduct(account) {
  const products = [
    ["GHE", account.gheCommissionArr],
    ["GHAS", account.ghasCommissionArr]
  ].filter(([, value]) => Number(value) > 0);
  return products.length === 1 ? products[0][0] : null;
}

function calculateMeteredClosedWon(
  milestones,
  snapshots,
  roleHistoryByUserId
) {
  const orderedSnapshots = [...snapshots]
    .filter(({ asOfDate }) => String(asOfDate) >= METERED_BASELINE_DATE)
    .sort((left, right) =>
      String(left.asOfDate).localeCompare(String(right.asOfDate))
    );
  const baselineSnapshot = orderedSnapshots.find(
    ({ asOfDate }) => asOfDate === METERED_BASELINE_DATE
  );
  const laterSnapshots = orderedSnapshots.filter(
    ({ asOfDate }) => asOfDate > METERED_BASELINE_DATE
  );
  const empty = {
    status: "baseline_required",
    baselineAsOfDate: baselineSnapshot?.asOfDate || METERED_BASELINE_DATE,
    previousAsOfDate: null,
    latestAsOfDate: laterSnapshots.at(-1)?.asOfDate || null,
    milestones: [],
    uniqueAccounts: [],
    totalsByAeOwner: {},
    creditedTotal: 0,
    uniqueAccountUplift: 0
  };
  if (!baselineSnapshot || laterSnapshots.length === 0) return empty;

  const calculationSnapshots = [baselineSnapshot, ...laterSnapshots];
  const accountMaps = calculationSnapshots.map(snapshotAccountMap);
  const baselineAccounts = accountMaps[0];
  const previousAccounts = accountMaps.at(-2);
  const latestAccounts = accountMaps.at(-1);
  const accountUplifts = new Map();
  const candidateAccountNames = new Map(
    milestones
      .map((milestone) => [
        milestone.Opportunity__r?.AccountId,
        milestone.Opportunity__r?.Account?.Name
      ])
      .filter(([accountId]) => accountId)
  );

  for (const [accountId, candidateAccountName] of candidateAccountNames) {
    const baseline = baselineAccounts.get(accountId) || {
      accountId,
      accountName: candidateAccountName,
      commissionArr: 0
    };
    const previous = previousAccounts.get(accountId) || {
      accountId,
      accountName: candidateAccountName,
      commissionArr: 0
    };
    const latest = latestAccounts.get(accountId) || {
      accountId,
      accountName: candidateAccountName,
      commissionArr: 0
    };
    const restatedUplift = Math.max(
      0,
      latest.commissionArr - baseline.commissionArr
    );
    const product = latestSingleProduct(latest);
    if (!product || restatedUplift <= 0) continue;
    accountUplifts.set(accountId, {
      accountId,
      product,
      accountName:
        latest.accountName || previous.accountName || baseline.accountName,
      baselineCommissionArr: baseline.commissionArr,
      previousCommissionArr: previous.commissionArr,
      latestCommissionArr: latest.commissionArr,
      weekOverWeekDelta: latest.commissionArr - previous.commissionArr,
      restatedUplift
    });
  }

  const creditedMilestones = [];
  const eligibleMilestones = milestones
    .filter((milestone) =>
      wasEbrAt(
        milestone.CreatedById,
        milestone.CreatedDate,
        roleHistoryByUserId
      )
    )
    .sort(
      (left, right) =>
        String(left.CreatedDate).localeCompare(String(right.CreatedDate)) ||
        String(left.Id).localeCompare(String(right.Id))
    );
  const creditedAccountProducts = new Set();
  for (const milestone of eligibleMilestones) {
    if (
      milestone.UBB_Status__c === "Stale"
    ) {
      continue;
    }
    const accountId = milestone.Opportunity__r?.AccountId;
    const uplift = accountUplifts.get(accountId);
    if (!uplift) continue;
    const product = milestoneProduct(milestone.Name);
    if (product !== uplift.product) continue;
    const milestoneDate = datePart(milestone.CreatedDate);
    const observedAfterCreation = calculationSnapshots.some(
      (snapshot, index) =>
        index > 0 &&
        calculationSnapshots[index - 1].asOfDate >= milestoneDate &&
        (accountMaps[index].get(accountId)?.commissionArr || 0) >
          (accountMaps[index - 1].get(accountId)?.commissionArr || 0)
    );
    if (!observedAfterCreation) continue;
    const accountProductKey = `${accountId}:${product}`;
    if (creditedAccountProducts.has(accountProductKey)) continue;
    creditedAccountProducts.add(accountProductKey);
    creditedMilestones.push({
      id: milestone.Id,
      name: milestone.Name,
      createdDate: datePart(milestone.CreatedDate),
      status: milestone.UBB_Status__c || null,
      ebr: milestone.CreatedBy?.Name,
      owner: milestone.Opportunity__r?.Owner?.Name,
      opportunityId: milestone.Opportunity__c,
      opportunityName: milestone.Opportunity__r?.Name,
      accountId,
      accountName:
        milestone.Opportunity__r?.Account?.Name || uplift.accountName,
      product,
      amount: uplift.restatedUplift,
      ...uplift
    });
  }
  creditedMilestones.sort(
    (left, right) =>
      left.accountName.localeCompare(right.accountName) ||
      left.createdDate.localeCompare(right.createdDate) ||
      left.name.localeCompare(right.name)
  );

  const uniqueAccounts = creditedMilestones
    .map(({ accountId }) => accountUplifts.get(accountId))
    .sort((left, right) => left.accountName.localeCompare(right.accountName));
  const totalsByAeOwner = {};
  for (const milestone of creditedMilestones) {
    totalsByAeOwner[milestone.owner] = roundMoney(
      (totalsByAeOwner[milestone.owner] || 0) + milestone.amount
    );
  }

  return {
    status: "ready",
    baselineAsOfDate: baselineSnapshot.asOfDate,
    previousAsOfDate: calculationSnapshots.at(-2).asOfDate,
    latestAsOfDate: calculationSnapshots.at(-1).asOfDate,
    milestones: creditedMilestones,
    uniqueAccounts,
    totalsByAeOwner,
    creditedTotal: roundMoney(
      creditedMilestones.reduce((sum, milestone) => sum + milestone.amount, 0)
    ),
    uniqueAccountUplift: roundMoney(
      uniqueAccounts.reduce((sum, account) => sum + account.restatedUplift, 0)
    )
  };
}

function main() {
  const aeNames = [
    ...new Set(
      Object.values(mapping)
        .flatMap((managers) => Object.values(managers))
        .flat()
        .map(({ ae }) => ae)
    )
  ];
  const opportunities = query(
    `SELECT Id, Name, Owner.Name, Amount, CreatedDate, CloseDate, CreatedById, CreatedBy.Name, Stamped_SDR_EBR__c FROM Opportunity WHERE IsWon = true AND CloseDate >= ${quarter.start} AND CloseDate < ${quarter.end} AND Owner.Name IN (${aeNames
      .map(quote)
      .join(",")})`
  );
  const stampedNames = [
    ...new Set(
      opportunities
        .map(({ Stamped_SDR_EBR__c: name }) => name)
        .filter(Boolean)
    )
  ];
  const stampedUserIdsByName = new Map();
  for (const user of chunks(stampedNames).flatMap((names) =>
    query(`SELECT Id, Name FROM User WHERE Name IN (${names.map(quote).join(",")})`)
  )) {
    const ids = stampedUserIdsByName.get(user.Name) || [];
    ids.push(user.Id);
    stampedUserIdsByName.set(user.Name, ids);
  }
  const opportunityIds = opportunities.map(({ Id }) => Id);
  const milestones = queryLinked(
    "Product_Milestone__c",
    "Opportunity__c",
    "Id, Opportunity__c, CreatedDate, CreatedById, CreatedBy.Name",
    opportunityIds
  );
  const quotes = queryLinked(
    "SBQQ__Quote__c",
    "SBQQ__Opportunity2__c",
    "Id, SBQQ__Opportunity2__c, CreatedDate, CreatedById, CreatedBy.Name",
    opportunityIds
  );
  const roleHistoryByUserId = buildRoleHistoryIndex(roleHistory.intervals);
  const attributed = attributeClosedWon(
    opportunities,
    milestones,
    quotes,
    roleHistoryByUserId,
    stampedUserIdsByName
  );
  const quarterMilestones = query(
    `SELECT Id, Name, CreatedDate, CreatedById, CreatedBy.Name, UBB_Status__c, Opportunity__c, Opportunity__r.Name, Opportunity__r.AccountId, Opportunity__r.Account.Name, Opportunity__r.Owner.Name FROM Product_Milestone__c WHERE CreatedDate >= ${quarter.start}T00:00:00Z AND CreatedDate < ${quarter.end}T00:00:00Z AND Opportunity__r.AccountId != null AND Opportunity__r.Owner.Name IN (${aeNames
      .map(quote)
      .join(",")})`
  );
  const meteredSnapshotData = fs.existsSync(METERED_SNAPSHOTS)
    ? JSON.parse(fs.readFileSync(METERED_SNAPSHOTS, "utf8"))
    : { snapshots: [] };
  const metered = calculateMeteredClosedWon(
    quarterMilestones,
    meteredSnapshotData.snapshots || [],
    roleHistoryByUserId
  );
  const meteredCandidateMilestones = quarterMilestones
    .filter((milestone) =>
      wasEbrAt(
        milestone.CreatedById,
        milestone.CreatedDate,
        roleHistoryByUserId
      )
    )
    .map((milestone) => ({
      id: milestone.Id,
      name: milestone.Name,
      createdDate: datePart(milestone.CreatedDate),
      status: milestone.UBB_Status__c || null,
      ebr: milestone.CreatedBy?.Name,
      owner: milestone.Opportunity__r?.Owner?.Name,
      opportunityId: milestone.Opportunity__c,
      opportunityName: milestone.Opportunity__r?.Name,
      accountId: milestone.Opportunity__r?.AccountId,
      accountName: milestone.Opportunity__r?.Account?.Name
    }));
  const totalsByAeOwner = {};
  for (const opportunity of attributed) {
    totalsByAeOwner[opportunity.owner] =
      (totalsByAeOwner[opportunity.owner] || 0) + opportunity.amount;
  }
  const routeCounts = {};
  for (const opportunity of attributed) {
    for (const route of opportunity.attributionRoutes) {
      routeCounts[route] = (routeCounts[route] || 0) + 1;
    }
  }
  const output = {
    definition: {
      closeDate: `${quarter.start} through 2026-09-30`,
      managerAttribution: "Opportunity owner AE mapped to the manager",
      ebrAttribution:
        "Users whose effective-dated historical role was EBR or SEBR when the opportunity, milestone, or quote was created",
      creationDateRestriction: "None",
      licensedMeasure: "Unique Opportunity.Amount",
      licensedDeduplication: "Opportunity.Id",
      meteredMeasure:
        `Restated account Commission ARR uplift between the fixed ${METERED_BASELINE_DATE} baseline and latest saved weekly Power BI snapshot`,
      meteredQualification:
        "A GHE or GHAS account uplift was observed after a matching Q1 milestone was created by an effective-dated EBR or SEBR. Copilot, ambiguous mixed-product, stale, and unverified-timing milestones are excluded.",
      meteredDeduplication:
        "Each account and product uplift is credited once. When multiple milestones match, the earliest eligible milestone is retained."
    },
    licensedOpportunities: attributed,
    opportunities: attributed,
    meteredCandidateMilestones,
    meteredMilestones: metered.milestones,
    meteredUniqueAccounts: metered.uniqueAccounts,
    meteredSnapshotStatus: {
      status: metered.status,
      baselineAsOfDate: metered.baselineAsOfDate,
      previousAsOfDate: metered.previousAsOfDate,
      latestAsOfDate: metered.latestAsOfDate
    },
    totalsByAeOwner,
    meteredTotalsByAeOwner: metered.totalsByAeOwner,
    licensedTotal: attributed.reduce(
      (sum, opportunity) => sum + opportunity.amount,
      0
    ),
    meteredCreditedTotal: metered.creditedTotal,
    meteredUniqueAccountUplift: metered.uniqueAccountUplift,
    teamTotal: roundMoney(
      attributed.reduce((sum, opportunity) => sum + opportunity.amount, 0) +
        metered.creditedTotal
    ),
    opportunitiesCreatedBeforeQuarter: attributed.filter(
      (opportunity) => opportunity.opportunityCreatedDate < quarter.start
    ).length,
    recordsWithNullAmount: attributed
      .filter((opportunity) => opportunity.amount === 0)
      .map(({ id, name }) => ({ id, name })),
    routeCounts,
    caveats: [
      `Salesforce queried on ${new Date().toISOString().slice(0, 10)} for Q1 FY27 Closed Won opportunities owned by AEs in the six manager mappings.`,
      "Opportunity creation date, milestone creation date, and quote creation date are not restricted to the quarter.",
      "Quotes and milestones qualify through their linked opportunity being IsWon=true with a Q1 FY27 CloseDate.",
      "Historical EBR/SEBR role periods come from service_sales_analytics.sfdc_user_role_history.",
      "Stamped_SDR_EBR__c is evaluated against the stamped user's role on the opportunity creation date because Salesforce field history is unavailable.",
      "Sales Development Representative and Enterprise Inside Sales Representative roles are excluded.",
      "An opportunity qualifying through more than one source route is counted once.",
      `Metered credit requires the immutable ${METERED_BASELINE_DATE} Power BI account baseline and at least one later snapshot.`,
      "Accounts omitted from the Power BI Commission ARR summary are treated as zero because the visual only exports accounts with a displayed Commission ARR value.",
      "Metered credit is restated against the latest snapshot and can shrink or disappear when account Commission ARR falls.",
      "Each account/product uplift is counted once; ambiguous mixed-product accounts are excluded until a product-specific baseline is available."
    ]
  };
  fs.writeFileSync(OUTPUT, `${JSON.stringify(output, null, 2)}\n`);
  console.log(
    JSON.stringify({
      queriedWonOpportunities: opportunities.length,
      attributedWonOpportunities: attributed.length,
      opportunitiesCreatedBeforeQuarter: output.opportunitiesCreatedBeforeQuarter,
      meteredSnapshotStatus: output.meteredSnapshotStatus,
      meteredCandidateMilestones: output.meteredCandidateMilestones.length,
      meteredCreditedMilestones: output.meteredMilestones.length,
      meteredCreditedTotal: output.meteredCreditedTotal,
      meteredUniqueAccountUplift: output.meteredUniqueAccountUplift,
      teamTotal: output.teamTotal,
      routeCounts
    })
  );
}

function datePart(value) {
  return String(value || "").slice(0, 10);
}

if (require.main === module) main();

module.exports = {
  attributeClosedWon,
  buildRoleHistoryIndex,
  calculateMeteredClosedWon,
  milestoneProduct,
  wasEbrAt
};
