const test = require("node:test");
const assert = require("node:assert/strict");
const {
  attributeClosedWon,
  buildRoleHistoryIndex,
  calculateMeteredClosedWon,
  wasEbrAt
} = require("../../refresh_closed_won_data");
const {
  parsePowerBiCsv
} = require("../../import_metered_commission_arr_snapshot");

test("uses effective-dated EBR role history", () => {
  const history = buildRoleHistoryIndex([
    {
      userId: "005-promoted",
      validFrom: "2025-01-01T00:00:00Z",
      validTo: "2026-08-01T00:00:00Z",
      role: "EBR"
    }
  ]);
  assert.equal(wasEbrAt("005-promoted", "2026-07-31T23:59:59Z", history), true);
  assert.equal(wasEbrAt("005-promoted", "2026-08-01T00:00:00Z", history), false);
});

test("includes pre-quarter opportunities and deduplicates source routes", () => {
  const opportunities = [
    {
      Id: "0061",
      Name: "Acme expansion",
      Owner: { Name: "AE One" },
      Amount: 10000,
      CreatedDate: "2025-11-01T00:00:00Z",
      CloseDate: "2026-09-10",
      CreatedById: "005-source-ebr",
      CreatedBy: {
        Name: "Source EBR",
        UserRole: { Name: "Enterprise Business Representative" }
      },
    },
    {
      Id: "0062",
      Name: "Globex order",
      Owner: { Name: "AE Two" },
      Amount: 5000,
      CreatedDate: "2026-07-10T00:00:00Z",
      CloseDate: "2026-08-04",
      Stamped_SDR_EBR__c: "Stamped EBR",
      CreatedById: "005-ae",
      CreatedBy: { Name: "AE Two", UserRole: { Name: "Account Executive" } }
    }
  ];
  const milestones = [
    {
      Opportunity__c: "0061",
      CreatedDate: "2026-05-01T00:00:00Z",
      CreatedById: "005-another-ebr",
      CreatedBy: {
        Name: "Another EBR",
        UserRole: { Name: "Enterprise Business Representative" }
      }
    }
  ];
  const quotes = [
    {
      SBQQ__Opportunity2__c: "0061",
      CreatedDate: "2026-05-02T00:00:00Z",
      CreatedById: "005-source-sdr",
      CreatedBy: {
        Name: "Source SDR",
        UserRole: { Name: "Sales Development Representative" }
      }
    }
  ];
  const history = buildRoleHistoryIndex([
    {
      userId: "005-source-ebr",
      validFrom: "2025-01-01T00:00:00Z",
      validTo: null,
      role: "EBR"
    },
    {
      userId: "005-another-ebr",
      validFrom: "2025-01-01T00:00:00Z",
      validTo: null,
      role: "EBR"
    },
    {
      userId: "005-stamped-ebr",
      validFrom: "2025-01-01T00:00:00Z",
      validTo: null,
      role: "EBR"
    }
  ]);
  const result = attributeClosedWon(
    opportunities,
    milestones,
    quotes,
    history,
    new Map([["Stamped EBR", ["005-stamped-ebr"]]])
  );
  assert.equal(result.length, 2);
  assert.equal(result.reduce((sum, item) => sum + item.amount, 0), 15000);
  assert.equal(result.find(({ id }) => id === "0061").attributionRoutes.length, 2);
});

test("excludes SDR creators and stamped names without an EBR role", () => {
  const opportunities = [
    {
      Id: "0063",
      Name: "SDR sourced opportunity",
      Owner: { Name: "AE Three" },
      Amount: 7000,
      CreatedDate: "2026-07-10T00:00:00Z",
      CloseDate: "2026-08-04",
      Stamped_SDR_EBR__c: "Source SDR",
      CreatedById: "005-source-sdr",
      CreatedBy: {
        Name: "Source SDR",
        UserRole: { Name: "Sales Development Representative" }
      }
    }
  ];

  assert.deepEqual(
    attributeClosedWon(
      opportunities,
      [],
      [],
      buildRoleHistoryIndex([]),
      new Map([["Source SDR", ["005-source-sdr"]]])
    ),
    []
  );
});

test("credits each product-aligned account uplift once", () => {
  const history = buildRoleHistoryIndex([
    {
      userId: "005-ebr",
      validFrom: "2026-01-01T00:00:00Z",
      validTo: null,
      role: "EBR"
    }
  ]);
  const milestones = [
    {
      Id: "a01",
      Name: "Acme GHEC Metered December 2026",
      CreatedDate: "2026-07-10T00:00:00Z",
      CreatedById: "005-ebr",
      CreatedBy: { Name: "Source EBR" },
      Opportunity__c: "0061",
      Opportunity__r: {
        Name: "Acme metered",
        AccountId: "001-acme",
        Account: { Name: "Acme" },
        Owner: { Name: "AE One" }
      }
    },
    {
      Id: "a02",
      Name: "Acme GHEC Metered June 2027",
      CreatedDate: "2026-08-10T00:00:00Z",
      CreatedById: "005-ebr",
      CreatedBy: { Name: "Source EBR" },
      Opportunity__c: "0062",
      Opportunity__r: {
        Name: "Acme expansion",
        AccountId: "001-acme",
        Account: { Name: "Acme" },
        Owner: { Name: "AE One" }
      }
    }
  ];
  const snapshots = [
    {
      asOfDate: "2026-08-31",
      accounts: [
        { accountId: "001-acme", accountName: "Acme", commissionArr: 100 }
      ]
    },
    {
      asOfDate: "2026-09-14",
      accounts: [
        {
          accountId: "001-acme",
          accountName: "Acme",
          commissionArr: 160,
          gheCommissionArr: 160,
          ghasCommissionArr: 0
        }
      ]
    },
    {
      asOfDate: "2026-09-21",
      accounts: [
        {
          accountId: "001-acme",
          accountName: "Acme",
          commissionArr: 140,
          gheCommissionArr: 140,
          ghasCommissionArr: 0
        }
      ]
    }
  ];

  const result = calculateMeteredClosedWon(milestones, snapshots, history);
  assert.equal(result.status, "ready");
  assert.equal(result.milestones.length, 1);
  assert.equal(result.milestones[0].amount, 40);
  assert.equal(result.milestones[0].weekOverWeekDelta, -20);
  assert.equal(result.creditedTotal, 40);
  assert.equal(result.uniqueAccountUplift, 40);
  assert.equal(result.totalsByAeOwner["AE One"], 40);
});

test("removes metered credit when the account falls back to baseline", () => {
  const history = buildRoleHistoryIndex([
    {
      userId: "005-ebr",
      validFrom: "2026-01-01T00:00:00Z",
      validTo: null,
      role: "EBR"
    }
  ]);
  const milestones = [{
    Id: "a01",
    Name: "Acme GHEC Metered December 2026",
    CreatedDate: "2026-07-10T00:00:00Z",
    CreatedById: "005-ebr",
    CreatedBy: { Name: "Source EBR" },
    Opportunity__c: "0061",
    Opportunity__r: {
      Name: "Acme metered",
      AccountId: "001-acme",
      Account: { Name: "Acme" },
      Owner: { Name: "AE One" }
    }
  }];
  const result = calculateMeteredClosedWon(
    milestones,
    [
      {
        asOfDate: "2026-08-31",
        accounts: [{ accountId: "001-acme", commissionArr: 100 }]
      },
      {
        asOfDate: "2026-09-14",
        accounts: [{
          accountId: "001-acme",
          commissionArr: 160,
          gheCommissionArr: 160,
          ghasCommissionArr: 0
        }]
      },
      {
        asOfDate: "2026-09-21",
        accounts: [{
          accountId: "001-acme",
          commissionArr: 90,
          gheCommissionArr: 90,
          ghasCommissionArr: 0
        }]
      }
    ],
    history
  );
  assert.equal(result.milestones.length, 0);
  assert.equal(result.creditedTotal, 0);
  assert.equal(result.uniqueAccountUplift, 0);
});

test("treats an account omitted from a snapshot as zero", () => {
  const history = buildRoleHistoryIndex([
    {
      userId: "005-ebr",
      validFrom: "2026-01-01T00:00:00Z",
      validTo: null,
      role: "EBR"
    }
  ]);
  const milestone = {
    Id: "a01",
    Name: "Acme GHAS Metered December 2026",
    CreatedDate: "2026-07-10T00:00:00Z",
    CreatedById: "005-ebr",
    CreatedBy: { Name: "Source EBR" },
    Opportunity__c: "0061",
    Opportunity__r: {
      Name: "Acme metered",
      AccountId: "001-acme",
      Account: { Name: "Acme" },
      Owner: { Name: "AE One" }
    }
  };
  const result = calculateMeteredClosedWon(
    [milestone],
    [
      { asOfDate: "2026-08-31", accounts: [] },
      {
        asOfDate: "2026-09-14",
        accounts: [{
          accountId: "001-acme",
          commissionArr: 75,
          gheCommissionArr: 0,
          ghasCommissionArr: 75
        }]
      }
    ],
    history
  );
  assert.equal(result.milestones.length, 1);
  assert.equal(result.milestones[0].amount, 75);
});

test("excludes mismatched products and increases not proven after creation", () => {
  const history = buildRoleHistoryIndex([{
    userId: "005-ebr",
    validFrom: "2026-01-01T00:00:00Z",
    validTo: null,
    role: "EBR"
  }]);
  const milestone = (id, name, createdDate) => ({
    Id: id,
    Name: name,
    CreatedDate: createdDate,
    CreatedById: "005-ebr",
    CreatedBy: { Name: "Source EBR" },
    Opportunity__c: "0061",
    Opportunity__r: {
      Name: "Acme",
      AccountId: "001-acme",
      Account: { Name: "Acme" },
      Owner: { Name: "AE One" }
    }
  });
  const snapshots = [
    { asOfDate: "2026-08-31", accounts: [] },
    {
      asOfDate: "2026-09-19",
      accounts: [{
        accountId: "001-acme",
        commissionArr: 100,
        gheCommissionArr: 100,
        ghasCommissionArr: 0
      }]
    }
  ];
  assert.equal(
    calculateMeteredClosedWon(
      [milestone("a01", "Acme Copilot Tokens", "2026-08-01T00:00:00Z")],
      snapshots,
      history
    ).milestones.length,
    0
  );
  assert.equal(
    calculateMeteredClosedWon(
      [milestone("a02", "Acme GHEC Metered", "2026-09-10T00:00:00Z")],
      snapshots,
      history
    ).milestones.length,
    0
  );
});

test("requires the fixed 31 August metered baseline", () => {
  const result = calculateMeteredClosedWon(
    [],
    [
      { asOfDate: "2026-08-30", accounts: [] },
      { asOfDate: "2026-09-19", accounts: [] }
    ],
    new Map()
  );
  assert.equal(result.status, "baseline_required");
  assert.equal(result.baselineAsOfDate, "2026-08-31");
  assert.equal(result.latestAsOfDate, "2026-09-19");
});

test("parses the Power BI account export", () => {
  assert.deepEqual(
    parsePowerBiCsv(
      [
        "salesforce_name,Owner,GHE-GHAS Metered Commission ARR,se_id",
        'Acme,AE One,"$12,345",001-acme'
      ].join("\n")
    ),
    [{
      accountId: "001-acme",
      accountName: "Acme",
      commissionArr: 12345
    }]
  );
});
