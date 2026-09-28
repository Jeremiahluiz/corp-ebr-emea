# Manager HTML dashboards

This dashboard pack keeps the existing PNG/SVG reports unchanged and generates eight standalone HTML files (six managers and two directors).

## Generate

```bash
cd manager-html-dashboards
npm run generate
```

The files are written to `manager-html-dashboards/output/`. They contain their own CSS, JavaScript, and dashboard data, so they can be shared as files without running a local server.

The only Salesforce link is **Open SQL held report**:

<https://github.lightning.force.com/lightning/r/Report/00OhR000004gPpJUAU/view>

Viewers authenticate through their own Salesforce account. KPI values, chart bars, funnel stages, IC metrics, and opportunity names are not clickable.

## Metric rules

- Scheduled events use `Event.CreatedDate` and EBR `CreatedById`.
- SQL uses conservative `TracRTC__History_Log__c` status observations, **not** `Event.StartDateTime`, Event creation date alone, or `LastModifiedDate` as a Held date. These are processing-time observations, not exact field-change timestamps.
- Each Event is credited once at its earliest observed Held. The latest preceding non-Held observation must be in the same Europe/Amsterdam Monday-Sunday week. If no preceding observation exists, creation and first observed Held must be in the same week. Cross-week intervals, missing evidence and conflicting simultaneous observations are excluded and audited. Repeated Held observations and reopened Events do not earn additional credit. Weekly and QTD SQL use the same eligible credits.
- SQL attribution uses configured EBR `Booker__c`, then exact EBR `Meeting_Set_By__c` when Booker is absent, then EBR `CreatedById` only when both booking fields are absent. A non-EBR Booker never falls through to an EBR creator. The Event account's current owner AE determines manager scope.
- Licensed pipeline is deduplicated by opportunity and credited through an EBR-created opportunity or quote.
- Metered pipeline is additive and uses `Total_Expected_Change__c * 3`.
- Licensed closed-won revenue uses unique Q1 won opportunities attributed through an EBR-created opportunity, quote, or linked milestone.
- Metered closed-won revenue requires a product-aligned GHE or GHAS Commission ARR increase observed after milestone creation. Each account/product uplift is counted once; Copilot, stale, mixed-product, and unverified-timing milestones are excluded.
- Anna Sobala's July 2026 activity and pipeline attribution are excluded.

The HTML values are a saved snapshot. The linked SQL report is the route to current Salesforce data.

## Refresh and validation

From the repository root, run:

```bash
node refresh_sales_leader_data.js
node build_sales_leader_dashboard_data.js
npm --prefix manager-html-dashboards run check
npm --prefix manager-html-dashboards test
npm --prefix manager-html-dashboards run generate
```

The refresh fetches all available observation history for EBR-booked Events modified since quarter start, including observations before the quarter. `LastModifiedDate` only narrows candidate retrieval; it never assigns a credit date. Query completeness is mandatory. `DASHBOARD_AS_OF` can pin one execution timestamp; page generation otherwise reuses the successful refresh timestamp. All bucketing and the previous completed reporting week use Europe/Amsterdam.

Raw queries, credited Event IDs, evidence log IDs, and excluded candidates are written to `DASHBOARD_AUDIT_DIR` (default `.dashboard-audit/`, ignored by Git). Preserve this directory in the workflow run manifest; do not publish it. `sales_leader_sql_observation_status.json` retains internal coverage and methodology. Page generation uses its refresh timestamp but does not embed or render the SQL methodology and coverage notices.

Activity refresh does not recalculate revenue. Preserve the saved licensed Closed Won, metered Commission ARR, immutable 2026-08-31 baseline, and effective-dated role history when fresh enrichment cannot be certified. Pages show each saved source's actual as-of date. Before publication compare revenue values against the previous live pages, reconcile all AEs/managers/directors and unmapped records, and validate the generated HTML. After publication require a successful Pages deployment and HTTP/payload verification of all eight URLs.

## Hosted pages

These pages are hosted publicly in `Jeremiahluiz/corp-ebr-emea-manager-dashboards`:

- Richard Bellet, consolidated SMB: <https://jeremiahluiz.github.io/corp-ebr-emea-manager-dashboards/richard-bellet.html>
- Gilles Chalon, consolidated Mid Market: <https://jeremiahluiz.github.io/corp-ebr-emea-manager-dashboards/gilles-chalon.html>
- Fernando Munoz Drinot: <https://jeremiahluiz.github.io/corp-ebr-emea-manager-dashboards/fernando-munoz-drinot.html>
- Michael de Korte: <https://jeremiahluiz.github.io/corp-ebr-emea-manager-dashboards/michael-de-korte.html>
- AJ Herve: <https://jeremiahluiz.github.io/corp-ebr-emea-manager-dashboards/aj-herve.html>
- Omur Sert: <https://jeremiahluiz.github.io/corp-ebr-emea-manager-dashboards/omur-sert.html>
- Dirk-Jan de Vries: <https://jeremiahluiz.github.io/corp-ebr-emea-manager-dashboards/dirk-jan-de-vries.html>
- Carmen Marced: <https://jeremiahluiz.github.io/corp-ebr-emea-manager-dashboards/carmen-marced.html>

These URLs are accessible without GitHub authentication.
