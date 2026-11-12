const { datePart, monday, timestamp } = require("../../reporting-time");

function eventBookingEbr(event, namesById) {
  return Object.values(namesById).includes(event.Meeting_Set_By__c)
    ? event.Meeting_Set_By__c : undefined;
}

function sourceDate(event) {
  return event.StartDateTime || event.ActivityDate;
}

function reportEligibilityReason(event, ebr, quarter) {
  if (!ebr) return "meeting_set_by_not_configured_ebr";
  if (event.Type !== "Meeting") return "activity_type_not_meeting";
  if (event.Meeting_Status__c !== "Held") return "meeting_status_not_held";
  if (event.Set_By__c !== "EBR") return "set_by_not_ebr";
  if (!String(event.WhatId || "").startsWith("006")) return "not_opportunity_related";
  const date = sourceDate(event);
  if (!date) return "missing_report_date";
  const reportDate = datePart(date);
  if (reportDate < quarter.start || reportDate >= quarter.end) return "outside_report_quarter";
  return null;
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
    const reportDate = sourceDate(event);
    const base = {
      activityObject: event.ActivityObject || "Event",
      eventId: event.Id,
      subject: event.Subject,
      opportunityId: event.WhatId || null,
      opportunityName: event.OpportunityName || null,
      accountId: event.AccountId || null,
      accountName: event.Account?.Name || event.AccountName || null,
      ae: event.OpportunityOwnerName || event.What?.Owner?.Name || "UNMAPPED",
      currentAccountOwner: event.Account?.Owner?.Name || event.AccountOwnerName || "UNMAPPED",
      ebr,
      reportDate: reportDate ? timestamp(reportDate) : null
    };
    const exclude = (reason, extra = {}) => excluded.push({ ...base, reason, ...extra });
    const ineligible = reportEligibilityReason(event, ebr, quarter);
    if (ineligible) { exclude(ineligible); continue; }
    const observations = (observationsByEvent.get(event.Id) || [])
      .sort((a, b) => a.at - b.at || a.logId.localeCompare(b.logId));
    if (observations.some((o, i) => i && o.at === observations[i - 1].at && o.status !== observations[i - 1].status)) {
      exclude("conflicting_observations"); continue;
    }
    const firstHeldIndex = observations.findIndex(o => o.status === "Held");
    const held = firstHeldIndex >= 0 ? observations[firstHeldIndex] : null;
    const creditAt = held?.at ?? new Date(reportDate).getTime();
    if (!Number.isFinite(creditAt)) { exclude("invalid_credit_date"); continue; }
    const observedHeldAt = held ? timestamp(held.at) : null;
    const creditDate = timestamp(creditAt);
    const week = monday(creditAt);
    const prior = firstHeldIndex > 0 ? observations[firstHeldIndex - 1] : null;
    const basis = held
      ? "earliest_tracrtc_held_observation"
      : "report_start_fallback_missing_held_observation";
    credits.push({
      ...base, week, creditDate, observedHeldAt, basis, heldLogId: held?.logId || null,
      priorNonHeldAt: prior ? timestamp(prior.at) : null,
      priorLogId: prior?.logId || null, value: 1
    });
  }
  return { credits, excluded };
}

module.exports = { eventBookingEbr, deriveHeldCredits };
