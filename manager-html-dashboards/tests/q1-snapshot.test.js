const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { execFileSync } = require("node:child_process");
const { Q1, Q1_PAGES, reportContext, quarterWeeks, q1ReportingPeriod } = require("../src/report-context");
const { buildSnapshot } = require("../src/dashboard");
const ROOT = path.resolve(__dirname, "../..");
const asOf = "2026-10-06T12:26:49+02:00";

test("Q1 snapshot has exact Amsterdam boundaries and all 14 intersecting weeks", () => {
  assert.deepEqual(q1ReportingPeriod(), {
    start: "2026-07-01", endInclusive: "2026-09-30",
    startInclusive: "2026-07-01T00:00:00+02:00",
    endExclusive: "2026-10-01T00:00:00+02:00",
    timezone: "Europe/Amsterdam", label: "FY27 Q1 completed quarter"
  });

  test("quarter presentation shows completed-period totals while weekly rendering stays unchanged", () => {
    const html = fs.readFileSync(path.join(ROOT, "manager-html-dashboards/output/gilles-chalon.html"), "utf8");
    const data = JSON.parse(html.match(/<script>window\.DASHBOARD = ([\s\S]*?);<\/script>/)[1]);
    const oldApp = html.match(/<script>(const data = window\.DASHBOARD;[\s\S]*?)<\/script>/)[1];
    const app = fs.readFileSync(path.join(ROOT, "manager-html-dashboards/public/app.js"), "utf8");
    const render = (script, dashboard) => {
      const nodes = {};
      vm.runInNewContext(script, {
        window: { DASHBOARD: dashboard }, document: { getElementById: id => nodes[id] ||= {} },
        Intl, Date, Map, Number, String, Math, Error
      });
      return nodes;
    };
    assert.deepEqual(render(app, data), render(oldApp, data));
    const quarter = { ...data, periodKind: "quarter", reportingPeriod: q1ReportingPeriod() };
    const nodes = render(app, quarter);
    assert.equal(nodes["previous-label"].textContent, "2026-07-01 to 2026-09-30 (Europe/Amsterdam)");
    assert.equal(nodes["previous-scheduled"].textContent, quarter.qtd.scheduled);
    assert.equal(nodes["previous-sql"].textContent, quarter.qtd.sql);
    assert.equal(nodes["previous-pipeline"].textContent, nodes["pipeline-total"].textContent);
  });
  const context = reportContext(asOf, { DASHBOARD_SNAPSHOT: "fy27-q1", DASHBOARD_DATA_DIR: "/tmp/q1-test" });
  assert.equal(context.createdUpperBound, "CreatedDate < 2026-09-30T22:00:00.000Z");
  assert.equal(context.sourceStart, "2026-07-01");
  const weeks = quarterWeeks(Q1);
  assert.equal(weeks.length, 14);
  assert.equal(weeks[0], "2026-06-29");
  assert.equal(weeks.at(-1), "2026-09-28");
  assert.deepEqual(Object.keys(Q1_PAGES).sort(), ["Fernando Munoz Drinot", "Gilles Chalon"]);
  assert.throws(() => reportContext(asOf, { DASHBOARD_SNAPSHOT: "fy27-q1" }), /isolated/);
  assert.throws(() => reportContext(asOf, { DASHBOARD_SNAPSHOT: "fy27-q1", DASHBOARD_DATA_DIR: ROOT }), /overwrite/);
  assert.throws(() => reportContext("2026-09-30", { DASHBOARD_SNAPSHOT: "fy27-q1" }), /completed/);
  const weekly = reportContext(asOf, {});
  assert.equal(weekly.snapshot, false);
  assert.equal(weekly.sourceStart, "2026-09-28");
  assert.deepEqual(weekly.quarter, { start: "2026-10-01", end: "2027-01-01" });
});

test("production refresh and build isolate Q1 dates and reconcile Gilles and Fernando", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ebr-q1-test-"));
  const env = { ...process.env, DASHBOARD_SNAPSHOT: "fy27-q1", DASHBOARD_DATA_DIR: dir,
    DASHBOARD_AUDIT_DIR: dir, DASHBOARD_AS_OF: asOf };
  try {
    execFileSync(process.execPath, ["-e", `
      const { EBR_USERS } = require("./manager-html-dashboards/src/config");
      const assert = require("node:assert/strict");
      const pairs = [
        ["Bouke Kingma", "Louis Leccia"],
        ["Daniel Spanjaard", "Emilio van der Zanden"],
        ["Illane Hamache", "Pedro Oom"]
      ];
      const dates = ["2026-06-30T21:59:59Z", "2026-06-30T22:00:00Z",
        "2026-09-30T21:59:59Z", "2026-09-30T22:00:00Z"];
      const events = pairs.flatMap(([ebr, ae], i) => dates.map((date, j) => ({
        Id: "00U-event-" + i + "-" + j, CreatedById: EBR_USERS[ebr], CreatedDate: date,
        StartDateTime: date, Type: "Meeting", Meeting_Set_By__c: ebr,
        Meeting_Status__c: "Held", Set_By__c: "EBR", WhatId: "006-sql-" + i + "-" + j,
        AccountId: "001-" + i, Account: { Name: "Account " + i, Owner: { Name: ae } }
      })));
      const inside = events.filter(e => e.CreatedDate >= "2026-06-30T22:00:00Z"
        && e.CreatedDate < "2026-09-30T22:00:00Z");
      require("node:child_process").execFileSync = (command, args) => {
        const q = args[args.indexOf("--query") + 1];
        let records;
        if (q.includes("FROM TracRTC__History_Log__c")) {
          records = events.map(e => ({
            Id: "log-" + e.Id, TracRTC__Object_Id__c: e.Id, TracRTC__Log_Date__c: e.CreatedDate,
            TracRTC__Record_End_State__c: JSON.stringify({ Id: e.Id, Meeting_Status__c: "Held" })
          }));
        } else {
          if (q.includes("FROM Event")) {
            if (q.includes("Meeting_Status__c = 'Held'")) {
              assert.ok(q.includes("StartDateTime >= 2026-06-30T22:00:00.000Z"));
              assert.ok(q.includes("StartDateTime < 2026-09-30T22:00:00.000Z"));
            } else {
              assert.ok(q.includes("CreatedDate >= 2026-06-30T22:00:00.000Z"));
              assert.ok(q.includes("CreatedDate < 2026-09-30T22:00:00.000Z"));
            }
            records = inside;
          } else if (q.includes("FROM Task")) {
            records = [];
          } else if (q.includes("FROM Opportunity")) {
            if (q.includes("AccountId, Account.Name")) {
              records = inside.map(e => {
                const pair = pairs.find(([ebr]) => e.Meeting_Set_By__c === ebr);
                return { Id: e.WhatId, Name: "SQL opportunity", Owner: { Name: pair[1] },
                  AccountId: e.AccountId, Account: e.Account };
              });
            } else {
              assert.ok(q.includes("CreatedDate < 2026-09-30T22:00:00.000Z"));
              records = pairs.map(([ebr, ae], i) => ({
                Id: "opp-" + i, CreatedById: EBR_USERS[ebr], CreatedDate: "2026-09-30T21:59:59Z",
                Name: "Pipeline " + i, Owner: { Name: ae }, StageName: "Business Selected",
                Type: "Upgrade", Quote_Flag__c: "Approved", License_New_ARR_10__c: 100
              }));
            }
          } else if (q.includes("FROM Product_Milestone__c")) {
            assert.ok(q.includes("CreatedDate < 2026-09-30T22:00:00.000Z"));
            records = pairs.map(([ebr, ae], i) => ({
              Id: "milestone-" + i, CreatedById: EBR_USERS[ebr], CreatedDate: "2026-07-01T00:00:00Z",
              Opportunity__c: "metered-" + i, Total_Expected_Change__c: 10,
              Opportunity__r: { Name: "Metered " + i, Owner: { Name: ae }, StageName: "Qualified" }
            }));
          } else records = [];
        }
        return JSON.stringify({ status: 0, result: { records, totalSize: records.length, done: true } });
      };
      require("./refresh_sales_leader_data").main();
    `], { cwd: ROOT, env, encoding: "utf8" });
    execFileSync(process.execPath, ["build_sales_leader_dashboard_data.js"], { cwd: ROOT, env });
    const fernando = buildSnapshot("Fernando Munoz Drinot", dir);
    const gilles = buildSnapshot("Gilles Chalon", dir);
    const carmen = buildSnapshot("Carmen Marced", dir);
    const dj = buildSnapshot("Dirk-Jan de Vries", dir);
    assert.equal(fernando.ics.length, 5);
    assert.equal(fernando.breakdownType, "ic");
    assert.deepEqual(gilles.ics.map(r => r.ae), ["Carmen Marced", "Dirk-Jan de Vries"]);
    for (const dashboard of [fernando, gilles, carmen, dj]) {
      assert.deepEqual(dashboard.quarter, Q1);
      assert.equal(dashboard.weeks.length, 14);
      for (const metric of ["scheduled", "sql", "licensed", "metered", "pipeline"])
        assert.equal(dashboard.qtd[metric], dashboard.weeks.reduce((sum, week) => sum + dashboard.weekly[week][metric].value, 0));
      assert.equal(dashboard.stages.reduce((sum, stage) => sum + stage.value, 0), dashboard.qtd.pipeline);
    }
    assert.equal(fernando.qtd.scheduled, 2);
    assert.equal(fernando.qtd.sql, 2);
    assert.equal(fernando.qtd.licensed, 100);
    assert.equal(fernando.qtd.metered, 30);
    assert.equal(gilles.qtd.scheduled, 4);
    assert.equal(gilles.qtd.sql, 4);
    for (const metric of ["scheduled", "sql", "licensed", "metered", "pipeline"])
      assert.equal(gilles.qtd[metric], carmen.qtd[metric] + dj.qtd[metric]);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});
