const test = require("node:test");
const assert = require("node:assert/strict");
const { deriveHeldCredits, eventBookingEbr } = require("../src/held-sql");
const { aggregateLive } = require("../src/dashboard");
const { datePart, monday, midnight, reportingPeriod } = require("../../reporting-time");

const namesById = { daniel: "Daniel Spanjaard", renato: "Renato Taramona", tommy: "Tommy Hirvonen" };
const quarter = { start: "2026-07-01", end: "2026-10-01" };
const asOf = "2026-09-28T15:00:00+02:00";
const event = (id, extra = {}) => ({
  Id: id, CreatedDate: "2026-08-26T10:00:00+02:00",
  CreatedById: "hubot", Booker__c: "daniel", Meeting_Status__c: "Held",
  Account: { Owner: { Name: "Emilio van der Zanden" } }, ...extra
});
const log = (id, at, status) => ({
  Id: `${id}-${at}-${status}`, TracRTC__Object_Id__c: id,
  TracRTC__Log_Date__c: at,
  TracRTC__Record_Start_State__c: JSON.stringify({ Id: id, Meeting_Status__c: status }),
  TracRTC__Record_End_State__c: JSON.stringify({ Id: id, Meeting_Status__c: status })
});
const derive = (events, logs, options = {}) =>
  deriveHeldCredits(events, logs, { namesById, quarter, asOf, ...options });

test("Sep21-27: DJ counts exactly INEOS and Compass; Carmen counts only Amrize", () => {
  const ineos = "00UhR000009KEuTUAW";
  const compass = "00UhR000009RveXUAS";
  const placeholder = "00UhR000007lf8YUAQ";
  const amrize = "00UhR00000AstzRUAR";
  const cepsa = "00UhR00000B44xxUAB";
  const syngenta = "00UhR00000BJENVUA5";
  const wavestone = "00UhR000009K3FtUAK";
  const carl = "00U-carl";
  const carmen = { Booker__c: "renato", Account: { Owner: { Name: "Luca Schwarz" } } };
  const events = [
    event(ineos, { StartDateTime: "2026-09-28T10:00:00Z" }),
    event(compass),
    event(placeholder),
    event(amrize, { ...carmen, CreatedDate: "2026-09-24T09:36:38+02:00" }),
    event(cepsa, { ...carmen, Account: { Owner: { Name: "Sindy Abreu" } } }),
    event(syngenta, { ...carmen, CreatedDate: "2026-09-28T14:27:53+02:00" }),
    event(wavestone, { Booker__c: "sdr", CreatedById: "renato",
      Meeting_Set_By__c: "Renato Taramona", Account: { Owner: { Name: "Pierre Aigron" } } }),
    event(carl, { Booker__c: "tommy", Account: { Owner: { Name: "Carl Harris" } } })
  ];
  const logs = [
    log(ineos, "2026-09-22T09:53:27+02:00", "Set"),
    log(ineos, "2026-09-24T14:29:06+02:00", "Held"),
    log(compass, "2026-09-22T09:53:41+02:00", "Set"),
    log(compass, "2026-09-24T14:29:38+02:00", "Held"),
    log(placeholder, "2026-09-17T13:59:50+02:00", "Set"),
    log(placeholder, "2026-09-24T14:29:47+02:00", "Held"),
    log(placeholder, "2026-09-24T16:21:42+02:00", "Held"),
    log(amrize, "2026-09-24T10:09:59+02:00", "Held"),
    log(cepsa, "2026-09-25T13:05:59+02:00", "Set"),
    log(cepsa, "2026-09-28T14:48:51+02:00", "Set"),
    log(cepsa, "2026-09-28T14:49:56+02:00", "Held"),
    log(syngenta, "2026-09-28T14:30:16+02:00", "Held"),
    log(wavestone, "2026-09-25T13:46:30+02:00", "Set"),
    log(wavestone, "2026-09-25T13:47:48+02:00", "Held"),
    log(carl, "2026-09-22T13:00:00+02:00", "Set"),
    log(carl, "2026-09-24T13:00:00+02:00", "Held")
  ];
  const result = derive(events, logs);
  assert.deepEqual(result.credits.filter(r => r.week === "2026-09-21").map(r => r.eventId),
    [ineos, compass, amrize, carl]);
  assert.equal(result.excluded.find(r => r.eventId === placeholder).reason, "cross_week_interval");
  assert.equal(result.excluded.find(r => r.eventId === wavestone).reason, "not_ebr_booked");
  assert.deepEqual(result.credits.filter(r => r.week === "2026-09-28").map(r => r.eventId), [cepsa, syngenta]);
  const source = { namesById, asOf, events, sqlObservationLogs: logs, directOpportunities: [],
    quotes: [], milestones: [], wonDirect: [], opportunityById: new Map() };
  for (const [owner, expected] of [["Dirk-Jan de Vries", 2], ["Carmen Marced", 1], ["Omur Sert", 1]]) {
    const dashboard = aggregateLive(owner, quarter, source);
    assert.equal(dashboard.weekly["2026-09-21"].sql.value, expected);
  }
});

test("Booker precedence and fallback never reattribute a known SDR Booker to an EBR creator", () => {
  assert.equal(eventBookingEbr(event("a", { Booker__c: "sdr", CreatedById: "daniel" }), namesById), undefined);
  assert.equal(eventBookingEbr(event("a", { Booker__c: null, Meeting_Set_By__c: "Tommy Hirvonen" }), namesById), "Tommy Hirvonen");
  assert.equal(eventBookingEbr(event("a", { Booker__c: null, Meeting_Set_By__c: "SDR", CreatedById: "daniel" }), namesById), undefined);
  assert.equal(eventBookingEbr(event("a", { Booker__c: null, CreatedById: "daniel" }), namesById), "Daniel Spanjaard");
});

test("repeated, reordered, duplicate and reopened observations never double-count an Event", () => {
  const rows = [log("a", "2026-09-22T10:00:00Z", "Set"), log("a", "2026-09-23T10:00:00Z", "Held"),
    log("a", "2026-09-25T10:00:00Z", "Set"), log("a", "2026-09-28T10:00:00Z", "Held")];
  const result = derive([event("a")], [...rows, rows[1]].reverse());
  assert.equal(result.credits.length, 1);
  assert.equal(result.credits[0].heldLogId, rows[1].Id);
});

test("old first-Held observations, missing history, conflicts, and future observations cannot manufacture credit", () => {
  assert.equal(derive([event("a")], [log("a", "2026-09-24T10:00:00Z", "Held")]).excluded[0].reason,
    "missing_same_week_non_held_observation");
  assert.equal(derive([event("a")], []).excluded[0].reason, "no_held_observation");
  assert.equal(derive([event("a")], [
    log("a", "2026-09-24T10:00:00Z", "Held"), log("a", "2026-09-24T10:00:00Z", "Set")
  ]).excluded[0].reason, "conflicting_observations");
  assert.equal(derive([event("a")], [log("a", "2026-09-29T10:00:00Z", "Held")]).credits.length, 0);
  assert.equal(derive([event("a")], [
    log("a", "2026-06-24T10:00:00Z", "Held"), log("a", "2026-09-22T10:00:00Z", "Set"),
    log("a", "2026-09-24T10:00:00Z", "Held")
  ]).excluded[0].reason, "outside_quarter");
  assert.throws(() => derive([event("a"), event("a")], []), /Duplicate SQL Event/);
  assert.throws(() => derive([event("a")], [{ ...log("a", asOf, "Held"), TracRTC__Record_End_State__c: "{" }]), SyntaxError);
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
  assert.deepEqual([reportingPeriod(asOf).monday, reportingPeriod(asOf).sunday], ["2026-09-21", "2026-09-27"]);
  const sameSundayUtc = [
    log("a", "2026-09-20T21:59:59Z", "Set"), log("a", "2026-09-20T22:00:00Z", "Held")
  ];
  assert.equal(derive([event("a")], sameSundayUtc).excluded[0].reason, "cross_week_interval");
});
