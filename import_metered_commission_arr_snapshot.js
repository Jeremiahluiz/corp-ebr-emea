const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const OUTPUT = path.join(
  ROOT,
  "sales_leader_metered_commission_arr_snapshots.json"
);

function parseCsvLine(line) {
  const values = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      values.push(value);
      value = "";
    } else {
      value += character;
    }
  }
  values.push(value);
  return values;
}

function parseMoney(value) {
  const normalized = String(value || "")
    .replaceAll("$", "")
    .replaceAll(",", "")
    .trim();
  const amount = Number(normalized || 0);
  if (!Number.isFinite(amount)) {
    throw new Error(`Invalid Commission ARR value: ${value}`);
  }
  return amount;
}

function parsePowerBiCsv(text) {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim());
  if (lines.length < 2) throw new Error("Power BI CSV has no account rows");
  const headers = parseCsvLine(lines[0]).map((header) => header.trim());
  const findHeader = (...candidates) =>
    candidates.find((candidate) => headers.includes(candidate));
  const accountIdHeader = findHeader("se_id", "Account ID", "accountId");
  const accountNameHeader = findHeader(
    "salesforce_name",
    "Salesforce Name",
    "accountName"
  );
  const commissionArrHeader = findHeader(
    "GHE-GHAS Metered Commission ARR",
    "Commission ARR",
    "commissionArr"
  );
  if (!accountIdHeader || !commissionArrHeader) {
    throw new Error(
      `Expected se_id and GHE-GHAS Metered Commission ARR columns. Found: ${headers.join(", ")}`
    );
  }
  const index = Object.fromEntries(
    headers.map((header, headerIndex) => [header, headerIndex])
  );
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return {
      accountId: values[index[accountIdHeader]]?.trim(),
      accountName: accountNameHeader
        ? values[index[accountNameHeader]]?.trim()
        : "",
      commissionArr: parseMoney(values[index[commissionArrHeader]])
    };
  }).filter(({ accountId }) => accountId && accountId !== "Total");
}

function main() {
  const [csvPath, asOfDate] = process.argv.slice(2);
  if (!csvPath || !asOfDate) {
    throw new Error(
      "Usage: node import_metered_commission_arr_snapshot.js <power-bi.csv> <YYYY-MM-DD>"
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) {
    throw new Error(`Invalid as-of date: ${asOfDate}`);
  }
  const accounts = parsePowerBiCsv(fs.readFileSync(csvPath, "utf8"));
  const data = fs.existsSync(OUTPUT)
    ? JSON.parse(fs.readFileSync(OUTPUT, "utf8"))
    : { snapshots: [] };
  const snapshot = {
    asOfDate,
    importedAt: new Date().toISOString(),
    accounts
  };
  data.snapshots = [
    ...(data.snapshots || []).filter((item) => item.asOfDate !== asOfDate),
    snapshot
  ].sort((left, right) => left.asOfDate.localeCompare(right.asOfDate));
  fs.writeFileSync(OUTPUT, `${JSON.stringify(data, null, 2)}\n`);
  console.log(JSON.stringify({ asOfDate, accounts: accounts.length }));
}

if (require.main === module) main();

module.exports = { parsePowerBiCsv };
