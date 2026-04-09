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

## Deploy to GitHub Pages

1. Push this repository to GitHub.
2. In GitHub repo settings, open **Pages** and ensure **Build and deployment** uses **GitHub Actions**.
3. Push to `main` (or run the workflow manually). The workflow in `.github/workflows/deploy-pages.yml` will:
   - run `npm ci`
   - run `npm run build:data`
   - export static files to `dist/`
   - deploy `dist/` to Pages

Local preview of the Pages artifact:

```bash
npm run build:pages
npm run serve
```

## Data files

- `data/events.raw.json` - unprocessed scrape snapshot
- `data/events.normalized.json` - normalized weekend events used by the UI

## Filters in UI

- Exclude Commander
- Exclude Legacy
- Exclude Vintage
- Exclude Day 2 / Top Cut events
- Max cost per person slider
- Title search
