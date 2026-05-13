# Budget — Monthly

A quiet, Apple-inspired monthly budgeting app. Log income, set outgoings, investments, and anything else across dynamic categories you create — and watch the months unfold on a single dashboard.

**Live demo:** https://vladpm.github.io/vladbudget/

## Features

- **Add, edit and delete monthly entries** against custom categories.
- **Recurring entries** — tick “Repeat every month” when adding salary or fixed spending and it shows in every future month automatically. Stop a recurring entry from any month onward without losing past history.
- **Categories** grouped by type: **Income**, **Set outgoings**, **Investments**, **Savings**, **Other**. Rename, retype or delete any.
- **Card balances** — track this month's balance on each credit card (Amex, Barclaycard, or any you add). Card names are editable; per-month balances save inline as you type.
- **“Leftover” KPI** that subtracts outgoings, investments **and** card balances from your income, so you see what's actually yours after the month settles.
- **Month picker** with prev/next navigation.
- **Dashboard** with KPIs (income, outgoings, investments, card balances, leftover) plus month-on-month deltas.
- **12-month trend chart** — income above the axis, outgoings/investments/cards stacked below, leftover overlaid as a line.
- **Per-category breakdown** for the selected month.
- **Filterable entry log** per month.
- **Export / import JSON** backup. Reset everything in one click.
- **100% client-side**: data lives in your browser via `localStorage`.

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
- Design system distilled from Apple's web surfaces (see [`DESIGN.md`](DESIGN.md)).

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
