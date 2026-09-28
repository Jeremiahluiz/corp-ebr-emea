# Manager HTML dashboards

This dashboard pack keeps the six existing PNG/SVG reports unchanged and generates six standalone HTML files.

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
- SQL held uses `Event.StartDateTime` with `Meeting_Status__c = 'Held'`.
- Licensed pipeline is deduplicated by opportunity and credited through an EBR-created opportunity or quote.
- Metered pipeline is additive and uses `Total_Expected_Change__c * 3`.
- Licensed closed-won revenue uses unique Q1 won opportunities attributed through an EBR-created opportunity, quote, or linked milestone.
- Metered closed-won revenue requires a product-aligned GHE or GHAS Commission ARR increase observed after milestone creation. Each account/product uplift is counted once; Copilot, stale, mixed-product, and unverified-timing milestones are excluded.
- Anna Sobala's July 2026 activity and pipeline attribution are excluded.

The HTML values are a saved snapshot. The linked SQL report is the route to current Salesforce data.

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
