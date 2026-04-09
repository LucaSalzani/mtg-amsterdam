import fs from "node:fs/promises";
import path from "node:path";

const INPUT_PATH = path.resolve("data", "events.raw.json");
const OUTPUT_PATH = path.resolve("data", "events.normalized.json");
const AMSTERDAM_TZ = "Europe/Amsterdam";
const WEEKEND = new Set(["Friday", "Saturday", "Sunday"]);
const EVENT_INFO_BASE_URL =
  "https://mcamsterdam.mtgfestivals.com/en-us/magic-play/ticketed-play-schedule/ticketed-play-information.html";

function parseCostValue(cost) {
  if (cost == null) return null;
  if (typeof cost === "number") return Number.isFinite(cost) ? cost : null;
  const normalized = String(cost).replace(",", ".");
  const match = normalized.match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function extractEuroAmountText(text) {
  if (!text) return null;
  const match = String(text).match(/€\s?\d+(?:[.,]\d+)?/);
  if (!match) return null;
  return match[0].replace(/\s+/g, "");
}

function inferCostText(record) {
  if (record?.cost != null && String(record.cost).trim() !== "") {
    return String(record.cost).trim();
  }
  const fromTitle = extractEuroAmountText(record?.title);
  if (fromTitle) return fromTitle;
  return "Unknown";
}

function getOffsetMinutesForZone(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
    hour: "2-digit"
  });
  const tzPart = formatter.formatToParts(date).find((part) => part.type === "timeZoneName")?.value;
  if (!tzPart) return 0;
  const match = tzPart.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/i);
  if (!match) return 0;
  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3] ?? 0);
  return sign * (hours * 60 + minutes);
}

function parseAmsterdamLocalDateString(value) {
  const match = String(value).match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/
  );
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] ?? 0);

  let utcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  // Iterate once or twice to account for offset changes around DST boundaries.
  for (let i = 0; i < 3; i += 1) {
    const offsetMinutes = getOffsetMinutesForZone(new Date(utcMs), AMSTERDAM_TZ);
    const adjusted = Date.UTC(year, month - 1, day, hour, minute, second) - offsetMinutes * 60_000;
    if (adjusted === utcMs) break;
    utcMs = adjusted;
  }

  return new Date(utcMs);
}

function parseDateLike(value) {
  if (!value) return null;
  if (typeof value === "number") {
    const ms = value > 1e12 ? value : value * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?$/.test(value)
  ) {
    const amsterdamDate = parseAmsterdamLocalDateString(value);
    if (amsterdamDate && !Number.isNaN(amsterdamDate.getTime())) return amsterdamDate;
  }
  const d = new Date(value);
  if (!Number.isNaN(d.getTime())) return d;
  return null;
}

function weekdayName(date) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    timeZone: AMSTERDAM_TZ
  }).format(date);
}

function normalizeEvent(record) {
  const title = String(record.title ?? "").trim();
  if (!title) return null;

  const startDate = parseDateLike(record.start);
  if (!startDate) return null;
  const endDate = parseDateLike(record.end) ?? new Date(startDate.getTime() + 60 * 60 * 1000);
  const costText = inferCostText(record);
  const costValue = parseCostValue(costText);

  const day = weekdayName(startDate);
  if (!WEEKEND.has(day)) return null;
  const sourceEventId =
    record?.raw && typeof record.raw === "object" && record.raw.id != null
      ? String(record.raw.id)
      : null;
  const tags = [
    ...(Array.isArray(record?.tags)
      ? record.tags
      : String(record?.tags ?? "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)),
    ...(Array.isArray(record?.raw?.schedule_categories)
      ? record.raw.schedule_categories
          .map((category) => String(category?.name ?? "").trim())
          .filter(Boolean)
      : []),
    ...(Array.isArray(record?.raw?.global_categories)
      ? record.raw.global_categories
          .map((category) => String(category?.name ?? "").trim())
          .filter(Boolean)
      : [])
  ];
  const uniqueTags = [...new Set(tags)];
  const eventUrl = sourceEventId ? `${EVENT_INFO_BASE_URL}?gtID=${encodeURIComponent(sourceEventId)}` : null;

  return {
    title,
    start: startDate.toISOString(),
    end: endDate.toISOString(),
    cost: costText,
    costValue,
    day,
    source: record.source ?? "unknown",
    sourceEventId,
    eventUrl,
    tags: uniqueTags
  };
}

function dedupe(events) {
  const seen = new Set();
  return events.filter((event) => {
    const key = `${event.title}|${event.start}|${event.end}|${event.cost}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function main() {
  const raw = JSON.parse(await fs.readFile(INPUT_PATH, "utf8"));
  const inputEvents = Array.isArray(raw.events) ? raw.events : [];

  const warnings = [];
  const normalized = [];

  for (const event of inputEvents) {
    const built = normalizeEvent(event);
    if (!built) continue;
    if (!event?.end) {
      warnings.push(`Missing end time, defaulted to +1h: ${event?.title ?? "(untitled)"}`);
    }
    const inferredCost = inferCostText(event);
    if (inferredCost === "Unknown") {
      warnings.push(`Missing cost, set to Unknown: ${event?.title ?? "(untitled)"}`);
    }
    normalized.push(built);
  }

  normalized.sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
  const deduped = dedupe(normalized);

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(
    OUTPUT_PATH,
    JSON.stringify(
      {
        builtAt: new Date().toISOString(),
        timezone: AMSTERDAM_TZ,
        count: deduped.length,
        warnings,
        events: deduped
      },
      null,
      2
    ),
    "utf8"
  );

  console.log(`Wrote ${deduped.length} normalized events to ${OUTPUT_PATH}`);
  if (warnings.length) {
    console.log(`Warnings (${warnings.length})`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
