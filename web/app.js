const DATA_URL = "./data/events.normalized.json";
const DAYS = ["Friday", "Saturday", "Sunday"];
const SAVED_VIEW = "Saved";
const TZ = "Europe/Amsterdam";
const START_MINUTE = 8 * 60;
const END_MINUTE = 24 * 60;
const STORAGE_KEY = "mtg-amsterdam-remembered-v1";

const state = {
  events: [],
  activeView: "Friday",
  remembered: new Set(),
  filters: {
    excludeCommander: false,
    excludeLegacy: false,
    excludeVintage: false,
    excludeDay2: false,
    maxCostPerPerson: null,
    search: ""
  }
};

function normalizeText(value) {
  return String(value ?? "").toLowerCase();
}

function eventKey(event) {
  if (event.sourceEventId) return `id:${event.sourceEventId}`;
  return `fallback:${event.start}|${event.end}|${event.title}|${event.cost}`;
}

function parseIsoToParts(iso) {
  const date = new Date(iso);
  const dtf = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hour12: false,
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit"
  });
  const parts = Object.fromEntries(dtf.formatToParts(date).map((p) => [p.type, p.value]));
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  return {
    day: parts.weekday,
    minutes: hour * 60 + minute,
    hhmm: `${parts.hour}:${parts.minute}`
  };
}

function matchesKeyword(event, keyword) {
  const title = normalizeText(event.title);
  if (title.includes(keyword)) return true;
  const tags = Array.isArray(event.tags) ? event.tags : [];
  return tags.some((tag) => normalizeText(tag).includes(keyword));
}

function isDay2StyleEvent(event) {
  const title = String(event.title ?? "");
  return /(day\s*2|top\s*\d+)/i.test(title);
}

function inferTeamSize(event) {
  const haystack = [
    String(event.title ?? ""),
    ...(Array.isArray(event.tags) ? event.tags.map((tag) => String(tag ?? "")) : [])
  ].join(" ");
  if (/\b(team\s*trios?|trios?)\b/i.test(haystack)) return 3;
  if (/\b(2hg|two[-\s]?headed giant)\b/i.test(haystack)) return 2;
  return 1;
}

function costPerPerson(event) {
  if (typeof event.costValue !== "number") return null;
  return event.costValue / inferTeamSize(event);
}

function filterEvents(events) {
  const query = normalizeText(state.filters.search.trim());
  return events.filter((event) => {
    if (state.filters.excludeCommander && matchesKeyword(event, "commander")) return false;
    if (state.filters.excludeLegacy && matchesKeyword(event, "legacy")) return false;
    if (state.filters.excludeVintage && matchesKeyword(event, "vintage")) return false;
    if (state.filters.excludeDay2 && isDay2StyleEvent(event)) return false;
    if (
      typeof state.filters.maxCostPerPerson === "number" &&
      Number.isFinite(state.filters.maxCostPerPerson)
    ) {
      const perPerson = costPerPerson(event);
      if (perPerson != null && perPerson > state.filters.maxCostPerPerson) return false;
    }
    if (query && !normalizeText(event.title).includes(query)) return false;
    return true;
  });
}

function assignLanes(events) {
  const laneEndMinutes = [];
  let laneCount = 0;
  const sorted = [...events].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);

  for (const event of sorted) {
    let lane = 0;
    while (lane < laneEndMinutes.length && laneEndMinutes[lane] > event.startMin) {
      lane += 1;
    }
    laneEndMinutes[lane] = event.endMin;
    event.lane = lane;
    laneCount = Math.max(laneCount, lane + 1);
  }

  for (const event of sorted) event.laneCount = laneCount;
  return Math.max(1, laneCount);
}

function formatHourLabel(minutesFromMidnight) {
  const hour = Math.floor(minutesFromMidnight / 60)
    .toString()
    .padStart(2, "0");
  return `${hour}:00`;
}

function getLayoutMetrics() {
  const isMobile = window.matchMedia("(max-width: 768px)").matches;
  if (isMobile) {
    return {
      pxPerMinuteX: 1.15,
      headerHeight: 22,
      laneHeight: 46,
      laneGap: 4,
      gridPadding: 4
    };
  }
  return {
    pxPerMinuteX: 1.8,
    headerHeight: 26,
    laneHeight: 56,
    laneGap: 6,
    gridPadding: 6
  };
}

function buildHourTicks() {
  const ticks = [];
  for (let minute = START_MINUTE; minute <= END_MINUTE; minute += 60) {
    ticks.push(minute);
  }
  return ticks;
}

function formatCost(cost) {
  if (!cost || cost === "Unknown") return "Cost: Unknown";
  return `Cost: ${cost}`;
}

function formatCostPerPerson(event) {
  const value = costPerPerson(event);
  if (value == null) return "Cost/person: Unknown";
  return `Cost/person: €${Math.round(value)}`;
}

function formatDateLabel(iso) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    weekday: "long",
    day: "2-digit",
    month: "short"
  }).format(new Date(iso));
}

function cleanTitle(title) {
  return String(title ?? "")
    .replace(/\s*\(Click here for more info\)\s*$/i, "")
    .trim();
}

function saveRemembered() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...state.remembered]));
}

function loadRemembered() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    if (Array.isArray(parsed)) {
      state.remembered = new Set(parsed.map((value) => String(value)));
    }
  } catch {
    state.remembered = new Set();
  }
}

function toggleRemembered(event) {
  const key = eventKey(event);
  if (state.remembered.has(key)) {
    state.remembered.delete(key);
  } else {
    state.remembered.add(key);
  }
  saveRemembered();
  render();
}

function buildRenderableEvents(events) {
  return events
    .map((event) => {
      const start = parseIsoToParts(event.start);
      const end = parseIsoToParts(event.end);
      return {
        ...event,
        renderDay: start.day,
        startMin: Math.max(START_MINUTE, start.minutes),
        endMin: Math.min(END_MINUTE, Math.max(start.minutes + 15, end.minutes)),
        timeLabel: `${start.hhmm} - ${end.hhmm}`,
        rememberKey: eventKey(event),
        isRemembered: state.remembered.has(eventKey(event))
      };
    })
    .filter((event) => event.endMin > START_MINUTE && event.startMin < END_MINUTE);
}

function renderCalendarDay(day, events) {
  const calendar = document.getElementById("calendar");
  calendar.innerHTML = "";
  const tpl = document.getElementById("dayTemplate");
  const node = tpl.content.firstElementChild.cloneNode(true);
  node.querySelector(".day-title").textContent = day;
  const timelineScroll = node.querySelector(".timeline-scroll");
  const grid = node.querySelector(".day-grid");
  const labels = node.querySelector(".hour-labels");
  const layer = node.querySelector(".events-layer");
  const layout = getLayoutMetrics();
  const hourWidth = 60 * layout.pxPerMinuteX;
  const timelineWidth = (END_MINUTE - START_MINUTE) * layout.pxPerMinuteX;
  const dayEvents = events.filter((event) => event.renderDay === day);
  const laneCount = assignLanes(dayEvents);
  const timelineHeight =
    layout.headerHeight +
    layout.gridPadding * 2 +
    laneCount * layout.laneHeight +
    Math.max(0, laneCount - 1) * layout.laneGap;

  grid.style.width = `${timelineWidth}px`;
  grid.style.height = `${timelineHeight}px`;
  grid.style.setProperty("--hour-width", `${hourWidth}px`);

  labels.innerHTML = buildHourTicks()
    .map((minute) => {
      const left = (minute - START_MINUTE) * layout.pxPerMinuteX;
      return `<span class="hour-label" style="left:${left}px">${formatHourLabel(minute)}</span>`;
    })
    .join("");

  for (const event of dayEvents) {
    const card = document.createElement("article");
    card.className = `event-card${event.isRemembered ? " event-card--remembered" : ""}`;
    card.setAttribute("role", "button");
    card.tabIndex = 0;
    card.title = event.isRemembered ? "Click to remove from Saved" : "Click to add to Saved";
    const left = (event.startMin - START_MINUTE) * layout.pxPerMinuteX;
    const width = Math.max(72, (event.endMin - event.startMin) * layout.pxPerMinuteX);
    const top =
      layout.headerHeight + layout.gridPadding + event.lane * (layout.laneHeight + layout.laneGap);
    card.style.left = `${left}px`;
    card.style.width = `${width}px`;
    card.style.top = `${top}px`;
    card.style.height = `${layout.laneHeight}px`;
    card.innerHTML = `
      <div class="event-title">${cleanTitle(event.title)}</div>
      <div class="event-meta">${event.timeLabel}</div>
    `;
    card.addEventListener("click", () => toggleRemembered(event));
    card.addEventListener("keydown", (keyboardEvent) => {
      if (keyboardEvent.key === "Enter" || keyboardEvent.key === " ") {
        keyboardEvent.preventDefault();
        toggleRemembered(event);
      }
    });
    layer.appendChild(card);
  }

  calendar.appendChild(node);
}

function renderSavedView() {
  const savedView = document.getElementById("savedView");
  const remembered = state.events
    .map((event) => {
      const start = parseIsoToParts(event.start);
      const end = parseIsoToParts(event.end);
      return {
        ...event,
        rememberKey: eventKey(event),
        timeLabel: `${start.hhmm} - ${end.hhmm}`
      };
    })
    .filter((event) => state.remembered.has(event.rememberKey))
    .sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));

  if (!remembered.length) {
    savedView.innerHTML = `<div class="saved-empty">No saved events yet. Click an event in any day view to save it.</div>`;
    return;
  }

  savedView.innerHTML = remembered
    .map((event) => {
      const linkMarkup = event.eventUrl
        ? `<a class="event-link" href="${event.eventUrl}" target="_blank" rel="noreferrer">Open event page</a>`
        : "";
      const idLine = event.sourceEventId ? `<div class="saved-meta">Event ID: ${event.sourceEventId}</div>` : "";
      return `
        <article class="saved-card">
          <h3>${cleanTitle(event.title)}</h3>
          <div class="saved-meta">${formatDateLabel(event.start)}</div>
          <div class="saved-meta">Time: ${event.timeLabel}</div>
          <div class="saved-meta">${formatCost(event.cost)}</div>
          <div class="saved-meta">${formatCostPerPerson(event)}</div>
          ${idLine}
          <div class="saved-actions">
            ${linkMarkup}
            <button type="button" class="saved-remove" data-key="${event.rememberKey}">Remove</button>
          </div>
        </article>
      `;
    })
    .join("");

  for (const button of savedView.querySelectorAll(".saved-remove")) {
    button.addEventListener("click", () => {
      const key = button.getAttribute("data-key");
      if (!key) return;
      state.remembered.delete(key);
      saveRemembered();
      render();
    });
  }
}

function updateViewTabs() {
  for (const tab of document.querySelectorAll(".view-tab")) {
    tab.classList.toggle("is-active", tab.dataset.view === state.activeView);
  }
}

function render() {
  const calendar = document.getElementById("calendar");
  const savedView = document.getElementById("savedView");
  const status = document.getElementById("status");
  const filtered = filterEvents(state.events);
  const renderable = buildRenderableEvents(filtered);

  updateViewTabs();

  if (state.activeView === SAVED_VIEW) {
    calendar.hidden = true;
    savedView.hidden = false;
    renderSavedView();
    status.textContent = `Saved ${state.remembered.size} events.`;
    updateCostPerPersonLabel();
    return;
  }

  calendar.hidden = false;
  savedView.hidden = true;
  renderCalendarDay(state.activeView, renderable);
  const visibleCount = renderable.filter((event) => event.renderDay === state.activeView).length;
  status.textContent = `Showing ${visibleCount} ${state.activeView} events (${filtered.length} after filters, ${state.events.length} total). Saved: ${state.remembered.size}`;
  updateCostPerPersonLabel();
}

function bindViewSelector() {
  for (const tab of document.querySelectorAll(".view-tab")) {
    tab.addEventListener("click", () => {
      const view = tab.dataset.view;
      if (!view) return;
      state.activeView = view;
      render();
    });
  }
}

function bindFilters() {
  const map = [
    ["excludeCommander", "excludeCommander"],
    ["excludeLegacy", "excludeLegacy"],
    ["excludeVintage", "excludeVintage"],
    ["excludeDay2", "excludeDay2"]
  ];
  for (const [id, key] of map) {
    document.getElementById(id).addEventListener("change", (event) => {
      state.filters[key] = event.target.checked;
      render();
    });
  }
  document.getElementById("searchInput").addEventListener("input", (event) => {
    state.filters.search = event.target.value;
    render();
  });
  document.getElementById("maxCostPerPerson").addEventListener("input", (event) => {
    state.filters.maxCostPerPerson = Number(event.target.value);
    render();
  });
}

function updateCostPerPersonLabel() {
  const value = document.getElementById("maxCostPerPersonValue");
  if (typeof state.filters.maxCostPerPerson === "number") {
    value.textContent = `€${Math.round(state.filters.maxCostPerPerson)}`;
    return;
  }
  value.textContent = "Any";
}

function configureCostPerPersonSlider() {
  const slider = document.getElementById("maxCostPerPerson");
  const perPersonCosts = state.events.map(costPerPerson).filter((value) => value != null);
  const maxKnown = perPersonCosts.length ? Math.max(...perPersonCosts) : 500;
  const sliderMax = Math.max(100, Math.ceil(maxKnown / 5) * 5);
  slider.max = String(sliderMax);
  if (state.filters.maxCostPerPerson == null || state.filters.maxCostPerPerson > sliderMax) {
    state.filters.maxCostPerPerson = sliderMax;
  }
  slider.value = String(state.filters.maxCostPerPerson);
  updateCostPerPersonLabel();
}

async function init() {
  loadRemembered();
  bindViewSelector();
  bindFilters();

  const response = await fetch(DATA_URL);
  if (!response.ok) {
    document.getElementById("status").textContent =
      "Could not load data/events.normalized.json. Run scrape + build first.";
    return;
  }
  const payload = await response.json();
  state.events = Array.isArray(payload.events) ? payload.events : [];
  configureCostPerPersonSlider();
  window.addEventListener("resize", () => render());
  render();
}

init().catch((error) => {
  document.getElementById("status").textContent = `Failed to initialize: ${error.message}`;
});
