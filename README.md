# Budget — Monthly

A quiet, Apple-inspired monthly budgeting app. Log income, set outgoings, investments, and anything else across dynamic categories you create — and watch the months unfold on a single dashboard.

**Live demo:** https://vladpm.github.io/vladbudget/

## Features

- Add and edit monthly entries against custom categories.
- Categories grouped by type: **Income**, **Set outgoings**, **Investments**, **Other**.
- Month picker with prev/next navigation.
- Dashboard with KPIs (income, outgoings, investments, net) plus month-on-month comparison.
- 12-month trend chart (stacked income vs. outgoings/investments, with a net line).
- Per-category breakdown for the selected month.
- Filterable entry log per month.
- Export / import JSON backup. Reset everything in one click.
- 100% client-side: data lives in your browser via `localStorage`.

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
  "schemaVersion": 1,
  "categories": [
    { "id": "…", "name": "Salary", "type": "income" }
  ],
  "entries": [
    { "id": "…", "date": "2026-05-01", "categoryId": "…", "amount": 2500, "note": "May salary" }
  ]
}
```

Use **Export JSON** in the Data section to back this up.
