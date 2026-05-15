# Budget — Monthly

A quiet, Apple-inspired monthly budgeting app. Log income, set outgoings, investments, and anything else across dynamic categories you create — and watch the months unfold on a single dashboard.

**Live demo:** https://vladpm.github.io/vladbudget/

## Features

- **Monthly checkup journey** — a guided 6-step pass through your month: set opening bank balance → confirm income → review outgoings → fund future you (savings/investments) → update card balances → see where you'll land. Each step is a clickable card with live status.
- **Bank balance with carry-over** — type your current balance once and the app projects it forward through every month using your logged income/outgoings/savings, so future months show a realistic projected end-of-month balance automatically.
- **Add, edit and delete monthly entries** against custom categories.
- **Recurring entries** — toggle the "Recurring" checkbox directly in the entries table to make any line repeat every month, or use the dialog to set a specific **end month** (e.g. a 12-month gym membership). Past months keep their copy when you stop a recurring entry.
- **Categories** grouped by type: **Income**, **Set outgoings**, **Investments**, **Savings**, **Other**. Rename, retype or delete any.
- **Card balances** — track this month's balance on each credit card (Amex, Barclaycard, or any you add). Card names are editable; per-month balances save inline as you type.
- **“Leftover” KPI** that subtracts outgoings, investments **and** card balances from your income, so you see what's actually yours after the month settles.
- **Month picker** with prev/next navigation.
- **Dashboard** with KPIs (income, outgoings, investments, card balances, leftover) plus month-on-month deltas.
- **12-month trend chart** — income above the axis, outgoings/investments/cards stacked below, leftover overlaid as a line.
- **Per-category breakdown** for the selected month.
- **Filterable entry log** per month.
- **Export / import JSON** backup. Reset everything in one click.
- **Cross-device sync (optional)** — paste a GitHub token and sync your data to a private Gist so the same budget is available from your phone, tablet and desktop. See [Cross-device sync setup](#cross-device-sync-setup).
- **Works offline** — data lives in the browser via `localStorage`; when sync is connected, changes mirror to your private gist in the background.

## Run locally

It's a static site — no build step required.

```bash
# from the project root
python3 -m http.server 8000
# then open http://localhost:8000
```

Or just open `index.html` directly in a browser.

## Tech

- Vanilla HTML, CSS, JavaScript.
- [Chart.js 4](https://www.chartjs.org/) loaded from a CDN for the trend chart.
- GitHub Gist (optional) for cross-device sync — the entire budget is stored as one private gist, accessed via the GitHub REST API with a Personal Access Token (`gist` scope only).
- Design system distilled from Stripe's web surfaces (see [`DESIGN.md`](DESIGN.md)).

## Cross-device sync setup

The app works locally with no setup. To sync across devices (phone + desktop), connect it to a private GitHub Gist — takes ~2 minutes.

### One-time, on your first device

1. **Create a Personal Access Token** at <https://github.com/settings/tokens?type=beta>. The only required scope is **“Gists”** (Read & Write). A classic token with the **`gist`** scope works too. Set the expiration to whatever you like.
2. Open the deployed site → **Data** section → click **Connect to GitHub Gist**.
3. Paste the token into the **GitHub token** field. Leave **Gist ID** empty.
4. Click **Connect**. The app creates a private gist named `vladbudget.json` and shows you the new Gist ID. Copy it.

### On every other device

1. Open the deployed site → **Data** → **Connect to GitHub Gist**.
2. Paste the same token + the Gist ID from step 4.
3. Click **Connect**. The app pulls your data instantly.

From then on, every change auto-syncs in the background. The header shows a small **Synced** indicator (or **Saving…** / **Offline**). The app pulls fresh on tab focus and every 60 seconds. To disconnect a device, use **Disconnect sync** in the Data section — the token & gist ID are cleared from that browser; the gist itself stays intact.

> The token never leaves your browser — it's stored only in `localStorage` and sent only to `api.github.com`. The repo never sees it.

## Deployment

Deployed automatically to GitHub Pages on every push to `main` via [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml).

## Data model

Data is stored under the `vladbudget.v1` key in `localStorage`:

```jsonc
{
  "schemaVersion": 4,
  "categories": [
    { "id": "…", "name": "Salary", "type": "income" }
  ],
  "entries": [
    {
      "id": "…",
      "month": "2026-05",
      "categoryId": "…",
      "amount": 2500,
      "note": "Monthly salary",
      "recurring": true,
      "endMonth": null
    }
  ],
  "cards": [
    { "id": "…", "name": "Amex" },
    { "id": "…", "name": "Barclaycard" }
  ],
  "cardBalances": [
    { "cardId": "…", "month": "2026-05", "amount": 412.30 }
  ]
}
```

Use **Export JSON** in the Data section to back this up. Older v1–v3 exports are migrated automatically on import (per-entry `date` strings collapse to `month`, and `recurring`/`endMonth` defaults are filled in).
