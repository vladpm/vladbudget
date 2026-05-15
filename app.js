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
  const SCHEMA_VERSION = 5;

  /** @typedef {{id:string,name:string,type:'income'|'outgoing'|'investment'|'savings'|'other'}} Category */
  /** @typedef {{id:string,month:string,categoryId:string,amount:number,note:string,recurring?:boolean,endMonth?:string|null}} Entry */
  /** @typedef {{id:string,name:string}} Card */
  /** @typedef {{cardId:string,month:string,amount:number}} CardBalance */
  /** @typedef {{month:string,amount:number}} BankBalance */
  /** @typedef {{schemaVersion:number,categories:Category[],entries:Entry[],cards:Card[],cardBalances:CardBalance[],bankBalances:BankBalance[]}} Store */

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
    { name: "Emergency fund", type: "savings" },
    { name: "Holiday fund", type: "savings" },
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
    savings: "Savings",
    other: "Other",
  };

  const TYPE_COLOR = {
    income: "#1d8e6e",
    outgoing: "#ea2261",
    investment: "#00a4a6",
    savings: "#ed8e3a",
    other: "#64748d",
  };

  const CARDS_COLOR = "#f96bee";

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
    if (!Array.isArray(s.bankBalances)) {
      s.bankBalances = [];
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
    // v3 → v4: add `recurring` + `endMonth` defaults
    for (const e of s.entries) {
      if (typeof e.recurring !== "boolean") {
        e.recurring = false;
        changed = true;
      }
      if (!Object.prototype.hasOwnProperty.call(e, "endMonth")) {
        e.endMonth = null;
        changed = true;
      }
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
      bankBalances: [],
    };
    saveStore(store);
    return store;
  }

  /** @param {Store} store */
  function saveStore(store) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    queueCloudPush();
  }

  function uid() {
    return (
      Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
    );
  }

  // -----------------------------------------------------------
  // Cloud sync (Supabase)
  // -----------------------------------------------------------
  const cfg = (typeof window !== "undefined" && window.BUDGET_CONFIG) || {};
  const CLOUD_ENABLED = !!(
    cfg.supabaseUrl &&
    cfg.supabaseAnonKey &&
    typeof window.supabase !== "undefined"
  );
  /** @type {ReturnType<typeof window.supabase.createClient>|null} */
  let supa = null;
  /** @type {{user:{id:string,email?:string}}|null} */
  let session = null;
  let cloudPushTimer = null;
  let cloudPushInFlight = false;
  let cloudPushDirty = false;
  let lastCloudUpdatedAt = null;
  let realtimeChannel = null;

  if (CLOUD_ENABLED) {
    supa = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }

  function setSyncStatus(state, label, title) {
    const el = els && els.syncStatus;
    if (!el) return;
    if (!CLOUD_ENABLED) {
      el.hidden = true;
      return;
    }
    el.hidden = !label;
    el.dataset.state = state;
    el.textContent = label || "";
    if (title) el.title = title;
  }

  function queueCloudPush() {
    if (!CLOUD_ENABLED || !session) return;
    cloudPushDirty = true;
    if (cloudPushTimer) clearTimeout(cloudPushTimer);
    cloudPushTimer = setTimeout(flushCloudPush, 800);
    setSyncStatus("pending", "Saving…");
  }

  async function flushCloudPush() {
    if (!CLOUD_ENABLED || !session || !cloudPushDirty) return;
    if (cloudPushInFlight) {
      cloudPushTimer = setTimeout(flushCloudPush, 400);
      return;
    }
    cloudPushInFlight = true;
    cloudPushDirty = false;
    setSyncStatus("pending", "Saving…");
    try {
      const { data, error } = await supa
        .from("budgets")
        .upsert(
          { user_id: session.user.id, data: store },
          { onConflict: "user_id" }
        )
        .select("updated_at")
        .single();
      if (error) throw error;
      lastCloudUpdatedAt = data && data.updated_at;
      setSyncStatus(
        "ok",
        "Synced",
        `Synced · ${session.user.email || "signed in"}`
      );
    } catch (err) {
      console.error("[budget] cloud push failed", err);
      cloudPushDirty = true;
      setSyncStatus(
        "error",
        "Offline",
        "Couldn’t reach the cloud. Will retry on next change."
      );
    } finally {
      cloudPushInFlight = false;
    }
  }

  async function pullFromCloud(opts) {
    if (!CLOUD_ENABLED || !session) return;
    const force = opts && opts.force;
    setSyncStatus("pending", "Loading…");
    try {
      const { data, error } = await supa
        .from("budgets")
        .select("data, updated_at")
        .eq("user_id", session.user.id)
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        // No row yet — push current local store as initial cloud copy.
        cloudPushDirty = true;
        await flushCloudPush();
        setSyncStatus("ok", "Synced");
        return;
      }
      const remote = data.data || {};
      const remoteHasContent =
        (Array.isArray(remote.entries) && remote.entries.length > 0) ||
        (Array.isArray(remote.cards) && remote.cards.length > 0) ||
        (Array.isArray(remote.cardBalances) && remote.cardBalances.length > 0);
      const localIsEmpty =
        store.entries.length === 0 && store.cardBalances.length === 0;

      if (force || remoteHasContent || localIsEmpty) {
        store = migrate(remote);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
        render();
      } else {
        // Local has content but remote is empty — push local up.
        cloudPushDirty = true;
        await flushCloudPush();
      }
      lastCloudUpdatedAt = data.updated_at;
      setSyncStatus(
        "ok",
        "Synced",
        `Synced · ${session.user.email || "signed in"}`
      );
    } catch (err) {
      console.error("[budget] cloud pull failed", err);
      setSyncStatus("error", "Offline", "Working from local copy.");
    }
  }

  function subscribeRealtime() {
    if (!CLOUD_ENABLED || !session || realtimeChannel) return;
    try {
      realtimeChannel = supa
        .channel("budget-" + session.user.id)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "budgets",
            filter: `user_id=eq.${session.user.id}`,
          },
          (payload) => {
            const newUpdatedAt =
              payload && payload.new && payload.new.updated_at;
            if (newUpdatedAt && newUpdatedAt === lastCloudUpdatedAt) return;
            if (cloudPushInFlight || cloudPushDirty) return;
            pullFromCloud({ force: true });
          }
        )
        .subscribe();
    } catch (err) {
      console.warn("[budget] realtime subscribe failed", err);
    }
  }

  function unsubscribeRealtime() {
    if (realtimeChannel && supa) {
      supa.removeChannel(realtimeChannel);
      realtimeChannel = null;
    }
  }

  async function ensureSession() {
    if (!CLOUD_ENABLED) return null;
    const { data } = await supa.auth.getSession();
    session = data && data.session ? data.session : null;
    return session;
  }

  let pendingOtpEmail = null;

  async function sendOtpEmail(email) {
    if (!CLOUD_ENABLED) return { error: new Error("Cloud sync not configured") };
    // No emailRedirectTo → Supabase sends a 6-digit code instead of a magic link.
    return supa.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
    });
  }

  async function verifyOtpCode(email, token) {
    if (!CLOUD_ENABLED) return { error: new Error("Cloud sync not configured") };
    return supa.auth.verifyOtp({ email, token, type: "email" });
  }

  async function signOut() {
    if (!CLOUD_ENABLED) return;
    unsubscribeRealtime();
    await flushCloudPush();
    await supa.auth.signOut();
    session = null;
    setSyncStatus("off", "Sign in");
    if (els.signOutBtn) els.signOutBtn.hidden = true;
    updateSyncHint();
    openAuthDialog("You're signed out. Sign in to keep syncing across devices.");
  }

  function updateSyncHint() {
    if (!els.syncHint) return;
    if (!CLOUD_ENABLED) {
      els.syncHint.textContent =
        "Cloud sync isn’t configured — your data lives in this browser only. See the README to enable cross-device sync.";
      return;
    }
    if (session) {
      els.syncHint.textContent = `Signed in as ${session.user.email || "—"} · changes auto-sync across your devices.`;
    } else {
      els.syncHint.textContent =
        "Cloud sync is configured but you're signed out. Local changes won’t sync until you sign in.";
    }
  }

  function openAuthDialog(message) {
    if (!els.authDialog) return;
    if (message && els.authStatus) {
      els.authStatus.textContent = message;
      els.authStatus.hidden = false;
      els.authStatus.dataset.state = "info";
    }
    if (typeof els.authDialog.showModal === "function") {
      els.authDialog.showModal();
    } else {
      els.authDialog.setAttribute("open", "");
    }
  }

  function closeAuthDialog() {
    closeDialog(els.authDialog);
  }

  async function handleAuthFormSubmit() {
    const codeMode = !!els.authCodeField && !els.authCodeField.hidden;

    if (!codeMode) {
      const email = (els.authEmail.value || "").trim();
      if (!email) return;
      els.authSendBtn.disabled = true;
      els.authStatus.hidden = false;
      els.authStatus.dataset.state = "info";
      els.authStatus.textContent = "Sending code…";
      const { error } = await sendOtpEmail(email);
      els.authSendBtn.disabled = false;
      if (error) {
        els.authStatus.dataset.state = "error";
        els.authStatus.textContent = error.message || "Couldn’t send code.";
        return;
      }
      pendingOtpEmail = email;
      els.authEmail.disabled = true;
      els.authCodeField.hidden = false;
      els.authBackLink.hidden = false;
      els.authSendBtn.textContent = "Verify code";
      els.authStatus.dataset.state = "ok";
      els.authStatus.textContent = `We sent a 6-digit code to ${email}. Check your inbox (and spam) and type it below.`;
      setTimeout(() => els.authCode.focus(), 50);
      return;
    }

    // Code-entry mode
    const code = (els.authCode.value || "").trim();
    if (!code || !pendingOtpEmail) return;
    els.authSendBtn.disabled = true;
    els.authStatus.dataset.state = "info";
    els.authStatus.textContent = "Checking code…";
    const { error } = await verifyOtpCode(pendingOtpEmail, code);
    els.authSendBtn.disabled = false;
    if (error) {
      els.authStatus.dataset.state = "error";
      els.authStatus.textContent = error.message || "That code didn’t work. Try again or request a new one.";
      return;
    }
    els.authStatus.dataset.state = "ok";
    els.authStatus.textContent = "Signed in.";
    // onAuthStateChange will handle the dialog close and pull.
  }

  function resetAuthForm() {
    pendingOtpEmail = null;
    if (els.authEmail) {
      els.authEmail.disabled = false;
      els.authEmail.value = "";
    }
    if (els.authCode) els.authCode.value = "";
    if (els.authCodeField) els.authCodeField.hidden = true;
    if (els.authBackLink) els.authBackLink.hidden = true;
    if (els.authSendBtn) {
      els.authSendBtn.textContent = "Send code";
      els.authSendBtn.disabled = false;
    }
    if (els.authStatus) {
      els.authStatus.hidden = true;
      els.authStatus.textContent = "";
    }
  }

  async function initCloud() {
    if (!CLOUD_ENABLED) {
      setSyncStatus("off", "");
      updateSyncHint();
      return;
    }
    setSyncStatus("pending", "Connecting…");

    // Listen for auth state changes (handles magic link landing back here).
    supa.auth.onAuthStateChange(async (_event, sess) => {
      const wasSignedIn = !!session;
      session = sess || null;
      if (session && !wasSignedIn) {
        closeAuthDialog();
        resetAuthForm();
        if (els.signOutBtn) els.signOutBtn.hidden = false;
        updateSyncHint();
        await pullFromCloud();
        subscribeRealtime();
      } else if (!session && wasSignedIn) {
        unsubscribeRealtime();
        if (els.signOutBtn) els.signOutBtn.hidden = true;
        updateSyncHint();
      }
    });

    await ensureSession();
    if (!session) {
      setSyncStatus("off", "Sign in");
      updateSyncHint();
      openAuthDialog();
      return;
    }
    if (els.signOutBtn) els.signOutBtn.hidden = false;
    updateSyncHint();
    await pullFromCloud();
    subscribeRealtime();

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") pullFromCloud();
    });
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
    checkupMonthLabel: $("#checkupMonthLabel"),

    bankOpeningInput: $("#bankOpeningInput"),
    bankOpeningClear: $("#bankOpeningClear"),
    bankOpeningHint: $("#bankOpeningHint"),
    bankProjectionValue: $("#bankProjectionValue"),
    bankProjectionHint: $("#bankProjectionHint"),
    journey: $("#journey"),

    kpiIncome: $("#kpiIncome"),
    kpiOutgoings: $("#kpiOutgoings"),
    kpiInvestments: $("#kpiInvestments"),
    kpiSavings: $("#kpiSavings"),
    kpiCards: $("#kpiCards"),
    kpiNet: $("#kpiNet"),
    kpiIncomeHint: $("#kpiIncomeHint"),
    kpiOutgoingsHint: $("#kpiOutgoingsHint"),
    kpiInvestmentsHint: $("#kpiInvestmentsHint"),
    kpiSavingsHint: $("#kpiSavingsHint"),
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
    entryRecurring: $("#entryRecurring"),
    entryRecurringHint: $("#entryRecurringHint"),
    entryEndMonth: $("#entryEndMonth"),
    entryEndMonthField: $("#entryEndMonthField"),
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

    syncStatus: $("#syncStatus"),
    syncHint: $("#syncHint"),
    signOutBtn: $("#signOutBtn"),

    authDialog: $("#authDialog"),
    authForm: $("#authForm"),
    authEmail: $("#authEmail"),
    authCode: $("#authCode"),
    authCodeField: $("#authCodeField"),
    authBackLink: $("#authBackLink"),
    authStatus: $("#authStatus"),
    authSendBtn: $("#authSendBtn"),

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

  function entryAppliesTo(e, monthKey) {
    if (e.month > monthKey) return false;
    if (e.month === monthKey) return true;
    if (!e.recurring) return false;
    if (e.endMonth && e.endMonth < monthKey) return false;
    return true;
  }

  function entriesForMonth(monthKey) {
    return store.entries
      .filter((e) => entryAppliesTo(e, monthKey))
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
    const totals = { income: 0, outgoing: 0, investment: 0, savings: 0, other: 0 };
    for (const e of store.entries) {
      if (!entryAppliesTo(e, monthKey)) continue;
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
    return t.income - t.outgoing - t.investment - t.savings - t.other - cards;
  }

  // -----------------------------------------------------------
  // Bank balance & projection
  // -----------------------------------------------------------
  function netCashFlowForMonth(monthKey) {
    const t = totalsForMonth(monthKey);
    return t.income - t.outgoing - t.investment - t.savings - t.other;
  }

  function storedBank(monthKey) {
    return store.bankBalances.find((b) => b.month === monthKey) || null;
  }

  /**
   * Opening bank balance for a month.
   *   - source 'manual'    → user typed it for this month
   *   - source 'carryover' → projected from the most recent earlier stored balance
   *   - source 'empty'     → nothing to anchor on yet
   */
  function openingBalanceForMonth(monthKey) {
    const own = storedBank(monthKey);
    if (own) return { amount: own.amount, source: "manual", anchor: monthKey };

    let cursor = monthKey;
    for (let i = 0; i < 36; i++) {
      cursor = shiftMonth(cursor, -1);
      const anchor = storedBank(cursor);
      if (anchor) {
        let amount = anchor.amount;
        let m = cursor;
        // Walk forward from the anchor month, accumulating each month's net cash flow.
        while (m !== monthKey) {
          amount += netCashFlowForMonth(m);
          m = shiftMonth(m, +1);
        }
        return { amount, source: "carryover", anchor: cursor };
      }
    }
    return { amount: 0, source: "empty", anchor: null };
  }

  function projectedClosingForMonth(monthKey) {
    return openingBalanceForMonth(monthKey).amount + netCashFlowForMonth(monthKey);
  }

  function setBankBalance(monthKey, amount) {
    const i = store.bankBalances.findIndex((b) => b.month === monthKey);
    if (amount == null || Number.isNaN(amount)) {
      if (i >= 0) store.bankBalances.splice(i, 1);
    } else if (i >= 0) {
      store.bankBalances[i].amount = amount;
    } else {
      store.bankBalances.push({ month: monthKey, amount });
    }
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
    renderCheckup();
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
    if (els.checkupMonthLabel) els.checkupMonthLabel.textContent = long;
    if (els.cardsMonthLabel) els.cardsMonthLabel.textContent = long;
  }

  // -----------------------------------------------------------
  // Monthly checkup (bank balance + journey)
  // -----------------------------------------------------------
  function renderCheckup() {
    if (!els.bankOpeningInput) return;
    const opening = openingBalanceForMonth(selectedMonth);
    const projected = projectedClosingForMonth(selectedMonth);
    const own = storedBank(selectedMonth);

    // Don't clobber the user's typing while the field is focused.
    if (document.activeElement !== els.bankOpeningInput) {
      els.bankOpeningInput.value =
        opening.source === "empty" ? "" : String(round2(opening.amount));
      els.bankOpeningInput.dataset.source = opening.source;
    }
    els.bankOpeningClear.hidden = !own;

    if (opening.source === "manual") {
      els.bankOpeningHint.textContent = `Confirmed for ${formatMonthLong(selectedMonth)}.`;
    } else if (opening.source === "carryover" && opening.anchor) {
      els.bankOpeningHint.textContent = `Projected from ${formatMonthLong(opening.anchor)} — type to override.`;
    } else {
      els.bankOpeningHint.textContent = "Set what's actually in your bank at the start of the month.";
    }

    els.bankProjectionValue.textContent = fmtGBP.format(projected);
    const flow = netCashFlowForMonth(selectedMonth);
    if (flow === 0 && opening.source === "empty") {
      els.bankProjectionHint.textContent = "Set an opening balance and log entries to see your projection.";
    } else if (flow >= 0) {
      els.bankProjectionHint.textContent = `${fmtGBP.format(flow)} added across the month.`;
    } else {
      els.bankProjectionHint.textContent = `${fmtGBP.format(Math.abs(flow))} drawn down across the month.`;
    }

    renderJourney();
  }

  function renderJourney() {
    if (!els.journey) return;
    const t = totalsForMonth(selectedMonth);
    const opening = openingBalanceForMonth(selectedMonth);
    const projected = projectedClosingForMonth(selectedMonth);
    const cardsCount = store.cards.length;
    const cardEntries = store.cardBalances.filter((b) => b.month === selectedMonth).length;
    const futureFunded = t.investment + t.savings;

    /** @type {{n:number,title:string,detail:string,status:'done'|'partial'|'pending'|'skip',target:string}[]} */
    const steps = [
      {
        n: 1,
        title: "Set opening balance",
        detail:
          opening.source === "manual"
            ? `${fmtGBP.format(opening.amount)} confirmed`
            : opening.source === "carryover"
              ? `${fmtGBP.format(opening.amount)} carrying from ${formatMonthLong(opening.anchor)}`
              : "Tell us what's in your bank",
        status: opening.source === "manual" ? "done" : opening.source === "carryover" ? "partial" : "pending",
        target: "bank",
      },
      {
        n: 2,
        title: "Log income",
        detail: t.income > 0 ? `${fmtGBP.format(t.income)} in` : "Add what came in",
        status: t.income > 0 ? "done" : "pending",
        target: "add-entry",
      },
      {
        n: 3,
        title: "Track outgoings",
        detail: t.outgoing > 0 ? `${fmtGBP.format(t.outgoing)} out` : "Log your spending",
        status: t.outgoing > 0 ? "done" : "pending",
        target: "add-entry",
      },
      {
        n: 4,
        title: "Fund future you",
        detail:
          futureFunded > 0
            ? `${fmtGBP.format(futureFunded)} set aside`
            : "Investments & savings",
        status: futureFunded > 0 ? "done" : "pending",
        target: "add-entry",
      },
      {
        n: 5,
        title: "Update card balances",
        detail:
          cardsCount === 0
            ? "No cards added"
            : `${cardEntries}/${cardsCount} updated`,
        status:
          cardsCount === 0
            ? "skip"
            : cardEntries === cardsCount
              ? "done"
              : cardEntries > 0
                ? "partial"
                : "pending",
        target: "cards",
      },
    ];

    const allDone = steps.every((s) => s.status === "done" || s.status === "skip");
    const finalStep = {
      n: 6,
      title: allDone ? "All caught up" : "You'll land at",
      detail: `${fmtGBP.format(projected)} projected`,
      status: allDone ? "done" : "pending",
      target: "projection",
    };
    steps.push(finalStep);

    els.journey.innerHTML = steps
      .map((s) => `
        <li class="journey-step is-${s.status}" data-step="${s.n}" data-target="${s.target}" tabindex="0" role="button" aria-label="${escapeHtml(s.title)} — ${escapeHtml(s.detail)}">
          <span class="journey-step__num" aria-hidden="true">${s.status === "done" ? "✓" : s.status === "skip" ? "—" : s.n}</span>
          <div class="journey-step__body">
            <p class="journey-step__title">${escapeHtml(s.title)}</p>
            <p class="journey-step__detail">${escapeHtml(s.detail)}</p>
          </div>
        </li>
      `)
      .join("");
  }

  function handleJourneyClick(target) {
    if (target === "bank") {
      els.bankOpeningInput.focus();
      els.bankOpeningInput.select();
    } else if (target === "add-entry") {
      openEntryDialog();
    } else if (target === "cards") {
      document.getElementById("cards").scrollIntoView({ behavior: "smooth", block: "start" });
    } else if (target === "projection") {
      els.bankProjectionValue.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  function commitBankOpeningInput() {
    const raw = (els.bankOpeningInput.value || "").trim();
    if (raw === "") {
      // Empty input on a month that previously had a stored value should clear it.
      const own = storedBank(selectedMonth);
      if (own) {
        setBankBalance(selectedMonth, null);
        saveStore(store);
        renderCheckup();
        renderKPIs();
        renderTrendChart();
      }
      return;
    }
    const amount = parseFloat(raw);
    if (!Number.isFinite(amount)) {
      toast("Please enter a valid amount.");
      renderCheckup();
      return;
    }
    setBankBalance(selectedMonth, round2(amount));
    saveStore(store);
    renderCheckup();
    renderKPIs();
    renderTrendChart();
  }

  function renderKPIs() {
    const t = totalsForMonth(selectedMonth);
    const cards = cardsTotalForMonth(selectedMonth);
    const leftover = t.income - t.outgoing - t.investment - t.savings - t.other - cards;

    els.kpiIncome.textContent = fmtGBP.format(t.income);
    els.kpiOutgoings.textContent = fmtGBP.format(t.outgoing);
    els.kpiInvestments.textContent = fmtGBP.format(t.investment);
    els.kpiSavings.textContent = fmtGBP.format(t.savings);
    els.kpiCards.textContent = fmtGBP.format(cards);
    els.kpiNet.textContent = fmtGBP.format(leftover);

    const prevMonth = shiftMonth(selectedMonth, -1);
    const prev = totalsForMonth(prevMonth);
    const prevCards = cardsTotalForMonth(prevMonth);

    els.kpiIncomeHint.textContent = monthOverMonth(t.income, prev.income, "vs last month");
    els.kpiOutgoingsHint.textContent = monthOverMonth(t.outgoing, prev.outgoing, "vs last month");
    els.kpiInvestmentsHint.textContent = monthOverMonth(t.investment, prev.investment, "vs last month");
    els.kpiSavingsHint.textContent = monthOverMonth(t.savings, prev.savings, "vs last month");

    if (store.cards.length === 0) {
      els.kpiCardsHint.textContent = "No cards added";
    } else {
      els.kpiCardsHint.textContent = monthOverMonth(cards, prevCards, "vs last month");
    }

    if (
      t.income === 0 && cards === 0 &&
      t.outgoing === 0 && t.investment === 0 && t.savings === 0 && t.other === 0
    ) {
      els.kpiNetHint.textContent = "After outgoings, investments, savings & card balances";
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
      if (!entryAppliesTo(e, selectedMonth)) continue;
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
    // Order: by type (income, outgoing, investment, savings, other), then by total desc
    const typeOrder = ["income", "outgoing", "investment", "savings", "other"];
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
        const isRecurring = !!e.recurring;
        const endHint = isRecurring && e.endMonth
          ? `<span class="recur-until">until ${escapeHtml(formatMonthLong(e.endMonth))}</span>`
          : "";
        const checkboxTitle = isRecurring
          ? `Recurring from ${formatMonthLong(e.month)}${e.endMonth ? " until " + formatMonthLong(e.endMonth) : ""}`
          : "One-off entry — tick to repeat every month";
        return `
          <tr data-id="${e.id}">
            <td>
              <span class="cat-pill" style="color:${color}">
                ${escapeHtml(cat ? cat.name : "Uncategorised")}
              </span>
              <div class="bcard__count">${escapeHtml(cat ? TYPE_LABEL[type] : "")}</div>
            </td>
            <td>${escapeHtml(e.note || "")}</td>
            <td class="col-recur">
              <label class="row-check" title="${escapeHtml(checkboxTitle)}">
                <input type="checkbox" data-act="toggle-recurring" ${isRecurring ? "checked" : ""} aria-label="Recurring" />
                <span class="row-check__box" aria-hidden="true"></span>
              </label>
              ${endHint}
            </td>
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
    for (const t of ["income", "outgoing", "investment", "savings", "other"]) grouped[t] = [];
    for (const c of store.categories) grouped[c.type].push(c);

    const items = [];
    for (const t of ["income", "outgoing", "investment", "savings", "other"]) {
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
    const savingsData = [];
    const cardsData = [];
    const netData = [];

    for (const m of months) {
      const t = totalsForMonth(m);
      const cards = cardsTotalForMonth(m);
      incomeData.push(t.income);
      outgoingData.push(t.outgoing);
      investmentData.push(t.investment);
      savingsData.push(t.savings);
      cardsData.push(cards);
      netData.push(t.income - t.outgoing - t.investment - t.savings - t.other - cards);
    }

    const data = {
      labels,
      datasets: [
        {
          type: "bar",
          label: "Income",
          data: incomeData,
          backgroundColor: "rgba(83, 58, 253, 0.9)",
          borderRadius: 4,
          stack: "flow-pos",
          order: 2,
        },
        {
          type: "bar",
          label: "Outgoings",
          data: outgoingData.map((v) => -v),
          backgroundColor: "rgba(234, 34, 97, 0.9)",
          borderRadius: 4,
          stack: "flow-neg",
          order: 2,
        },
        {
          type: "bar",
          label: "Investments",
          data: investmentData.map((v) => -v),
          backgroundColor: "rgba(0, 164, 166, 0.85)",
          borderRadius: 4,
          stack: "flow-neg",
          order: 2,
        },
        {
          type: "bar",
          label: "Savings",
          data: savingsData.map((v) => -v),
          backgroundColor: "rgba(237, 142, 58, 0.9)",
          borderRadius: 4,
          stack: "flow-neg",
          order: 2,
        },
        {
          type: "bar",
          label: "Card balances",
          data: cardsData.map((v) => -v),
          backgroundColor: "rgba(249, 107, 238, 0.85)",
          borderRadius: 4,
          stack: "flow-neg",
          order: 2,
        },
        {
          type: "line",
          label: "Leftover",
          data: netData,
          borderColor: "#b9b9f9",
          backgroundColor: "rgba(185, 185, 249, 0.12)",
          borderWidth: 2.5,
          tension: 0.32,
          pointRadius: 3,
          pointBackgroundColor: "#b9b9f9",
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
          backgroundColor: "rgba(28, 30, 84, 0.96)",
          titleColor: "#fff",
          bodyColor: "#fff",
          borderColor: "rgba(255,255,255,0.08)",
          borderWidth: 1,
          padding: 12,
          titleFont: { weight: "400", size: 13 },
          bodyFont: { weight: "300", size: 13 },
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

    els.entryMonth.addEventListener("change", () => {
      updateRecurringHint();
      updateEndMonthVisibility();
    });
    els.entryRecurring.addEventListener("change", () => updateEndMonthVisibility());

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

    els.entryTableBody.addEventListener("change", (e) => {
      const cb = e.target.closest('input[data-act="toggle-recurring"]');
      if (!cb) return;
      const tr = cb.closest("tr");
      const id = tr && tr.dataset.id;
      if (!id) return;
      toggleRecurringInline(id, cb);
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

    // Bank balance input
    if (els.bankOpeningInput) {
      els.bankOpeningInput.addEventListener("change", commitBankOpeningInput);
      els.bankOpeningInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          els.bankOpeningInput.blur();
        }
      });
    }
    if (els.bankOpeningClear) {
      els.bankOpeningClear.addEventListener("click", () => {
        setBankBalance(selectedMonth, null);
        saveStore(store);
        renderCheckup();
        renderKPIs();
        renderTrendChart();
        toast("Reverted to carry-over");
      });
    }

    // Journey clicks (delegation)
    if (els.journey) {
      els.journey.addEventListener("click", (e) => {
        const step = e.target.closest("[data-target]");
        if (!step) return;
        handleJourneyClick(step.dataset.target);
      });
      els.journey.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        const step = e.target.closest("[data-target]");
        if (!step) return;
        e.preventDefault();
        handleJourneyClick(step.dataset.target);
      });
    }

    els.exportBtn.addEventListener("click", exportData);
    els.importBtn.addEventListener("click", () => els.importFile.click());
    els.importFile.addEventListener("change", importData);
    els.resetBtn.addEventListener("click", resetData);

    if (els.signOutBtn) {
      els.signOutBtn.addEventListener("click", () => {
        if (confirm("Sign out? Local data stays in this browser.")) signOut();
      });
    }
    if (els.authForm) {
      els.authForm.addEventListener("submit", (e) => {
        e.preventDefault();
        handleAuthFormSubmit();
      });
    }
    if (els.authBackLink) {
      els.authBackLink.addEventListener("click", (e) => {
        e.preventDefault();
        resetAuthForm();
        if (els.authEmail) els.authEmail.focus();
      });
    }

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
      els.entryRecurring.checked = !!e.recurring;
      els.entryEndMonth.value = e.endMonth || "";
    } else {
      els.entryDialogTitle.textContent = "Add entry";
      els.entryId.value = "";
      els.entryMonth.value = selectedMonth;
      els.entryCategory.selectedIndex = 0;
      els.entryAmount.value = "";
      els.entryNote.value = "";
      els.entryRecurring.checked = false;
      els.entryEndMonth.value = "";
    }
    updateRecurringHint();
    updateEndMonthVisibility();

    if (typeof els.entryDialog.showModal === "function") {
      els.entryDialog.showModal();
    } else {
      els.entryDialog.setAttribute("open", "");
    }
    setTimeout(() => els.entryAmount.focus(), 50);
  }

  function updateRecurringHint() {
    if (!els.entryRecurringHint) return;
    const month = els.entryMonth.value;
    if (!month) {
      els.entryRecurringHint.textContent = "Repeats automatically in every month from the start month onward.";
      return;
    }
    els.entryRecurringHint.textContent =
      `Repeats automatically in every month from ${formatMonthLong(month)} onward.`;
  }

  function updateEndMonthVisibility() {
    if (!els.entryEndMonthField) return;
    const on = !!els.entryRecurring.checked;
    els.entryEndMonthField.hidden = !on;
    if (!on) els.entryEndMonth.value = "";
    // Constrain end month ≥ start month
    if (els.entryMonth.value) els.entryEndMonth.min = els.entryMonth.value;
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
    const recurring = !!els.entryRecurring.checked;
    const endMonthRaw = (els.entryEndMonth.value || "").trim();
    const endMonth = recurring && endMonthRaw ? endMonthRaw : null;

    if (!month || !/^\d{4}-\d{2}$/.test(month) || !categoryId || !Number.isFinite(amount) || amount < 0) {
      toast("Please fill in month, category and a valid amount.");
      return;
    }
    if (endMonth && !/^\d{4}-\d{2}$/.test(endMonth)) {
      toast("End month doesn't look right.");
      return;
    }
    if (endMonth && endMonth < month) {
      toast("End month can't be before the start month.");
      return;
    }

    const existing = store.entries.find((e) => e.id === id);
    if (existing) {
      existing.month = month;
      existing.categoryId = categoryId;
      existing.amount = amount;
      existing.note = note;
      existing.recurring = recurring;
      existing.endMonth = endMonth;
    } else {
      store.entries.push({ id, month, categoryId, amount, note, recurring, endMonth });
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
    const msg = e.recurring
      ? "Delete this recurring entry? It will be removed from every month."
      : "Delete this entry?";
    if (!confirm(msg)) return;
    store.entries = store.entries.filter((x) => x.id !== id);
    saveStore(store);
    render();
    toast("Entry deleted");
  }

  function toggleRecurringInline(id, checkbox) {
    const e = store.entries.find((x) => x.id === id);
    if (!e) return;
    const wantRecurring = !!checkbox.checked;

    if (wantRecurring) {
      // Turning recurring ON. If we're viewing a future month, anchor the
      // start month to the entry's existing month (which is its origin).
      e.recurring = true;
      // Clear any stale endMonth that's now in the past.
      if (e.endMonth && e.endMonth < e.month) e.endMonth = null;
      saveStore(store);
      render();
      toast(`Repeating from ${formatMonthLong(e.month)} onward`);
      return;
    }

    // Turning recurring OFF.
    if (selectedMonth === e.month) {
      // Same month as the start — simple toggle: it becomes a one-off.
      e.recurring = false;
      e.endMonth = null;
      saveStore(store);
      render();
      toast("No longer recurring");
      return;
    }

    // We're viewing a later month. Two reasonable interpretations:
    //   1. Stop from this month onward (keeps past months).
    //   2. Remove the recurring template entirely (wipes every month).
    // Default behaviour: stop from this month onward (least destructive).
    e.endMonth = shiftMonth(selectedMonth, -1);
    // Recurring stays true so past months still show it.
    saveStore(store);
    render();
    toast(`Stopped from ${formatMonthLong(selectedMonth)} onward`);
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
          const cloned = Object.assign({}, e);
          if (!cloned.month) {
            if (typeof cloned.date === "string" && cloned.date.length >= 7) {
              cloned.month = cloned.date.slice(0, 7);
            } else {
              cloned.month = monthKeyFromDate(new Date());
            }
          }
          delete cloned.date;
          if (typeof cloned.recurring !== "boolean") cloned.recurring = false;
          if (!Object.prototype.hasOwnProperty.call(cloned, "endMonth")) cloned.endMonth = null;
          return cloned;
        });
        store = {
          schemaVersion: SCHEMA_VERSION,
          categories: parsed.categories,
          entries: importedEntries,
          cards: Array.isArray(parsed.cards) ? parsed.cards : [],
          cardBalances: Array.isArray(parsed.cardBalances) ? parsed.cardBalances : [],
          bankBalances: Array.isArray(parsed.bankBalances) ? parsed.bankBalances : [],
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
    if (!confirm("Reset everything? All categories, cards, entries, balances and bank values will be deleted.")) return;
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
    initCloud();
  });
})();
