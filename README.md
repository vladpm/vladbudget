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
- **Cross-device sync (optional)** — add Supabase credentials and sign in by magic link to access the same budget from your phone, tablet and desktop. See [Cross-device sync setup](#cross-device-sync-setup).
- **Works offline** — data lives in the browser via `localStorage`; cloud sync, when enabled, mirrors changes to your Supabase row in the background.

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
- [Supabase](https://supabase.com) (optional) for cross-device sync — single Postgres row per user, JSONB document, magic-link auth, RLS-protected.
- Design system distilled from Apple's web surfaces (see [`DESIGN.md`](DESIGN.md)).

## Cross-device sync setup

The app works locally with no setup. To sync across devices (phone + desktop), wire it up to a free Supabase project — takes ~5 minutes.

1. **Create a Supabase project** at <https://supabase.com> (free tier is fine).
2. In your project, open **SQL Editor → New query**, paste the contents of [`schema.sql`](schema.sql), and run it. This creates one `budgets` table and protects rows by user.
3. Open **Authentication → Providers → Email** and make sure “Email” is enabled with magic links (it's the default).
4. Open **Authentication → URL Configuration** and add your site URL to the allow-list (e.g. `https://vladpm.github.io/vladbudget/` and `http://localhost:8000` for local dev).
5. Open **Settings → API** and copy:
   - **Project URL** → `supabaseUrl`
   - **anon / public** key → `supabaseAnonKey` (this key is meant to be public; RLS protects your data).
6. Edit [`config.js`](config.js) and paste those two values in. Commit & push.

Then open the deployed site, type your email, click the magic link in your inbox — on whichever device you want to use — and you're synced. The header shows a small **Synced** indicator. Sign out from the **Data** section.

> Conflict handling is last-write-wins. The app re-fetches when the tab regains focus and listens for realtime updates from other devices, so two-device editing converges quickly.

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
