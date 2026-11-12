const test = require("node:test");
const assert = require("node:assert/strict");
const evidence = require("./fixtures/fy27-q2-sql-evidence.json");
const { deriveHeldCredits, eventBookingEbr } = require("../src/held-sql");
const { datePart, monday, midnight, reportingPeriod } = require("../../reporting-time");

const namesById = {
  illane: "Illane Hamache",
  renato: "Renato Taramona",
  tommy: "Tommy Hirvonen"
};
const quarter = { start: "2026-10-01", end: "2027-01-01" };
const asOf = evidence.asOf;
const event = (id, extra = {}) => ({
  Id: id,
  Subject: "Customer meeting",
  CreatedDate: "2026-09-01T10:00:00Z",
  StartDateTime: "2026-10-15T10:00:00Z",
  Type: "Meeting",
  Meeting_Set_By__c: "Illane Hamache",
  Meeting_Status__c: "Held",
  Set_By__c: "EBR",
  WhatId: `006${id}`,
  OpportunityOwnerName: "Pierre Aigron",
  Account: { Name: "Customer", Owner: { Name: "Pierre Aigron" } },
  ...extra
});
const log = (id, at, status) => ({
  Id: `${id}-${at}-${status}`,
  TracRTC__Object_Id__c: id,
  TracRTC__Log_Date__c: at,
  TracRTC__Record_Start_State__c: JSON.stringify({ Id: id, Meeting_Status__c: status }),
  TracRTC__Record_End_State__c: JSON.stringify({ Id: id, Meeting_Status__c: status })
});
const derive = (events, logs, options = {}) =>
  deriveHeldCredits(events, logs, { namesById, quarter, asOf, ...options });

test("FY27 Q2 Salesforce evidence reconciles Illane 11 and Renato 12", () => {
  const events = evidence.records.map((row) => event(row.eventId, {
    Subject: row.subject,
    StartDateTime: row.startDateTime,
    Meeting_Set_By__c: row.ebr,
    OpportunityOwnerName: row.opportunityOwner,
    Account: { Name: row.account, Owner: { Name: row.currentAccountOwner } }
  }));
  const logs = evidence.records.map((row) => log(row.eventId, row.observedHeldAt, "Held"));
  const result = derive(events, logs);
  const totals = Object.groupBy(result.credits, row => row.ebr);
  assert.equal(totals["Illane Hamache"].length, 11);
  assert.equal(totals["Renato Taramona"].length, 12);
  assert.equal(result.excluded.length, 0);
});

test("report-compatible attribution uses Meeting Set By and Opportunity Owner", () => {
  assert.equal(eventBookingEbr(event("a", { Meeting_Set_By__c: "Tommy Hirvonen" }), namesById), "Tommy Hirvonen");
  assert.equal(eventBookingEbr(event("a", { Meeting_Set_By__c: "SDR" }), namesById), undefined);
  const result = derive([event("a", {
    Booker__c: "renato",
    Meeting_Set_By__c: "Illane Hamache",
    OpportunityOwnerName: "Morgan Nicas",
    Account: { Owner: { Name: "Pierre Aigron" } }
  })], [log("a", "2026-10-21T08:24:06Z", "Held")]);
  assert.equal(result.credits[0].ebr, "Illane Hamache");
  assert.equal(result.credits[0].ae, "Morgan Nicas");
  assert.equal(result.credits[0].currentAccountOwner, "Pierre Aigron");
});

test("earliest Held observation is retained across weeks and missing prior history", () => {
  const result = derive([
    event("cross-week"),
    event("held-only", { StartDateTime: "2026-10-16T10:00:00Z" })
  ], [
    log("cross-week", "2026-10-15T10:00:00Z", "Set"),
    log("cross-week", "2026-10-21T10:00:00Z", "Held"),
    log("held-only", "2026-10-27T10:00:00Z", "Held")
  ]);
  assert.deepEqual(result.credits.map(row => row.week), ["2026-10-19", "2026-10-26"]);
  assert.ok(result.credits.every(row => row.basis === "earliest_tracrtc_held_observation"));
});

test("missing Held history falls back explicitly to report Start", () => {
  const result = derive([event("fallback", {
    StartDateTime: "2026-10-15T08:00:00Z"
  })], []);
  assert.equal(result.credits.length, 1);
  assert.equal(result.credits[0].basis, "report_start_fallback_missing_held_observation");
  assert.equal(result.credits[0].week, "2026-10-12");
  assert.equal(result.credits[0].observedHeldAt, null);
});

test("report filters and conflicting observations block invalid credits", () => {
  const invalid = [
    event("status", { Meeting_Status__c: "Set" }),
    event("type", { Type: "Call" }),
    event("setter", { Set_By__c: "SDR" }),
    event("relation", { WhatId: "001-account" }),
    event("ebr", { Meeting_Set_By__c: "Unknown" }),
    event("date", { StartDateTime: "2026-09-30T10:00:00Z" })
  ];
  const filtered = derive(invalid, []);
  assert.deepEqual(filtered.excluded.map(row => row.reason), [
    "meeting_status_not_held",
    "activity_type_not_meeting",
    "set_by_not_ebr",
    "not_opportunity_related",
    "meeting_set_by_not_configured_ebr",
    "outside_report_quarter"
  ]);
  const conflict = derive([event("conflict")], [
    log("conflict", "2026-10-20T10:00:00Z", "Held"),
    log("conflict", "2026-10-20T10:00:00Z", "Set")
  ]);
  assert.equal(conflict.excluded[0].reason, "conflicting_observations");
});

test("repeated, reordered, duplicate and reopened observations never double-count an activity", () => {
  const rows = [
    log("a", "2026-10-20T10:00:00Z", "Set"),
    log("a", "2026-10-21T10:00:00Z", "Held"),
    log("a", "2026-10-25T10:00:00Z", "Set"),
    log("a", "2026-10-28T10:00:00Z", "Held")
  ];
  const result = derive([event("a")], [...rows, rows[1]].reverse());
  assert.equal(result.credits.length, 1);
  assert.equal(result.credits[0].heldLogId, rows[1].Id);
  assert.throws(() => derive([event("a"), event("a")], []), /Duplicate SQL Event/);
});

test("Amsterdam calendar boundary, spring and autumn DST determine reporting weeks", () => {
  assert.equal(datePart("2026-09-20T22:00:00Z"), "2026-09-21");
  assert.equal(monday("2026-09-20T21:59:59Z"), "2026-09-14");
  assert.equal(monday("2026-09-20T22:00:00Z"), "2026-09-21");
  assert.equal(midnight("2026-03-29"), "2026-03-29T00:00:00+01:00");
  assert.equal(midnight("2026-10-25"), "2026-10-25T00:00:00+02:00");
  const spring = reportingPeriod("2026-03-30T10:00:00Z");
  const autumn = reportingPeriod("2026-10-26T10:00:00Z");
  assert.equal((new Date(spring.endExclusive) - new Date(spring.startInclusive)) / 3600000, 167);
  assert.equal((new Date(autumn.endExclusive) - new Date(autumn.startInclusive)) / 3600000, 169);
  assert.deepEqual([reportingPeriod(asOf).monday, reportingPeriod(asOf).sunday], ["2026-11-02", "2026-11-08"]);
});
