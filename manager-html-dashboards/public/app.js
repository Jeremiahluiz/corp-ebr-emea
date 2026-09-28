const data = window.DASHBOARD;
const byId = (id) => document.getElementById(id);
const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0
});
const compact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1
});
const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

function weekLabel(start) {
  const end = new Date(`${start}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 6);
  const formatter = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "Europe/Amsterdam"
  });
  return `${formatter.format(new Date(`${start}T00:00:00Z`))}-${formatter.format(end)}`;
}

function renderChart(id, metricName, formatter) {
  const values = data.weeks.map((week) => data.weekly[week]?.[metricName]?.value || 0);
  const max = Math.max(1, ...values);
  byId(id).innerHTML = data.weeks
    .map((week, index) => {
      const value = values[index];
      const height = Math.max(1, (value / max) * 205);
      return `<div class="bar-column">
        <span class="bar-value">${escapeHtml(formatter(value))}</span>
        <span class="bar" style="height:${height}px"></span>
        <span class="bar-label">${escapeHtml(week.slice(5).replace("-", "/"))}</span>
      </div>`;
    })
    .join("");
}

function renderFunnel() {
  if (!data.stages.length) {
    byId("funnel").innerHTML = '<p class="empty">No mapped pipeline.</p>';
    return;
  }
  byId("funnel").innerHTML = data.stages
    .map((stage, index) => {
      const width =
        data.stages.length === 1
          ? 100
          : 100 - (index * 52) / (data.stages.length - 1);
      return `<div class="funnel-stage" style="width:${width}%">
        <span>${escapeHtml(stage.stage)}</span>
        <strong>${escapeHtml(compact.format(stage.value))}</strong>
      </div>`;
    })
    .join("");
}

function renderTable() {
  byId("ic-table").innerHTML = data.ics
    .map(
      (row) => `<tr>
        <td>${escapeHtml(row.ae)}</td>
        <td>${escapeHtml(row.ebr || "Unassigned")}</td>
        <td>${row.scheduled.value}</td>
        <td>${row.sql.value}</td>
        <td>${escapeHtml(money.format(row.licensed.value))}</td>
        <td>${escapeHtml(money.format(row.metered.value))}</td>
        <td>${escapeHtml(money.format(row.pipeline.value))}</td>
        <td>${escapeHtml(money.format(row.licensedClosedWon.value))}</td>
        <td>${escapeHtml(money.format(row.meteredClosedWon.value))}</td>
        <td>${escapeHtml(money.format(row.closedWon.value))}</td>
      </tr>`
    )
    .join("");
}

function renderFeatured(containerId, totalId, records) {
  const grouped = new Map();
  for (const record of records) {
    const key = `${record.label}:${record.subtitle}`;
    const current = grouped.get(key) || { ...record, amount: 0 };
    current.amount += Number(record.amount || 0);
    grouped.set(key, current);
  }
  const entries = [...grouped.values()].sort((a, b) => b.amount - a.amount);
  byId(totalId).textContent = compact.format(
    entries.reduce((sum, record) => sum + record.amount, 0)
  );
  byId(containerId).innerHTML = entries.length
    ? entries
        .map(
          (record) => `<div class="feature-row">
            <div><strong>${escapeHtml(record.label)}</strong><br><small>${escapeHtml(record.subtitle)}</small></div>
            <strong>${escapeHtml(money.format(record.amount))}</strong>
          </div>`
        )
        .join("")
    : '<p class="empty">No opportunities in this stage.</p>';
}

byId("scope").textContent =
  `${data.segment} | FY quarter ${data.quarter.start} to ${data.quarter.end} (exclusive) | Europe/Amsterdam | Refreshed ${data.generatedAt}`;
byId("sql-method").textContent = data.sqlObservation.basis;
byId("sql-coverage").textContent =
  `SQL history coverage: ${Object.values(data.sqlObservation.excluded).reduce((sum, count) => sum + count, 0)} candidate events excluded from QTD because same-week Held evidence is missing, ambiguous, or crosses a week boundary.`;
byId("breakdown-title").textContent = data.tableTitle || "IC breakdown";
byId("breakdown-primary").textContent = data.tablePrimaryHeader || "AE / IC";
byId("breakdown-secondary").textContent = data.tableSecondaryHeader || "EBR";
byId("closed-won-title").textContent =
  data.closedWonPanelTitle || "Closed Won pipeline";
byId("qtd-scheduled").textContent = data.qtd.scheduled;
byId("qtd-sql").textContent = data.qtd.sql;
byId("qtd-licensed").textContent = compact.format(data.qtd.licensed);
byId("qtd-metered").textContent = `${compact.format(data.qtd.metered)} metered`;
byId("qtd-pipeline").textContent = `${compact.format(data.qtd.pipeline)} total`;
byId("qtd-won").textContent = compact.format(data.qtd.closedWon);
byId("qtd-won-licensed").textContent = compact.format(
  data.qtd.licensedClosedWon || 0
);
byId("qtd-won-metered").textContent = compact.format(
  data.qtd.meteredClosedWon || 0
);
if (data.enrichment) {
  byId("qtd-won-method").textContent =
    `Metered attributed revenue: saved snapshot as of ${data.enrichment.metered.asOfDate}, fixed baseline ${data.enrichment.metered.baselineAsOfDate}. Licensed Closed Won: saved Salesforce source as of ${data.enrichment.licensed.asOfDate}. Effective-dated EBR/SEBR role history as of ${data.enrichment.roleHistory.asOfDate}. Revenue is not refreshed by the activity refresh.`;
} else if (data.meteredSnapshotStatus?.status === "ready") {
  byId("qtd-won-method").textContent =
    `Measurement window: ${data.meteredSnapshotStatus.baselineAsOfDate} to ${data.meteredSnapshotStatus.latestAsOfDate}.`;
}

const previousWeek = data.reportingPeriod.monday;
const previous = data.weekly[previousWeek];
if (!previous) throw new Error(`Missing completed-week payload: ${previousWeek}`);
byId("previous-label").textContent =
  `${data.reportingPeriod.monday} to ${data.reportingPeriod.sunday} (Europe/Amsterdam)`;
byId("previous-scheduled").textContent = previous.scheduled.value;
byId("previous-sql").textContent = previous.sql.value;
byId("previous-licensed").textContent = compact.format(previous.licensed.value);
byId("previous-metered").textContent = compact.format(previous.metered.value);
byId("previous-pipeline").textContent = compact.format(previous.pipeline.value);

byId("scheduled-total").textContent = data.qtd.scheduled;
byId("sql-total").textContent = data.qtd.sql;
byId("pipeline-total").textContent = compact.format(data.qtd.pipeline);
renderChart("scheduled-chart", "scheduled", String);
renderChart("sql-chart", "sql", String);
renderChart("pipeline-chart", "pipeline", (value) => (value ? compact.format(value) : "0"));
renderFunnel();
renderTable();
renderFeatured("business-selected", "business-total", data.featured["Business Selected"]);
renderFeatured("closed-won", "closed-total", data.featured["Closed Won"]);
