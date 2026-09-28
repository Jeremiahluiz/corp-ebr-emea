const test = require("node:test");
const assert = require("node:assert/strict");
const {
  aggregateLive,
  buildDirectorSnapshot,
  fiscalQuarter,
  monday
} = require("../src/dashboard");

test("FY27 Q1 date boundaries are correct", () => {
  assert.deepEqual(fiscalQuarter("2026-09-15T08:00:00Z"), {
    start: "2026-07-01",
    end: "2026-10-01"
  });
  assert.equal(monday("2026-09-15"), "2026-09-14");
});

test("Anna July scheduled exclusion does not remove an August held SQL", () => {
  const dashboard = aggregateLive(
    "Omur Sert",
    { start: "2026-07-01", end: "2026-10-01" },
    {
      instanceUrl: "https://example.my.salesforce.com",
      namesById: { anna: "Anna Sobala" },
      events: [{
        Id: "00U1",
        Subject: "Customer meeting",
        CreatedById: "anna",
        CreatedDate: "2026-07-30T10:00:00Z",
        StartDateTime: "2026-08-04T10:00:00Z",
        Meeting_Status__c: "Held",
        Account: { Name: "Acme", Owner: { Name: "Amr Al Jarhi" } }
      }],
      directOpportunities: [],
      wonDirect: [],
      milestones: [],
      quotes: [],
      opportunityById: new Map(),
      quoteOpportunityField: "SBQQ__Opportunity2__c"
    }
  );
  assert.equal(dashboard.qtd.scheduled, 0);
  assert.equal(dashboard.qtd.sql, 1);
});

test("licensed opportunity credit is deduplicated while milestones stay additive", () => {
  const opportunity = {
    Id: "0061",
    Name: "Acme upgrade",
    Type: "Upgrade",
    CreatedById: "tommy",
    CreatedDate: "2026-09-07T00:00:00Z",
    Owner: { Name: "Gustaf Eriksson" },
    StageName: "Qualified",
    License_New_ARR_10__c: 1000
  };
  const dashboard = aggregateLive(
    "Dirk-Jan de Vries",
    { start: "2026-07-01", end: "2026-10-01" },
    {
      instanceUrl: "https://example.my.salesforce.com",
      namesById: { tommy: "Tommy Hirvonen" },
      events: [],
      directOpportunities: [opportunity],
      wonDirect: [],
      milestones: [
        {
          Id: "a01", Name: "Milestone 1", CreatedById: "tommy",
          CreatedDate: "2026-09-08T00:00:00Z", Total_Expected_Change__c: 100,
          Opportunity__c: "0061", Opportunity__r: { Name: "Acme upgrade", Owner: { Name: "Gustaf Eriksson" }, StageName: "Qualified" }
        },
        {
          Id: "a02", Name: "Milestone 2", CreatedById: "tommy",
          CreatedDate: "2026-09-09T00:00:00Z", Total_Expected_Change__c: 200,
          Opportunity__c: "0061", Opportunity__r: { Name: "Acme upgrade", Owner: { Name: "Gustaf Eriksson" }, StageName: "Qualified" }
        }
      ],
      quotes: [
        { CreatedById: "tommy", CreatedDate: "2026-09-08T00:00:00Z", opportunity: "0061" }
      ],
      opportunityById: new Map([["0061", opportunity]]),
      quoteOpportunityField: "opportunity"
    }
  );
  assert.equal(dashboard.qtd.licensed, 1000);
  assert.equal(dashboard.qtd.metered, 900);
  assert.equal(dashboard.qtd.pipeline, 1900);
});

test("director snapshots aggregate managers without changing the dashboard shape", () => {
  const metricLeader = (scheduled, sql, licensed, metered) => ({
    scheduled,
    sql,
    licensed,
    metered,
    licensedClosedWon: licensed / 10,
    meteredClosedWon: metered / 10,
    closedWon: (licensed + metered) / 10,
    weekly: {
      "2026-09-14": {
        scheduled,
        sql,
        licensed,
        metered,
        pipeline: licensed + metered
      }
    },
    stagePipeline: { Qualified: licensed + metered },
    ics: [{ ebr: "Test EBR" }]
  });
  const dashboard = buildDirectorSnapshot(
    "Richard Bellet",
    {
      weeks: ["2026-09-14"],
      segments: {
        SMB: {
          leaders: {
            "AJ Herve": metricLeader(1, 2, 100, 200),
            "Omur Sert": metricLeader(3, 4, 300, 400),
            "Fernando Munoz Drinot": metricLeader(5, 6, 500, 600),
            "Michael de Korte": metricLeader(7, 8, 700, 800)
          }
        }
      }
    },
    {
      meteredSnapshotStatus: { status: "ready" },
      opportunities: [{
        id: "006-won",
        name: "Licensed win",
        owner: "Amr Al Jarhi",
        amount: 1000,
        closeDate: "2026-09-20",
        attributionEbrs: ["Anna Sobala"]
      }],
      meteredMilestones: []
    },
    { entries: [] }
  );
  assert.equal(dashboard.breakdownType, "manager");
  assert.equal(dashboard.ics.length, 4);
  assert.equal(dashboard.qtd.scheduled, 16);
  assert.equal(dashboard.qtd.sql, 20);
  assert.equal(dashboard.qtd.pipeline, 3600);
  assert.equal(dashboard.weekly["2026-09-14"].pipeline.value, 3600);
  assert.equal(dashboard.stages[0].value, 3600);
  assert.equal(dashboard.closedWonPanelTitle, "EBR-attributed revenue details");
  assert.equal(dashboard.featured["Closed Won"].length, 1);
  assert.match(
    dashboard.featured["Closed Won"][0].subtitle,
    /Licensed Closed Won/
  );
});
