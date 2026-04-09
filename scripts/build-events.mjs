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

function parseDateLike(value) {
  if (!value) return null;
  if (typeof value === "number") {
    const ms = value > 1e12 ? value : value * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
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
