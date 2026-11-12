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
- SQL reproduces the Salesforce report scope: configured `Meeting_Set_By__c`, activity `Type = Meeting`, `Meeting_Status__c = Held`, `Set_By__c = EBR`, fiscal-quarter Start date, and an Opportunity relation.
- Each activity is credited once. Weekly credit uses the earliest available `TracRTC__History_Log__c` Held observation in Europe/Amsterdam. When observation history has no Held row, the report-compatible Start date is recorded as an explicit fallback instead of silently dropping a valid report row. QTD eligibility remains tied to the report's fiscal-quarter Start filter.
- Opportunity Owner determines AE and manager scope, matching the Salesforce report. Current Account Owner is retained in the private audit. AE and EBR must match the team mapping; out-of-manager or mismatched rows remain explicit in `unmapped` instead of being reassigned to another EBR.
- Licensed pipeline is deduplicated by opportunity and credited through an EBR-created opportunity or quote.
- Metered pipeline is additive across distinct Product Milestones and uses `Total_Expected_Change__c * 3`. Exact duplicate source records with the same creator, timestamp, opportunity, product, milestone name and amount are counted once and audited.
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

The refresh fetches report-compatible Event and Task activity plus all available observation history for those records. Query completeness is mandatory. `DASHBOARD_AS_OF` can pin one execution timestamp; page generation otherwise reuses the successful refresh timestamp. All bucketing and the previous completed reporting week use Europe/Amsterdam.

Raw queries, credited Event IDs, evidence log IDs, and excluded candidates are written to `DASHBOARD_AUDIT_DIR` (default `.dashboard-audit/`, ignored by Git). Preserve this directory in the workflow run manifest; do not publish it. `sales_leader_sql_observation_status.json` retains internal coverage and methodology. Page generation renders the conservative SQL methodology, but not internal coverage records.

Activity and pipeline QTD follow the fiscal quarter containing the execution date. Queries also cover the complete previous Amsterdam week when it crosses a quarter boundary. Grouped source rows carry separate `value` (weekly) and `qtdValue` (current-quarter) amounts, both derived from the original credit date, never the week's Monday. Stage and featured pipeline use current-quarter source credits. Saved Q1 FY27 attributed revenue remains separately labelled and is not restated as Q2 revenue.

Activity refresh does not recalculate revenue. Preserve the saved licensed Closed Won, metered Commission ARR, immutable 2026-08-31 baseline, and effective-dated role history when fresh enrichment cannot be certified. Pages show each saved source's actual as-of date. Before publication compare revenue values against the previous live pages, reconcile all AEs/managers/directors and unmapped records, and validate the generated HTML. After publication require a successful Pages deployment and HTTP/payload verification of all eight URLs.

## Hosted pages

### Separate FY27 Q1 snapshots

Set `DASHBOARD_SNAPSHOT=fy27-q1`, `DASHBOARD_AS_OF` to the actual extraction
timestamp, and `DASHBOARD_DATA_DIR` plus `DASHBOARD_AUDIT_DIR` to an isolated run
directory. Run the same refresh, build, check, test and generation commands.
Run tests without the snapshot environment so their independent fixtures retain
their own reporting contexts.

Snapshot generation writes only `q1-fy27-gilles-chalon.html` and
`q1-fy27-fernando-munoz-drinot.html`; it does not rewrite the eight weekly pages,
index, weekly source JSON, saved revenue, role history or fixed metered baseline.
Publish only those two new files, preserving the weekly deployment paths.

The snapshot uses July 1 inclusive through October 1 exclusive in
Europe/Amsterdam. All 14 intersecting Monday buckets appear, including zero
weeks; the June 29 and September 28 boundary buckets contain only Q1 credits.
Created Events and pipeline source creation dates are bounded to the quarter.
SQL still uses complete TracRTC observations, with first eligible Held observed
in Q1. No meeting start-time fallback is used. Current ownership, stages and
pipeline amounts reflect extraction time rather than a reconstructed historical
quarter-end state. Saved attributed revenue retains its actual source dates.
Without `DASHBOARD_SNAPSHOT`, the normal Monday workflow is unchanged.

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
