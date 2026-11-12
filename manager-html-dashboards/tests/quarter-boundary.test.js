const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const { fiscalQuarter, reportingPeriod } = require("../../reporting-time");
const { deriveHeldCredits } = require("../src/held-sql");

test("October execution keeps the full cross-quarter completed Amsterdam week", () => {
  const asOf = "2026-10-05T12:01:10+02:00";
  assert.deepEqual(fiscalQuarter(asOf), { start: "2026-10-01", end: "2027-01-01" });
  assert.equal(reportingPeriod(asOf).monday, "2026-09-28");
  assert.equal(reportingPeriod(asOf).sunday, "2026-10-04");
  const stdout = execFileSync(process.execPath, ["-e", `
    const { addGrouped } = require("./refresh_sales_leader_data");
    const rows = {};
    addGrouped(rows, "2026-09-28", "EBR", "AE", 10, "2026-09-30T21:59:59Z");
    addGrouped(rows, "2026-09-28", "EBR", "AE", 20, "2026-09-30T22:00:00Z");
    console.log(JSON.stringify(rows));
  `], {
    cwd: path.resolve(__dirname, "../.."),
    env: { ...process.env, DASHBOARD_AS_OF: asOf },
    encoding: "utf8"
  });
  assert.deepEqual(JSON.parse(stdout)["2026-09-28"], [
    { ebr: "EBR", ae: "AE", value: 30, qtdValue: 20 }
  ]);
});

test("October report credits retain an observed Held week starting in September", () => {
  const event = {
    Id: "event",
    CreatedById: "ebr",
    CreatedDate: "2026-09-29T12:00:00Z",
    StartDateTime: "2026-10-01T12:00:00Z",
    Type: "Meeting",
    Meeting_Set_By__c: "Test EBR",
    Meeting_Status__c: "Held",
    Set_By__c: "EBR",
    WhatId: "006-event",
    OpportunityOwnerName: "Test AE"
  };
  const log = {
    Id: "held", TracRTC__Object_Id__c: "event",
    TracRTC__Log_Date__c: "2026-10-02T12:00:00Z",
    TracRTC__Record_End_State__c: JSON.stringify({ Id: "event", Meeting_Status__c: "Held" })
  };
  const result = deriveHeldCredits([event], [log], {
    namesById: { ebr: "Test EBR" }, quarter: { start: "2026-10-01", end: "2027-01-01" },
    asOf: "2026-10-05T12:01:10+02:00"
  });
  assert.equal(result.credits.length, 1);
  assert.equal(result.credits[0].week, "2026-09-28");
});
