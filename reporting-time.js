const TIME_ZONE = "Europe/Amsterdam";

function datePart(value) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return String(value);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`Invalid reporting date: ${value}`);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit"
  }).format(date);
}

function addDays(value, days) {
  const date = new Date(`${datePart(value)}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function monday(value) {
  const day = new Date(`${datePart(value)}T12:00:00Z`).getUTCDay();
  return addDays(value, -(day === 0 ? 6 : day - 1));
}

function timestamp(value) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    timeZoneName: "longOffset"
  }).formatToParts(new Date(value)).map(({ type, value: part }) => [type, part]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${parts.timeZoneName.replace("GMT", "")}`;
}

function midnight(value) {
  let offset = timestamp(`${value}T00:00:00Z`).slice(-6);
  offset = timestamp(`${value}T00:00:00${offset}`).slice(-6);
  return `${value}T00:00:00${offset}`;
}

function reportingPeriod(value) {
  const end = monday(value);
  return {
    monday: addDays(end, -7), sunday: addDays(end, -1),
    startInclusive: midnight(addDays(end, -7)), endExclusive: midnight(end),
    timezone: TIME_ZONE
  };
}

module.exports = { TIME_ZONE, datePart, monday, addDays, timestamp, midnight, reportingPeriod };
