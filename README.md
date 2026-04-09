# MagicCon Amsterdam Planner

Local tool to scrape MagicCon Amsterdam ticketed play events and visualize overlaps in a 3-day calendar.

## Requirements

- Node.js 18+

## Setup

```bash
npm install
npx playwright install chromium
```

## Usage

```bash
npm run scrape
npm run build:data
npm run serve
```

Open `http://localhost:4173`.

## Data files

- `data/events.raw.json` - unprocessed scrape snapshot
- `data/events.normalized.json` - normalized weekend events used by the UI

## Filters in UI

- Exclude Commander
- Exclude Legacy
- Exclude Vintage
- Hide 200EUR+ events
- Title search
