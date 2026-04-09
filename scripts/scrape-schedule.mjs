import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const SOURCE_URL =
  "https://mcamsterdam.mtgfestivals.com/en-us/magic-play/ticketed-play-schedule.html";
const OUTPUT_PATH = path.resolve("data", "events.raw.json");

function looksLikeEvent(obj) {
  if (!obj || typeof obj !== "object") return false;
  const title = obj.title ?? obj.name ?? obj.event_title ?? obj.eventName;
  const start =
    obj.start ??
    obj.start_time ??
    obj.startTime ??
    obj.start_date ??
    obj.startDate ??
    obj.start_datetime ??
    obj.starts_at;
  return Boolean(title) && Boolean(start);
}

function extractEventLikeRecords(root, sourceUrl, records) {
  if (Array.isArray(root)) {
    for (const item of root) extractEventLikeRecords(item, sourceUrl, records);
    return;
  }
  if (!root || typeof root !== "object") return;

  if (looksLikeEvent(root)) {
    records.push({
      source: sourceUrl,
      title: root.title ?? root.name ?? root.event_title ?? root.eventName ?? "",
      start:
        root.start ??
        root.start_time ??
        root.startTime ??
        root.start_date ??
        root.startDate ??
        root.start_datetime ??
        root.starts_at ??
        null,
      end:
        root.end ??
        root.end_time ??
        root.endTime ??
        root.end_date ??
        root.endDate ??
        root.end_datetime ??
        root.ends_at ??
        null,
      cost:
        root.cost ??
        root.price ??
        root.price_display ??
        root.entry_fee ??
        root.fee ??
        root.amount ??
        root.ticket_price ??
        null,
      tags: root.tags ?? root.categories ?? root.category ?? null,
      location: root.location ?? root.room ?? null,
      raw: root
    });
  }

  for (const value of Object.values(root)) {
    extractEventLikeRecords(value, sourceUrl, records);
  }
}

function dedupeRecords(records) {
  const seen = new Set();
  return records.filter((record) => {
    const key = `${record.title}|${record.start}|${record.end}|${String(record.cost ?? "")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function discoverLeapScheduleUrl(page) {
  await page.waitForTimeout(3000);
  const hrefFromAnchors = await page.evaluate(() => {
    const anchors = Array.from(document.querySelectorAll("a[href]"));
    const hit = anchors.find((a) => a.href.includes("conventions.leapevent.tech"));
    return hit ? hit.href : null;
  });
  if (hrefFromAnchors) return hrefFromAnchors;

  const html = await page.content();
  const match = html.match(/https:\/\/conventions\.leapevent\.tech\/[^"'<\s)]+/i);
  return match ? match[0] : null;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const records = [];
  const responseUrls = new Set();

  page.on("response", async (response) => {
    try {
      const url = response.url();
      const contentType = response.headers()["content-type"] ?? "";
      const interestingUrl = /schedule|event|ticket|product|dashboard|calendar|session|play/i.test(
        url
      );
      if (!contentType.includes("application/json") && !interestingUrl) return;

      const bodyText = await response.text();
      if (!bodyText) return;
      let parsed;
      try {
        parsed = JSON.parse(bodyText);
      } catch {
        return;
      }
      responseUrls.add(url);
      extractEventLikeRecords(parsed, url, records);
    } catch {
      // ignore noisy response parse errors
    }
  });

  await page.goto(SOURCE_URL, { waitUntil: "domcontentloaded", timeout: 120000 });
  const leapUrl = await discoverLeapScheduleUrl(page);

  if (leapUrl) {
    await page.goto(leapUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForTimeout(8000);
  }

  const domFallback = await page.evaluate(() => {
    const candidates = [];
    const cards = Array.from(document.querySelectorAll("article, .event, .card, li, tr, .ticket"));
    for (const card of cards) {
      const text = card.textContent?.trim();
      if (!text || text.length < 12) continue;
      const titleNode = card.querySelector("h1, h2, h3, h4, strong, [class*=title]");
      const timeNode = card.querySelector("[class*=time], time");
      const costNode = card.querySelector("[class*=price], [class*=cost], [class*=fee]");
      const title = titleNode?.textContent?.trim() ?? text.split("\n")[0]?.trim();
      const timeText = timeNode?.textContent?.trim() ?? null;
      const cost = costNode?.textContent?.trim() ?? null;
      if (!title) continue;
      candidates.push({
        source: "dom-fallback",
        title,
        start: timeText,
        end: null,
        cost,
        raw: text.slice(0, 800)
      });
    }
    return candidates;
  });

  const combined = dedupeRecords([...records, ...domFallback]);
  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(
    OUTPUT_PATH,
    JSON.stringify(
      {
        sourceUrl: SOURCE_URL,
        leapUrl,
        scrapedAt: new Date().toISOString(),
        responseSources: [...responseUrls].sort(),
        eventCount: combined.length,
        events: combined
      },
      null,
      2
    ),
    "utf8"
  );

  await browser.close();
  console.log(`Wrote ${combined.length} raw events to ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
