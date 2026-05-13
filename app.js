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
  const SCHEMA_VERSION = 1;

  /** @typedef {{id:string,name:string,type:'income'|'outgoing'|'investment'|'other'}} Category */
  /** @typedef {{id:string,date:string,categoryId:string,amount:number,note:string}} Entry */
  /** @typedef {{schemaVersion:number,categories:Category[],entries:Entry[]}} Store */

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
      return parsed;
    } catch (_e) {
      return seedStore();
    }
  }

  /** @returns {Store} */
  function seedStore() {
    const categories = DEFAULT_CATEGORIES.map((c) => ({
      id: uid(),
      name: c.name,
      type: c.type,
    }));
    const store = {
      schemaVersion: SCHEMA_VERSION,
      categories,
      entries: [],
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
    kpiNet: $("#kpiNet"),
    kpiIncomeHint: $("#kpiIncomeHint"),
    kpiOutgoingsHint: $("#kpiOutgoingsHint"),
    kpiInvestmentsHint: $("#kpiInvestmentsHint"),
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

    exportBtn: $("#exportBtn"),
    importBtn: $("#importBtn"),
    importFile: $("#importFile"),
    resetBtn: $("#resetBtn"),

    entryDialog: $("#entryDialog"),
    entryDialogTitle: $("#entryDialogTitle"),
    entryDialogClose: $("#entryDialogClose"),
    entryDialogCancel: $("#entryDialogCancel"),
    entryForm: $("#entryForm"),
    entryDate: $("#entryDate"),
    entryCategory: $("#entryCategory"),
    entryAmount: $("#entryAmount"),
    entryNote: $("#entryNote"),
    entryId: $("#entryId"),

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

  function entriesForMonth(monthKey) {
    return store.entries
      .filter((e) => monthKeyFromIsoDate(e.date) === monthKey)
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }

  function totalsForMonth(monthKey) {
    const totals = { income: 0, outgoing: 0, investment: 0, other: 0 };
    for (const e of store.entries) {
      if (monthKeyFromIsoDate(e.date) !== monthKey) continue;
      const cat = categoryById(e.categoryId);
      if (!cat) continue;
      totals[cat.type] += e.amount;
    }
    return totals;
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
  }

  function renderKPIs() {
    const t = totalsForMonth(selectedMonth);
    const net = t.income - t.outgoing - t.investment - t.other;

    els.kpiIncome.textContent = fmtGBP.format(t.income);
    els.kpiOutgoings.textContent = fmtGBP.format(t.outgoing);
    els.kpiInvestments.textContent = fmtGBP.format(t.investment);
    els.kpiNet.textContent = fmtGBP.format(net);

    const prevMonth = shiftMonth(selectedMonth, -1);
    const prev = totalsForMonth(prevMonth);

    els.kpiIncomeHint.textContent = monthOverMonth(t.income, prev.income, "vs last month");
    els.kpiOutgoingsHint.textContent = monthOverMonth(t.outgoing, prev.outgoing, "vs last month");
    els.kpiInvestmentsHint.textContent = monthOverMonth(t.investment, prev.investment, "vs last month");

    if (net >= 0) {
      els.kpiNetHint.textContent = "You're in the black this month";
    } else {
      els.kpiNetHint.textContent = "Spending exceeds income this month";
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
      if (monthKeyFromIsoDate(e.date) !== selectedMonth) continue;
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
            <td>${escapeHtml(formatDateShort(e.date))}</td>
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

    // Filter dropdown stays static (typed filter), nothing to do.

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
            <button type="button" class="icon-btn icon-btn--danger" data-cat-del="${c.id}" aria-label="Delete category ${escapeHtml(c.name)}">
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
                  d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-9 0 1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/>
              </svg>
            </button>
          </li>`);
      }
    }
    els.categoryList.innerHTML = items.join("");
  }

  function renderTrendChart() {
    if (!els.trendCanvas || typeof Chart === "undefined") return;

    const months = trailingMonths(12);
    const labels = months.map(formatMonthShort);

    const incomeData = [];
    const outgoingData = [];
    const investmentData = [];
    const netData = [];

    for (const m of months) {
      const t = totalsForMonth(m);
      incomeData.push(t.income);
      outgoingData.push(t.outgoing);
      investmentData.push(t.investment);
      netData.push(t.income - t.outgoing - t.investment - t.other);
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
          type: "line",
          label: "Net",
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
      const btn = e.target.closest("button[data-cat-del]");
      if (!btn) return;
      deleteCategory(btn.getAttribute("data-cat-del"));
    });

    els.exportBtn.addEventListener("click", exportData);
    els.importBtn.addEventListener("click", () => els.importFile.click());
    els.importFile.addEventListener("change", importData);
    els.resetBtn.addEventListener("click", resetData);

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && els.entryDialog.open) closeEntryDialog();
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
      els.entryDate.value = e.date;
      els.entryCategory.value = e.categoryId;
      els.entryAmount.value = String(e.amount);
      els.entryNote.value = e.note || "";
    } else {
      els.entryDialogTitle.textContent = "Add entry";
      els.entryId.value = "";
      // Default to first day of selected month if it's not the current month;
      // otherwise today's date.
      const todayKey = monthKeyFromDate(new Date());
      els.entryDate.value =
        selectedMonth === todayKey ? todayIso() : firstOfMonthIso(selectedMonth);
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
    if (els.entryDialog.open) els.entryDialog.close();
    else els.entryDialog.removeAttribute("open");
  }

  function saveEntryFromForm() {
    const id = els.entryId.value || uid();
    const date = els.entryDate.value;
    const categoryId = els.entryCategory.value;
    const amount = parseFloat(els.entryAmount.value);
    const note = (els.entryNote.value || "").trim();

    if (!date || !categoryId || !Number.isFinite(amount) || amount < 0) {
      toast("Please fill in date, category and a valid amount.");
      return;
    }

    const existing = store.entries.find((e) => e.id === id);
    if (existing) {
      existing.date = date;
      existing.categoryId = categoryId;
      existing.amount = amount;
      existing.note = note;
    } else {
      store.entries.push({ id, date, categoryId, amount, note });
    }
    saveStore(store);

    // If the entry's month differs from the selected month, jump to it
    const entryMonth = monthKeyFromIsoDate(date);
    if (entryMonth !== selectedMonth) selectedMonth = entryMonth;

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
        store = {
          schemaVersion: SCHEMA_VERSION,
          categories: parsed.categories,
          entries: parsed.entries,
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
    if (!confirm("Reset everything? All categories and entries will be deleted.")) return;
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
