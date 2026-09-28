const { datePart, monday, timestamp } = require("../../reporting-time");

function eventBookingEbr(event, namesById) {
  if (event.Booker__c) return namesById[event.Booker__c];
  if (event.Meeting_Set_By__c) {
    return Object.values(namesById).includes(event.Meeting_Set_By__c)
      ? event.Meeting_Set_By__c : undefined;
  }
  return namesById[event.CreatedById];
}

function deriveHeldCredits(events, logs, { namesById, quarter, asOf }) {
  const cutoff = new Date(asOf).getTime();
  if (!Number.isFinite(cutoff)) throw new Error("Invalid SQL observation as-of time");
  const observationsByEvent = new Map();
  for (const row of logs) {
    const before = row.TracRTC__Record_Start_State__c
      ? JSON.parse(row.TracRTC__Record_Start_State__c) : null;
    const after = row.TracRTC__Record_End_State__c
      ? JSON.parse(row.TracRTC__Record_End_State__c) : null;
    const status = after?.Meeting_Status__c || before?.Meeting_Status__c;
    if (!status) continue;
    const at = new Date(row.TracRTC__Log_Date__c).getTime();
    if (!Number.isFinite(at)) throw new Error(`Invalid observation timestamp: ${row.Id}`);
    if (at > cutoff) continue;
    const eventId = row.TracRTC__Object_Id__c;
    for (const state of [before, after]) {
      if (state?.Id && state.Id !== eventId) throw new Error(`Mismatched audit Event: ${row.Id}`);
    }
    const entries = observationsByEvent.get(eventId) || [];
    entries.push({ at, status, logId: row.Id });
    observationsByEvent.set(eventId, entries);
  }

  const credits = [];
  const excluded = [];
  const seen = new Set();
  for (const event of events) {
    if (seen.has(event.Id)) throw new Error(`Duplicate SQL Event: ${event.Id}`);
    seen.add(event.Id);
    const ebr = eventBookingEbr(event, namesById);
    const base = { eventId: event.Id, subject: event.Subject, ae: event.Account?.Owner?.Name || "UNMAPPED", ebr };
    const exclude = (reason, extra = {}) => excluded.push({ ...base, reason, ...extra });
    if (!ebr) { exclude("not_ebr_booked"); continue; }
    const observations = (observationsByEvent.get(event.Id) || [])
      .sort((a, b) => a.at - b.at || a.logId.localeCompare(b.logId));
    if (observations.some((o, i) => i && o.at === observations[i - 1].at && o.status !== observations[i - 1].status)) {
      exclude("conflicting_observations"); continue;
    }
    const firstHeldIndex = observations.findIndex(o => o.status === "Held");
    if (firstHeldIndex < 0) { exclude("no_held_observation"); continue; }
    const held = observations[firstHeldIndex];
    const observedHeldAt = timestamp(held.at);
    const heldDate = datePart(held.at);
    const week = monday(held.at);
    if (heldDate < quarter.start || heldDate >= quarter.end) {
      exclude("outside_quarter", { observedHeldAt }); continue;
    }
    if (ebr === "Anna Sobala" && heldDate >= "2026-07-01" && heldDate < "2026-08-01") {
      exclude("anna_july_exclusion", { observedHeldAt }); continue;
    }
    const prior = observations.slice(0, firstHeldIndex).at(-1);
    const createdAt = new Date(event.CreatedDate).getTime();
    if (!Number.isFinite(createdAt) || createdAt > held.at) {
      exclude("invalid_creation_boundary", { observedHeldAt }); continue;
    }
    let basis;
    if (prior) {
      if (monday(prior.at) !== week) {
        exclude("cross_week_interval", { priorNonHeldAt: timestamp(prior.at), observedHeldAt }); continue;
      }
      basis = "non_held_and_first_held_observed_in_same_week";
    } else if (monday(createdAt) === week) {
      basis = "created_and_first_held_observed_in_same_week";
    } else {
      exclude("missing_same_week_non_held_observation", { observedHeldAt }); continue;
    }
    credits.push({
      ...base, week, observedHeldAt, basis, heldLogId: held.logId,
      priorNonHeldAt: prior ? timestamp(prior.at) : null,
      priorLogId: prior?.logId || null, value: 1
    });
  }
  return { credits, excluded };
}

module.exports = { eventBookingEbr, deriveHeldCredits };
