/* =============================================================
 * Budget — monthly ledger
 * Vanilla JS, localStorage-backed, Chart.js for the trend chart.
 * ============================================================= */
(function () {
  "use strict";

  // -----------------------------------------------------------
  // Storage
  // -----------------------------------------------------------
  const STORAGE_KEY = "vladbudget.v1";
  const SCHEMA_VERSION = 3;

  /** @typedef {{id:string,name:string,type:'income'|'outgoing'|'investment'|'other'}} Category */
  /** @typedef {{id:string,month:string,categoryId:string,amount:number,note:string}} Entry */
  /** @typedef {{id:string,name:string}} Card */
  /** @typedef {{cardId:string,month:string,amount:number}} CardBalance */
  /** @typedef {{schemaVersion:number,categories:Category[],entries:Entry[],cards:Card[],cardBalances:CardBalance[]}} Store */

  const DEFAULT_CATEGORIES = [
    { name: "Salary", type: "income" },
    { name: "Side income", type: "income" },
    { name: "Rent / Mortgage", type: "outgoing" },
    { name: "Bills & utilities", type: "outgoing" },
    { name: "Groceries", type: "outgoing" },
    { name: "Transport", type: "outgoing" },
    { name: "Subscriptions", type: "outgoing" },
    { name: "ISA / Stocks", type: "investment" },
    { name: "Pension top-up", type: "investment" },
    { name: "Discretionary", type: "other" },
  ];

  const DEFAULT_CARDS = [
    { name: "Amex" },
    { name: "Barclaycard" },
  ];

  const TYPE_LABEL = {
    income: "Income",
    outgoing: "Set outgoing",
    investment: "Investment",
    other: "Other",
  };

  const TYPE_COLOR = {
    income: "#30d158",
    outgoing: "#ff453a",
    investment: "#0066cc",
    other: "#ff9f0a",
  };

  const CARDS_COLOR = "#bf5af2";

  /** @returns {Store} */
  function loadStore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return seedStore();
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return seedStore();
      if (!Array.isArray(parsed.categories) || !Array.isArray(parsed.entries)) {
        return seedStore();
      }
      return migrate(parsed);
    } catch (_e) {
      return seedStore();
    }
  }

  /** Bring older stores forward to the current schema. */
  function migrate(s) {
    let changed = false;
    if (!Array.isArray(s.cards)) {
      s.cards = DEFAULT_CARDS.map((c) => ({ id: uid(), name: c.name }));
      changed = true;
    }
    if (!Array.isArray(s.cardBalances)) {
      s.cardBalances = [];
      changed = true;
    }
    // v2 → v3: collapse per-entry `date` to `month` (YYYY-MM)
    for (const e of s.entries) {
      if (e.month) continue;
      if (typeof e.date === "string" && e.date.length >= 7) {
        e.month = e.date.slice(0, 7);
      } else {
        e.month = monthKeyFromDate(new Date());
      }
      delete e.date;
      changed = true;
    }
    if (s.schemaVersion !== SCHEMA_VERSION) {
      s.schemaVersion = SCHEMA_VERSION;
      changed = true;
    }
    if (changed) saveStore(s);
    return s;
  }

  /** @returns {Store} */
  function seedStore() {
    const categories = DEFAULT_CATEGORIES.map((c) => ({
      id: uid(),
      name: c.name,
      type: c.type,
    }));
    const cards = DEFAULT_CARDS.map((c) => ({ id: uid(), name: c.name }));
    const store = {
      schemaVersion: SCHEMA_VERSION,
      categories,
      entries: [],
      cards,
      cardBalances: [],
    };
    saveStore(store);
    return store;
  }

  /** @param {Store} store */
  function saveStore(store) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  }

  function uid() {
    return (
      Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
    );
  }

  // -----------------------------------------------------------
  // App state
  // -----------------------------------------------------------
  /** @type {Store} */
  let store = loadStore();
  let selectedMonth = monthKeyFromDate(new Date()); // "YYYY-MM"
  let trendChart = null;

  // -----------------------------------------------------------
  // DOM refs
  // -----------------------------------------------------------
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const els = {
    monthInput: $("#monthInput"),
    prevMonth: $("#prevMonthBtn"),
    nextMonth: $("#nextMonthBtn"),
    navMonthLabel: $("#navMonthLabel"),
    heroMonthLabel: $("#heroMonthLabel"),

    kpiIncome: $("#kpiIncome"),
    kpiOutgoings: $("#kpiOutgoings"),
    kpiInvestments: $("#kpiInvestments"),
    kpiCards: $("#kpiCards"),
    kpiNet: $("#kpiNet"),
    kpiIncomeHint: $("#kpiIncomeHint"),
    kpiOutgoingsHint: $("#kpiOutgoingsHint"),
    kpiInvestmentsHint: $("#kpiInvestmentsHint"),
    kpiCardsHint: $("#kpiCardsHint"),
    kpiNetHint: $("#kpiNetHint"),

    breakdownGrid: $("#breakdownGrid"),
    entryTableBody: $("#entryTableBody"),
    entryEmpty: $("#entryEmpty"),
    filterType: $("#filterType"),

    addEntryBtn: $("#addEntryBtn"),
    addEntryBtn2: $("#addEntryBtn2"),

    categoryForm: $("#categoryForm"),
    catName: $("#catName"),
    catType: $("#catType"),
    categoryList: $("#categoryList"),

    cardsGrid: $("#cardsGrid"),
    cardsMonthLabel: $("#cardsMonthLabel"),
    cardForm: $("#cardForm"),
    cardName: $("#cardName"),

    exportBtn: $("#exportBtn"),
    importBtn: $("#importBtn"),
    importFile: $("#importFile"),
    resetBtn: $("#resetBtn"),

    entryDialog: $("#entryDialog"),
    entryDialogTitle: $("#entryDialogTitle"),
    entryDialogClose: $("#entryDialogClose"),
    entryDialogCancel: $("#entryDialogCancel"),
    entryForm: $("#entryForm"),
    entryMonth: $("#entryMonth"),
    entryCategory: $("#entryCategory"),
    entryAmount: $("#entryAmount"),
    entryNote: $("#entryNote"),
    entryId: $("#entryId"),

    categoryDialog: $("#categoryDialog"),
    categoryDialogClose: $("#categoryDialogClose"),
    categoryDialogCancel: $("#categoryDialogCancel"),
    categoryEditForm: $("#categoryEditForm"),
    editCatName: $("#editCatName"),
    editCatType: $("#editCatType"),
    editCatId: $("#editCatId"),

    cardDialog: $("#cardDialog"),
    cardDialogClose: $("#cardDialogClose"),
    cardDialogCancel: $("#cardDialogCancel"),
    cardEditForm: $("#cardEditForm"),
    editCardName: $("#editCardName"),
    editCardId: $("#editCardId"),

    toast: $("#toast"),
    footerYear: $("#footerYear"),
    trendCanvas: $("#trendChart"),
  };

  // -----------------------------------------------------------
  // Date helpers
  // -----------------------------------------------------------
  function monthKeyFromDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
  }
  function monthKeyFromIsoDate(iso) {
    return iso.slice(0, 7);
  }
  function shiftMonth(monthKey, delta) {
    const [y, m] = monthKey.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return monthKeyFromDate(d);
  }
  function formatMonthLong(monthKey) {
    const [y, m] = monthKey.split("-").map(Number);
    const d = new Date(y, m - 1, 1);
    return d.toLocaleDateString(undefined, {
      month: "long",
      year: "numeric",
    });
  }
  function formatMonthShort(monthKey) {
    const [y, m] = monthKey.split("-").map(Number);
    const d = new Date(y, m - 1, 1);
    return d.toLocaleDateString(undefined, { month: "short" });
  }
  function todayIso() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  function firstOfMonthIso(monthKey) {
    return `${monthKey}-01`;
  }
  function formatDateShort(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
    });
  }

  // -----------------------------------------------------------
  // Money helpers
  // -----------------------------------------------------------
  const fmtGBP = new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  });
  const fmtGBPCents = new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  // -----------------------------------------------------------
  // Selectors over store
  // -----------------------------------------------------------
  function categoryById(id) {
    return store.categories.find((c) => c.id === id) || null;
  }

  function cardById(id) {
    return store.cards.find((c) => c.id === id) || null;
  }

  function entriesForMonth(monthKey) {
    return store.entries
      .filter((e) => e.month === monthKey)
      .sort((a, b) => {
        // Sort by category name for a stable, scannable order within a month.
        const ca = categoryById(a.categoryId);
        const cb = categoryById(b.categoryId);
        const na = ca ? ca.name : "";
        const nb = cb ? cb.name : "";
        return na.localeCompare(nb);
      });
  }

  function totalsForMonth(monthKey) {
    const totals = { income: 0, outgoing: 0, investment: 0, other: 0 };
    for (const e of store.entries) {
      if (e.month !== monthKey) continue;
      const cat = categoryById(e.categoryId);
      if (!cat) continue;
      totals[cat.type] += e.amount;
    }
    return totals;
  }

  function cardBalance(cardId, monthKey) {
    const b = store.cardBalances.find(
      (x) => x.cardId === cardId && x.month === monthKey
    );
    return b ? b.amount : 0;
  }

  function setCardBalance(cardId, monthKey, amount) {
    const i = store.cardBalances.findIndex(
      (x) => x.cardId === cardId && x.month === monthKey
    );
    if (amount === 0 || amount == null || Number.isNaN(amount)) {
      if (i >= 0) store.cardBalances.splice(i, 1);
    } else if (i >= 0) {
      store.cardBalances[i].amount = amount;
    } else {
      store.cardBalances.push({ cardId, month: monthKey, amount });
    }
  }

  function cardsTotalForMonth(monthKey) {
    let total = 0;
    for (const b of store.cardBalances) {
      if (b.month === monthKey) total += b.amount;
    }
    return total;
  }

  function leftoverForMonth(monthKey) {
    const t = totalsForMonth(monthKey);
    const cards = cardsTotalForMonth(monthKey);
    return t.income - t.outgoing - t.investment - t.other - cards;
  }

  function trailingMonths(n) {
    const out = [];
    let key = selectedMonth;
    for (let i = 0; i < n; i++) {
      out.push(key);
      key = shiftMonth(key, -1);
    }
    return out.reverse();
  }

  // -----------------------------------------------------------
  // Renderers
  // -----------------------------------------------------------
  function render() {
    renderMonthLabels();
    renderKPIs();
    renderCards();
    renderBreakdown();
    renderTable();
    renderCategories();
    renderTrendChart();
  }

  function renderMonthLabels() {
    els.monthInput.value = selectedMonth;
    const long = formatMonthLong(selectedMonth);
    els.navMonthLabel.textContent = long;
    els.heroMonthLabel.textContent = long;
    if (els.cardsMonthLabel) els.cardsMonthLabel.textContent = long;
  }

  function renderKPIs() {
    const t = totalsForMonth(selectedMonth);
    const cards = cardsTotalForMonth(selectedMonth);
    const leftover = t.income - t.outgoing - t.investment - t.other - cards;

    els.kpiIncome.textContent = fmtGBP.format(t.income);
    els.kpiOutgoings.textContent = fmtGBP.format(t.outgoing);
    els.kpiInvestments.textContent = fmtGBP.format(t.investment);
    els.kpiCards.textContent = fmtGBP.format(cards);
    els.kpiNet.textContent = fmtGBP.format(leftover);

    const prevMonth = shiftMonth(selectedMonth, -1);
    const prev = totalsForMonth(prevMonth);
    const prevCards = cardsTotalForMonth(prevMonth);

    els.kpiIncomeHint.textContent = monthOverMonth(t.income, prev.income, "vs last month");
    els.kpiOutgoingsHint.textContent = monthOverMonth(t.outgoing, prev.outgoing, "vs last month");
    els.kpiInvestmentsHint.textContent = monthOverMonth(t.investment, prev.investment, "vs last month");

    if (store.cards.length === 0) {
      els.kpiCardsHint.textContent = "No cards added";
    } else {
      els.kpiCardsHint.textContent = monthOverMonth(cards, prevCards, "vs last month");
    }

    if (t.income === 0 && cards === 0 && t.outgoing === 0 && t.investment === 0 && t.other === 0) {
      els.kpiNetHint.textContent = "After outgoings, investments & card balances";
    } else if (leftover >= 0) {
      els.kpiNetHint.textContent = `${fmtGBP.format(leftover)} left after the month settles`;
    } else {
      els.kpiNetHint.textContent = `${fmtGBP.format(Math.abs(leftover))} short this month`;
    }
  }

  function monthOverMonth(current, prev, suffix) {
    if (!prev && !current) return "No entries yet";
    if (!prev) return "First month with data";
    const diff = current - prev;
    const pct = prev === 0 ? 0 : Math.round((diff / prev) * 100);
    const sign = diff > 0 ? "+" : diff < 0 ? "−" : "";
    return `${sign}${fmtGBP.format(Math.abs(diff))} (${sign}${Math.abs(pct)}%) ${suffix}`;
  }

  function renderBreakdown() {
    // Aggregate per category for this month
    const byCat = new Map();
    for (const e of store.entries) {
      if (e.month !== selectedMonth) continue;
      const cur = byCat.get(e.categoryId) || { total: 0, count: 0 };
      cur.total += e.amount;
      cur.count += 1;
      byCat.set(e.categoryId, cur);
    }

    if (byCat.size === 0) {
      els.breakdownGrid.innerHTML = `
        <div class="bcard" style="grid-column:1 / -1">
          <p class="bcard__count">No entries for ${escapeHtml(formatMonthLong(selectedMonth))}.</p>
          <p class="bcard__count">Use “Add entry” above to start logging this month.</p>
        </div>`;
      return;
    }

    // Find max for bar scaling
    let max = 0;
    for (const v of byCat.values()) if (v.total > max) max = v.total;

    const cards = [];
    // Order: by type (income, outgoing, investment, other), then by total desc
    const typeOrder = ["income", "outgoing", "investment", "other"];
    const sorted = Array.from(byCat.entries())
      .map(([catId, v]) => ({ cat: categoryById(catId), ...v }))
      .filter((row) => row.cat)
      .sort((a, b) => {
        const ta = typeOrder.indexOf(a.cat.type);
        const tb = typeOrder.indexOf(b.cat.type);
        if (ta !== tb) return ta - tb;
        return b.total - a.total;
      });

    for (const row of sorted) {
      const pct = max > 0 ? Math.max(4, Math.round((row.total / max) * 100)) : 0;
      const color = TYPE_COLOR[row.cat.type];
      cards.push(`
        <article class="bcard">
          <div class="bcard__head">
            <h3 class="bcard__name">${escapeHtml(row.cat.name)}</h3>
            <span class="bcard__type">${escapeHtml(TYPE_LABEL[row.cat.type])}</span>
          </div>
          <p class="bcard__value">${fmtGBPCents.format(row.total)}</p>
          <div class="bcard__bar" aria-hidden="true">
            <span style="width:${pct}%;background:${color}"></span>
          </div>
          <p class="bcard__count">${row.count} ${row.count === 1 ? "entry" : "entries"}</p>
        </article>
      `);
    }
    els.breakdownGrid.innerHTML = cards.join("");
  }

  function renderTable() {
    const filterType = els.filterType.value;
    let rows = entriesForMonth(selectedMonth);
    if (filterType !== "all") {
      rows = rows.filter((e) => {
        const cat = categoryById(e.categoryId);
        return cat && cat.type === filterType;
      });
    }

    if (rows.length === 0) {
      els.entryTableBody.innerHTML = "";
      els.entryEmpty.hidden = false;
      return;
    }
    els.entryEmpty.hidden = true;

    const html = rows
      .map((e) => {
        const cat = categoryById(e.categoryId);
        const type = cat ? cat.type : "other";
        const color = TYPE_COLOR[type];
        const sign = type === "income" ? "+" : "−";
        return `
          <tr data-id="${e.id}">
            <td>
              <span class="cat-pill" style="color:${color}">
                ${escapeHtml(cat ? cat.name : "Uncategorised")}
              </span>
              <div class="bcard__count">${escapeHtml(cat ? TYPE_LABEL[type] : "")}</div>
            </td>
            <td>${escapeHtml(e.note || "")}</td>
            <td class="num amt amt--${type}">${sign}${fmtGBPCents.format(e.amount)}</td>
            <td class="num">
              <button type="button" class="icon-btn" data-act="edit" aria-label="Edit entry">
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                  <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
                    d="M4 20h4l10-10-4-4L4 16v4zM14 6l4 4"/>
                </svg>
              </button>
              <button type="button" class="icon-btn icon-btn--danger" data-act="delete" aria-label="Delete entry">
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                  <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
                    d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-9 0 1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/>
                </svg>
              </button>
            </td>
          </tr>`;
      })
      .join("");
    els.entryTableBody.innerHTML = html;
  }

  function renderCategories() {
    // Refresh entry-category select inside dialog
    if (store.categories.length === 0) {
      els.entryCategory.innerHTML = `<option value="">No categories yet — create one</option>`;
    } else {
      els.entryCategory.innerHTML = store.categories
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(
          (c) =>
            `<option value="${c.id}">${escapeHtml(c.name)} — ${escapeHtml(TYPE_LABEL[c.type])}</option>`
        )
        .join("");
    }

    // Render category list
    if (store.categories.length === 0) {
      els.categoryList.innerHTML = `
        <li class="cat-item">
          <div class="cat-item__main">
            <span class="cat-item__name">No categories yet</span>
            <span class="cat-item__type">Add one above to get started.</span>
          </div>
        </li>`;
      return;
    }

    const grouped = {};
    for (const t of ["income", "outgoing", "investment", "other"]) grouped[t] = [];
    for (const c of store.categories) grouped[c.type].push(c);

    const items = [];
    for (const t of ["income", "outgoing", "investment", "other"]) {
      const list = grouped[t]
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name));
      for (const c of list) {
        const inUse = store.entries.some((e) => e.categoryId === c.id);
        items.push(`
          <li class="cat-item">
            <div class="cat-item__main">
              <span class="cat-item__name" style="border-left:3px solid ${TYPE_COLOR[c.type]};padding-left:10px">${escapeHtml(c.name)}</span>
              <span class="cat-item__type">${escapeHtml(TYPE_LABEL[c.type])}${inUse ? " · in use" : ""}</span>
            </div>
            <div class="ccard__actions">
              <button type="button" class="icon-btn" data-cat-edit="${c.id}" aria-label="Edit category ${escapeHtml(c.name)}">
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                  <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
                    d="M4 20h4l10-10-4-4L4 16v4zM14 6l4 4"/>
                </svg>
              </button>
              <button type="button" class="icon-btn icon-btn--danger" data-cat-del="${c.id}" aria-label="Delete category ${escapeHtml(c.name)}">
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                  <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
                    d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-9 0 1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/>
                </svg>
              </button>
            </div>
          </li>`);
      }
    }
    els.categoryList.innerHTML = items.join("");
  }

  function renderCards() {
    if (!els.cardsGrid) return;
    if (store.cards.length === 0) {
      els.cardsGrid.innerHTML = `
        <div class="ccard ccard--empty">
          <p>No cards yet. Add your first one below — e.g. “Amex” or “Barclaycard”.</p>
        </div>`;
      return;
    }
    const html = store.cards
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => {
        const bal = cardBalance(c.id, selectedMonth);
        const value = bal === 0 ? "" : String(bal);
        return `
          <article class="ccard" data-card-id="${c.id}">
            <div class="ccard__head">
              <div class="ccard__name-wrap">
                <span class="ccard__chip" aria-hidden="true"></span>
                <h3 class="ccard__name">${escapeHtml(c.name)}</h3>
              </div>
              <div class="ccard__actions">
                <button type="button" class="icon-btn" data-card-edit="${c.id}" aria-label="Rename ${escapeHtml(c.name)}">
                  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                    <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
                      d="M4 20h4l10-10-4-4L4 16v4zM14 6l4 4"/>
                  </svg>
                </button>
                <button type="button" class="icon-btn icon-btn--danger" data-card-del="${c.id}" aria-label="Delete ${escapeHtml(c.name)}">
                  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                    <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
                      d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-9 0 1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/>
                  </svg>
                </button>
              </div>
            </div>
            <div class="ccard__amount-row">
              <span class="ccard__currency">£</span>
              <input
                type="number"
                class="ccard__input"
                inputmode="decimal"
                step="0.01"
                min="0"
                placeholder="0.00"
                value="${value}"
                aria-label="Balance on ${escapeHtml(c.name)} for ${escapeHtml(formatMonthLong(selectedMonth))}"
                data-card-balance="${c.id}"
              />
            </div>
            <p class="ccard__hint">Balance for ${escapeHtml(formatMonthLong(selectedMonth))}</p>
          </article>`;
      })
      .join("");
    els.cardsGrid.innerHTML = html;
  }

  function renderTrendChart() {
    if (!els.trendCanvas || typeof Chart === "undefined") return;

    const months = trailingMonths(12);
    const labels = months.map(formatMonthShort);

    const incomeData = [];
    const outgoingData = [];
    const investmentData = [];
    const cardsData = [];
    const netData = [];

    for (const m of months) {
      const t = totalsForMonth(m);
      const cards = cardsTotalForMonth(m);
      incomeData.push(t.income);
      outgoingData.push(t.outgoing);
      investmentData.push(t.investment);
      cardsData.push(cards);
      netData.push(t.income - t.outgoing - t.investment - t.other - cards);
    }

    const data = {
      labels,
      datasets: [
        {
          type: "bar",
          label: "Income",
          data: incomeData,
          backgroundColor: "rgba(0, 102, 204, 0.85)",
          borderRadius: 6,
          stack: "flow-pos",
          order: 2,
        },
        {
          type: "bar",
          label: "Outgoings",
          data: outgoingData.map((v) => -v),
          backgroundColor: "rgba(255, 69, 58, 0.85)",
          borderRadius: 6,
          stack: "flow-neg",
          order: 2,
        },
        {
          type: "bar",
          label: "Investments",
          data: investmentData.map((v) => -v),
          backgroundColor: "rgba(48, 209, 88, 0.75)",
          borderRadius: 6,
          stack: "flow-neg",
          order: 2,
        },
        {
          type: "bar",
          label: "Card balances",
          data: cardsData.map((v) => -v),
          backgroundColor: "rgba(191, 90, 242, 0.8)",
          borderRadius: 6,
          stack: "flow-neg",
          order: 2,
        },
        {
          type: "line",
          label: "Leftover",
          data: netData,
          borderColor: "#2997ff",
          backgroundColor: "rgba(41, 151, 255, 0.12)",
          borderWidth: 2.5,
          tension: 0.32,
          pointRadius: 3,
          pointBackgroundColor: "#2997ff",
          fill: false,
          order: 1,
        },
      ],
    };

    const options = {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: "index" },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "rgba(29,29,31,0.95)",
          titleColor: "#fff",
          bodyColor: "#fff",
          borderColor: "rgba(255,255,255,0.08)",
          borderWidth: 1,
          padding: 12,
          callbacks: {
            label: (ctx) => {
              const raw = ctx.raw;
              const val = Math.abs(raw);
              return `${ctx.dataset.label}: ${fmtGBPCents.format(val)}`;
            },
          },
        },
      },
      scales: {
        x: {
          stacked: true,
          ticks: { color: "rgba(255,255,255,0.7)" },
          grid: { display: false },
        },
        y: {
          stacked: true,
          ticks: {
            color: "rgba(255,255,255,0.6)",
            callback: (v) => fmtGBP.format(Math.abs(v)),
          },
          grid: { color: "rgba(255,255,255,0.08)" },
        },
      },
    };

    if (trendChart) {
      trendChart.data = data;
      trendChart.options = options;
      trendChart.update();
    } else {
      trendChart = new Chart(els.trendCanvas, { data, options });
    }
  }

  // -----------------------------------------------------------
  // Event wiring
  // -----------------------------------------------------------
  function wire() {
    els.monthInput.addEventListener("change", () => {
      if (els.monthInput.value) {
        selectedMonth = els.monthInput.value;
        render();
      }
    });

    els.prevMonth.addEventListener("click", () => {
      selectedMonth = shiftMonth(selectedMonth, -1);
      render();
    });
    els.nextMonth.addEventListener("click", () => {
      selectedMonth = shiftMonth(selectedMonth, +1);
      render();
    });

    els.addEntryBtn.addEventListener("click", () => openEntryDialog());
    els.addEntryBtn2.addEventListener("click", () => openEntryDialog());

    els.entryDialogClose.addEventListener("click", () => closeEntryDialog());
    els.entryDialogCancel.addEventListener("click", () => closeEntryDialog());
    els.entryDialog.addEventListener("click", (e) => {
      // click on backdrop closes
      if (e.target === els.entryDialog) closeEntryDialog();
    });

    els.entryForm.addEventListener("submit", (e) => {
      e.preventDefault();
      saveEntryFromForm();
    });

    els.filterType.addEventListener("change", () => renderTable());

    els.entryTableBody.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-act]");
      if (!btn) return;
      const tr = btn.closest("tr");
      const id = tr && tr.dataset.id;
      if (!id) return;
      if (btn.dataset.act === "edit") openEntryDialog(id);
      if (btn.dataset.act === "delete") deleteEntry(id);
    });

    els.categoryForm.addEventListener("submit", (e) => {
      e.preventDefault();
      addCategoryFromForm();
    });

    els.categoryList.addEventListener("click", (e) => {
      const editBtn = e.target.closest("button[data-cat-edit]");
      if (editBtn) {
        openCategoryDialog(editBtn.getAttribute("data-cat-edit"));
        return;
      }
      const delBtn = e.target.closest("button[data-cat-del]");
      if (delBtn) deleteCategory(delBtn.getAttribute("data-cat-del"));
    });

    // Category edit dialog
    els.categoryDialogClose.addEventListener("click", () => closeDialog(els.categoryDialog));
    els.categoryDialogCancel.addEventListener("click", () => closeDialog(els.categoryDialog));
    els.categoryDialog.addEventListener("click", (e) => {
      if (e.target === els.categoryDialog) closeDialog(els.categoryDialog);
    });
    els.categoryEditForm.addEventListener("submit", (e) => {
      e.preventDefault();
      saveCategoryFromForm();
    });

    // Cards
    els.cardForm.addEventListener("submit", (e) => {
      e.preventDefault();
      addCardFromForm();
    });

    els.cardsGrid.addEventListener("click", (e) => {
      const editBtn = e.target.closest("button[data-card-edit]");
      if (editBtn) {
        openCardDialog(editBtn.getAttribute("data-card-edit"));
        return;
      }
      const delBtn = e.target.closest("button[data-card-del]");
      if (delBtn) deleteCard(delBtn.getAttribute("data-card-del"));
    });

    // Save card balance on input change (commits on blur or Enter for snappy UX)
    els.cardsGrid.addEventListener("change", (e) => {
      const inp = e.target.closest("input[data-card-balance]");
      if (!inp) return;
      handleCardBalanceInput(inp);
    });
    els.cardsGrid.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      const inp = e.target.closest("input[data-card-balance]");
      if (!inp) return;
      e.preventDefault();
      inp.blur();
    });

    // Card edit dialog
    els.cardDialogClose.addEventListener("click", () => closeDialog(els.cardDialog));
    els.cardDialogCancel.addEventListener("click", () => closeDialog(els.cardDialog));
    els.cardDialog.addEventListener("click", (e) => {
      if (e.target === els.cardDialog) closeDialog(els.cardDialog);
    });
    els.cardEditForm.addEventListener("submit", (e) => {
      e.preventDefault();
      saveCardFromForm();
    });

    els.exportBtn.addEventListener("click", exportData);
    els.importBtn.addEventListener("click", () => els.importFile.click());
    els.importFile.addEventListener("change", importData);
    els.resetBtn.addEventListener("click", resetData);

    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (els.entryDialog.open) closeDialog(els.entryDialog);
      else if (els.categoryDialog.open) closeDialog(els.categoryDialog);
      else if (els.cardDialog.open) closeDialog(els.cardDialog);
    });

    els.footerYear.textContent = new Date().getFullYear();
  }

  // -----------------------------------------------------------
  // Entry dialog
  // -----------------------------------------------------------
  function openEntryDialog(idToEdit) {
    if (store.categories.length === 0) {
      toast("Create a category first.");
      document.getElementById("categories").scrollIntoView({ behavior: "smooth" });
      els.catName.focus();
      return;
    }

    if (idToEdit) {
      const e = store.entries.find((x) => x.id === idToEdit);
      if (!e) return;
      els.entryDialogTitle.textContent = "Edit entry";
      els.entryId.value = e.id;
      els.entryMonth.value = e.month;
      els.entryCategory.value = e.categoryId;
      els.entryAmount.value = String(e.amount);
      els.entryNote.value = e.note || "";
    } else {
      els.entryDialogTitle.textContent = "Add entry";
      els.entryId.value = "";
      els.entryMonth.value = selectedMonth;
      els.entryCategory.selectedIndex = 0;
      els.entryAmount.value = "";
      els.entryNote.value = "";
    }

    if (typeof els.entryDialog.showModal === "function") {
      els.entryDialog.showModal();
    } else {
      els.entryDialog.setAttribute("open", "");
    }
    setTimeout(() => els.entryAmount.focus(), 50);
  }

  function closeEntryDialog() {
    closeDialog(els.entryDialog);
  }

  function closeDialog(dlg) {
    if (!dlg) return;
    if (dlg.open) dlg.close();
    else dlg.removeAttribute("open");
  }

  function showDialog(dlg) {
    if (!dlg) return;
    if (typeof dlg.showModal === "function") dlg.showModal();
    else dlg.setAttribute("open", "");
  }

  function saveEntryFromForm() {
    const id = els.entryId.value || uid();
    const month = els.entryMonth.value;
    const categoryId = els.entryCategory.value;
    const amount = parseFloat(els.entryAmount.value);
    const note = (els.entryNote.value || "").trim();

    if (!month || !/^\d{4}-\d{2}$/.test(month) || !categoryId || !Number.isFinite(amount) || amount < 0) {
      toast("Please fill in month, category and a valid amount.");
      return;
    }

    const existing = store.entries.find((e) => e.id === id);
    if (existing) {
      existing.month = month;
      existing.categoryId = categoryId;
      existing.amount = amount;
      existing.note = note;
    } else {
      store.entries.push({ id, month, categoryId, amount, note });
    }
    saveStore(store);

    // If the entry's month differs from the selected month, jump to it
    if (month !== selectedMonth) selectedMonth = month;

    closeEntryDialog();
    render();
    toast(existing ? "Entry updated" : "Entry added");
  }

  function deleteEntry(id) {
    const e = store.entries.find((x) => x.id === id);
    if (!e) return;
    if (!confirm("Delete this entry?")) return;
    store.entries = store.entries.filter((x) => x.id !== id);
    saveStore(store);
    render();
    toast("Entry deleted");
  }

  // -----------------------------------------------------------
  // Categories
  // -----------------------------------------------------------
  function addCategoryFromForm() {
    const name = els.catName.value.trim();
    const type = els.catType.value;
    if (!name) return;
    if (
      store.categories.some(
        (c) => c.name.toLowerCase() === name.toLowerCase() && c.type === type
      )
    ) {
      toast("That category already exists.");
      return;
    }
    store.categories.push({ id: uid(), name, type });
    saveStore(store);
    els.catName.value = "";
    render();
    toast("Category added");
  }

  function deleteCategory(id) {
    const cat = store.categories.find((c) => c.id === id);
    if (!cat) return;
    const used = store.entries.filter((e) => e.categoryId === id).length;
    const msg =
      used > 0
        ? `Delete “${cat.name}”? ${used} entr${used === 1 ? "y" : "ies"} using it will also be removed.`
        : `Delete “${cat.name}”?`;
    if (!confirm(msg)) return;
    store.categories = store.categories.filter((c) => c.id !== id);
    if (used > 0) {
      store.entries = store.entries.filter((e) => e.categoryId !== id);
    }
    saveStore(store);
    render();
    toast("Category deleted");
  }

  function openCategoryDialog(id) {
    const cat = categoryById(id);
    if (!cat) return;
    els.editCatId.value = cat.id;
    els.editCatName.value = cat.name;
    els.editCatType.value = cat.type;
    showDialog(els.categoryDialog);
    setTimeout(() => els.editCatName.focus(), 50);
  }

  function saveCategoryFromForm() {
    const id = els.editCatId.value;
    const cat = categoryById(id);
    if (!cat) return closeDialog(els.categoryDialog);
    const name = els.editCatName.value.trim();
    const type = els.editCatType.value;
    if (!name) return;
    if (
      store.categories.some(
        (c) =>
          c.id !== id &&
          c.name.toLowerCase() === name.toLowerCase() &&
          c.type === type
      )
    ) {
      toast("Another category already has that name and type.");
      return;
    }
    cat.name = name;
    cat.type = type;
    saveStore(store);
    closeDialog(els.categoryDialog);
    render();
    toast("Category updated");
  }

  // -----------------------------------------------------------
  // Cards
  // -----------------------------------------------------------
  function addCardFromForm() {
    const name = els.cardName.value.trim();
    if (!name) return;
    if (store.cards.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      toast("You already have a card with that name.");
      return;
    }
    store.cards.push({ id: uid(), name });
    saveStore(store);
    els.cardName.value = "";
    render();
    toast("Card added");
  }

  function handleCardBalanceInput(inp) {
    const cardId = inp.getAttribute("data-card-balance");
    if (!cardId) return;
    const raw = inp.value.trim();
    let amount = raw === "" ? 0 : parseFloat(raw);
    if (!Number.isFinite(amount) || amount < 0) {
      toast("Please enter a positive amount.");
      const existing = cardBalance(cardId, selectedMonth);
      inp.value = existing === 0 ? "" : String(existing);
      return;
    }
    amount = Math.round(amount * 100) / 100;
    setCardBalance(cardId, selectedMonth, amount);
    saveStore(store);
    // Re-render KPIs and chart only — leave the input alone so the user keeps focus context
    renderKPIs();
    renderTrendChart();
  }

  function openCardDialog(id) {
    const card = cardById(id);
    if (!card) return;
    els.editCardId.value = card.id;
    els.editCardName.value = card.name;
    showDialog(els.cardDialog);
    setTimeout(() => els.editCardName.focus(), 50);
  }

  function saveCardFromForm() {
    const id = els.editCardId.value;
    const card = cardById(id);
    if (!card) return closeDialog(els.cardDialog);
    const name = els.editCardName.value.trim();
    if (!name) return;
    if (
      store.cards.some(
        (c) => c.id !== id && c.name.toLowerCase() === name.toLowerCase()
      )
    ) {
      toast("You already have a card with that name.");
      return;
    }
    card.name = name;
    saveStore(store);
    closeDialog(els.cardDialog);
    render();
    toast("Card updated");
  }

  function deleteCard(id) {
    const card = cardById(id);
    if (!card) return;
    const used = store.cardBalances.filter((b) => b.cardId === id).length;
    const msg =
      used > 0
        ? `Delete “${card.name}”? ${used} month${used === 1 ? "" : "s"} of balances will also be removed.`
        : `Delete “${card.name}”?`;
    if (!confirm(msg)) return;
    store.cards = store.cards.filter((c) => c.id !== id);
    if (used > 0) {
      store.cardBalances = store.cardBalances.filter((b) => b.cardId !== id);
    }
    saveStore(store);
    render();
    toast("Card deleted");
  }

  // -----------------------------------------------------------
  // Data import / export / reset
  // -----------------------------------------------------------
  function exportData() {
    const blob = new Blob([JSON.stringify(store, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `budget-export-${todayIso()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast("Exported JSON");
  }

  function importData(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (!parsed || !Array.isArray(parsed.categories) || !Array.isArray(parsed.entries)) {
          toast("That file doesn't look right.");
          return;
        }
        if (
          !confirm(
            "Replace your current data with the imported file? This cannot be undone."
          )
        ) {
          return;
        }
        // Migrate imported entries from `date` to `month` if needed.
        const importedEntries = parsed.entries.map((e) => {
          if (e && e.month) return e;
          const cloned = Object.assign({}, e);
          if (typeof cloned.date === "string" && cloned.date.length >= 7) {
            cloned.month = cloned.date.slice(0, 7);
          } else {
            cloned.month = monthKeyFromDate(new Date());
          }
          delete cloned.date;
          return cloned;
        });
        store = {
          schemaVersion: SCHEMA_VERSION,
          categories: parsed.categories,
          entries: importedEntries,
          cards: Array.isArray(parsed.cards) ? parsed.cards : [],
          cardBalances: Array.isArray(parsed.cardBalances) ? parsed.cardBalances : [],
        };
        saveStore(store);
        render();
        toast("Imported");
      } catch (_err) {
        toast("Couldn't read that file.");
      } finally {
        els.importFile.value = "";
      }
    };
    reader.readAsText(file);
  }

  function resetData() {
    if (!confirm("Reset everything? All categories, cards, entries and balances will be deleted.")) return;
    if (!confirm("Are you absolutely sure? This cannot be undone.")) return;
    localStorage.removeItem(STORAGE_KEY);
    store = loadStore();
    selectedMonth = monthKeyFromDate(new Date());
    render();
    toast("Reset");
  }

  // -----------------------------------------------------------
  // Toast
  // -----------------------------------------------------------
  let toastTimer = null;
  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.hidden = false;
    requestAnimationFrame(() => els.toast.classList.add("is-visible"));
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      els.toast.classList.remove("is-visible");
      setTimeout(() => (els.toast.hidden = true), 220);
    }, 1800);
  }

  // -----------------------------------------------------------
  // Utilities
  // -----------------------------------------------------------
  function escapeHtml(s) {
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // -----------------------------------------------------------
  // Boot
  // -----------------------------------------------------------
  document.addEventListener("DOMContentLoaded", () => {
    wire();
    render();
  });
})();
