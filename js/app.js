import * as db from "./db.js";
import { getSession, onAuthStateChange, signInAnonymously, signInWithGoogle, signOut } from "./auth.js";

(function(){
  "use strict";
  var EMOJI_OPTS = ["🎯","💼","🏃","🎨","📚","🏠","🧘","✨","💡","❤️"];
  var CADENCE_OPTS = ["Daily","Weekdays","3x / week","Weekly"];
  var CATEGORY_OPTS = ["Potential client","Referral","Network","Friend / Family","Colleague","Other"];
  var CATEGORY_STYLE = {
    "Potential client": "background:var(--accent-soft);color:var(--accent);",
    "Referral": "background:var(--amber-soft);color:var(--amber);",
    "Network": "background:color-mix(in srgb, var(--chart-b) 16%, transparent);color:var(--chart-b);",
    "Friend / Family": "background:var(--danger-soft);color:var(--danger);",
    "Colleague": "background:var(--surface-2);color:var(--ink-soft);",
    "Other": "background:var(--surface-2);color:var(--ink-faint);"
  };

  var state = null;
  var currentUser = null;
  var sampleApi = null;
  var sampleUnavailable = false;
  var uiState = { wizardOpen:false, wizardEditId:null, wizardSteps:[], wizardIdx:0, wizardDraft:null, wizardError:"", wizardBusy:null, expandedContact:null, syncError:"" };

  function uid(){ return (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : (Math.random().toString(36).slice(2,10) + Date.now().toString(36).slice(-4)); }
  function reportSyncError(err){ console.error(err); uiState.syncError = "Couldn't save that change — check your connection and try again."; liveRender(); }
  function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]; }); }
  function todayISO(){ return new Date().toISOString().slice(0,10); }
  function shiftISO(dateStr, delta){ var d = new Date(dateStr + "T00:00:00"); d.setDate(d.getDate() + delta); return d.toISOString().slice(0,10); }
  function clamp(n,min,max){ return Math.max(min, Math.min(max, n)); }

  function defaultState(){ return { goals: [], createdAt: todayISO() }; }

  function computeStreak(log){
    log = log || {};
    var cursor = todayISO();
    if (!log[cursor]) cursor = shiftISO(cursor, -1);
    var streak = 0;
    while (log[cursor]) { streak++; cursor = shiftISO(cursor, -1); }
    return streak;
  }

  function fmtDate(iso){
    if (!iso) return "no target date";
    var d = new Date(iso + "T00:00:00");
    if (isNaN(d.getTime())) return "no target date";
    var opts = { month:"short", day:"numeric", year:"numeric" };
    return d.toLocaleDateString(undefined, opts);
  }
  function daysLeftLabel(iso){
    if (!iso) return "";
    var d = new Date(iso + "T00:00:00");
    if (isNaN(d.getTime())) return "";
    var diff = Math.ceil((d.getTime() - new Date(todayISO()+"T00:00:00").getTime()) / 86400000);
    if (diff > 0) return diff + " day" + (diff===1?"":"s") + " left";
    if (diff === 0) return "today";
    return Math.abs(diff) + " day" + (Math.abs(diff)===1?"":"s") + " past";
  }

  // ---------- mutation helpers ----------
  function findGoal(id){ return state.goals.find(function(g){ return g.id === id; }); }

  function toggleHabitToday(goalId, habitId){
    var g = findGoal(goalId); if (!g) return;
    var h = g.habits.find(function(x){ return x.id === habitId; }); if (!h) return;
    var t = todayISO();
    if (h.log[t]) delete h.log[t]; else h.log[t] = true;
    h.best = Math.max(h.best || 0, computeStreak(h.log));
    persist();
    db.updateHabit(habitId, { log: h.log, best: h.best }).catch(reportSyncError);
  }
  function removeHabit(goalId, habitId){
    var g = findGoal(goalId); if (!g) return;
    g.habits = g.habits.filter(function(h){ return h.id !== habitId; });
    persist();
    db.deleteHabit(habitId).catch(reportSyncError);
  }
  function updateMetric(goalId, metricId, value){
    var g = findGoal(goalId); if (!g) return;
    var m = g.metrics.find(function(x){ return x.id === metricId; }); if (!m) return;
    var v = parseFloat(value);
    m.current = isNaN(v) ? 0 : v;
    persist();
    db.updateMetric(metricId, { current: m.current }).catch(reportSyncError);
  }
  function removeMetric(goalId, metricId){
    var g = findGoal(goalId); if (!g) return;
    g.metrics = g.metrics.filter(function(m){ return m.id !== metricId; });
    persist();
    db.deleteMetric(metricId).catch(reportSyncError);
  }
  function toggleMilestone(goalId, msId){
    var g = findGoal(goalId); if (!g) return;
    var m = g.milestones.find(function(x){ return x.id === msId; }); if (!m) return;
    m.done = !m.done;
    persist();
    db.updateMilestone(msId, { done: m.done }).catch(reportSyncError);
  }
  function removeMilestone(goalId, msId){
    var g = findGoal(goalId); if (!g) return;
    g.milestones = g.milestones.filter(function(m){ return m.id !== msId; });
    persist();
    db.deleteMilestone(msId).catch(reportSyncError);
  }
  function deleteGoal(goalId){
    var g = findGoal(goalId); if (!g) return;
    if (!window.confirm('Delete "' + g.name + '" and all its progress? This can\'t be undone.')) return;
    state.goals = state.goals.filter(function(x){ return x.id !== goalId; });
    persist();
    db.deleteGoal(goalId).catch(reportSyncError);
  }
  function addHabitInline(goalId, name, cadence){
    name = (name || "").trim(); if (!name) return;
    var g = findGoal(goalId); if (!g) return;
    var habit = { id: uid(), name: name, cadence: cadence || "Daily", log:{}, best:0 };
    g.habits.push(habit);
    persist();
    db.insertHabit(currentUser.id, goalId, habit).catch(reportSyncError);
  }
  function addMilestoneInline(goalId, name){
    name = (name || "").trim(); if (!name) return;
    var g = findGoal(goalId); if (!g) return;
    var ms = { id: uid(), name: name, done:false };
    g.milestones.push(ms);
    persist();
    db.insertMilestone(currentUser.id, goalId, ms).catch(reportSyncError);
  }
  function addMetricInline(goalId, name, target, unit){
    name = (name || "").trim(); if (!name) return;
    var g = findGoal(goalId); if (!g) return;
    var t = parseFloat(target); if (isNaN(t)) t = 0;
    var metric = { id: uid(), name: name, unit: (unit||"").trim(), target: t, current: 0 };
    g.metrics.push(metric);
    persist();
    db.insertMetric(currentUser.id, goalId, metric).catch(reportSyncError);
  }
  function findContact(goalId, contactId){
    var g = findGoal(goalId); if (!g) return null;
    var c = g.contacts.find(function(x){ return x.id === contactId; });
    return c ? { g: g, c: c } : null;
  }
  function addContactInline(goalId, name, category){
    name = (name || "").trim(); if (!name) return;
    var g = findGoal(goalId); if (!g) return;
    var contact = { id: uid(), name: name, category: CATEGORY_OPTS.indexOf(category) >= 0 ? category : "Network", notes: "", reachedOutAt: null, meetingAt: null, createdAt: todayISO() };
    g.contacts.push(contact);
    persist();
    db.insertContact(currentUser.id, goalId, contact).catch(reportSyncError);
  }
  function removeContact(goalId, contactId){
    var g = findGoal(goalId); if (!g) return;
    g.contacts = g.contacts.filter(function(c){ return c.id !== contactId; });
    if (uiState.expandedContact === contactId) uiState.expandedContact = null;
    persist();
    db.deleteContact(contactId).catch(reportSyncError);
  }
  function toggleContactReached(goalId, contactId){
    var found = findContact(goalId, contactId); if (!found) return;
    found.c.reachedOutAt = found.c.reachedOutAt ? null : todayISO();
    persist();
    db.updateContact(contactId, { reachedOutAt: found.c.reachedOutAt }).catch(reportSyncError);
  }
  function toggleContactMeeting(goalId, contactId){
    var found = findContact(goalId, contactId); if (!found) return;
    found.c.meetingAt = found.c.meetingAt ? null : todayISO();
    if (found.c.meetingAt && !found.c.reachedOutAt) found.c.reachedOutAt = todayISO();
    persist();
    db.updateContact(contactId, { reachedOutAt: found.c.reachedOutAt, meetingAt: found.c.meetingAt }).catch(reportSyncError);
  }
  function updateContactField(goalId, contactId, field, value){
    var found = findContact(goalId, contactId); if (!found) return;
    if (field === "category" && CATEGORY_OPTS.indexOf(value) >= 0) found.c.category = value;
    if (field === "notes") found.c.notes = value;
    persist();
    db.updateContact(contactId, field === "category" ? { category: found.c.category } : { notes: found.c.notes }).catch(reportSyncError);
  }
  function toggleContactExpand(contactId){
    uiState.expandedContact = uiState.expandedContact === contactId ? null : contactId;
    liveRender();
  }

  // ---------- wizard ----------
  function blankDraft(){
    return {
      emoji: "🎯", name: "", targetDate: "", why: "", identity: "",
      metrics: [{ id: uid(), name:"", unit:"", target:"" }],
      habits: [{ id: uid(), name:"", cadence:"Daily" }],
      milestones: [{ id: uid(), name:"" }]
    };
  }
  function draftFromGoal(g){
    return { emoji: g.emoji, name: g.name, targetDate: g.targetDate || "", why: g.why || "", identity: g.identity || "" };
  }
  function openWizard(editId){
    if (editId) {
      var g = findGoal(editId);
      if (!g) return;
      uiState.wizardDraft = draftFromGoal(g);
      uiState.wizardSteps = ["basics","vision"];
      uiState.wizardEditId = editId;
    } else {
      uiState.wizardDraft = blankDraft();
      uiState.wizardSteps = ["basics","vision","metrics","habits","milestones"];
      uiState.wizardEditId = null;
    }
    uiState.wizardIdx = 0;
    uiState.wizardOpen = true;
    uiState.wizardError = "";
    liveRender();
  }
  function closeWizard(){
    uiState.wizardOpen = false;
    uiState.wizardDraft = null;
    uiState.wizardEditId = null;
    uiState.wizardError = "";
    liveRender();
  }
  function wizardNext(){
    var draft = uiState.wizardDraft;
    if (uiState.wizardSteps[uiState.wizardIdx] === "basics" && !(draft.name || "").trim()) {
      uiState.wizardError = "Give this goal a name to continue.";
      liveRender();
      return;
    }
    uiState.wizardError = "";
    uiState.wizardIdx = Math.min(uiState.wizardIdx + 1, uiState.wizardSteps.length - 1);
    liveRender();
  }
  function wizardBack(){
    uiState.wizardError = "";
    uiState.wizardIdx = Math.max(uiState.wizardIdx - 1, 0);
    liveRender();
  }
  function wizardSave(){
    var draft = uiState.wizardDraft;
    var name = (draft.name || "").trim() || "Untitled goal";
    if (uiState.wizardEditId) {
      var g = findGoal(uiState.wizardEditId);
      if (g) {
        g.emoji = draft.emoji || "🎯";
        g.name = name;
        g.targetDate = draft.targetDate || "";
        g.why = (draft.why || "").trim();
        g.identity = (draft.identity || "").trim();
        db.updateGoal(g.id, { emoji: g.emoji, name: g.name, targetDate: g.targetDate, why: g.why, identity: g.identity }).catch(reportSyncError);
      }
    } else {
      var metrics = (draft.metrics || []).filter(function(m){ return (m.name||"").trim(); }).map(function(m){
        var t = parseFloat(m.target); if (isNaN(t)) t = 0;
        return { id: m.id || uid(), name: m.name.trim(), unit: (m.unit||"").trim(), target: t, current: 0 };
      });
      var habits = (draft.habits || []).filter(function(h){ return (h.name||"").trim(); }).map(function(h){
        return { id: h.id || uid(), name: h.name.trim(), cadence: h.cadence || "Daily", log:{}, best:0 };
      });
      var milestones = (draft.milestones || []).filter(function(m){ return (m.name||"").trim(); }).map(function(m){
        return { id: m.id || uid(), name: m.name.trim(), done:false };
      });
      var newGoal = {
        id: uid(), emoji: draft.emoji || "🎯", name: name, targetDate: draft.targetDate || "",
        why: (draft.why||"").trim(), identity: (draft.identity||"").trim(),
        metrics: metrics, habits: habits, milestones: milestones, contacts: [], createdAt: todayISO()
      };
      state.goals.push(newGoal);
      saveNewGoalToDb(newGoal).catch(reportSyncError);
    }
    uiState.wizardOpen = false;
    uiState.wizardDraft = null;
    uiState.wizardEditId = null;
    persist();
  }
  async function saveNewGoalToDb(goal){
    await db.insertGoal(currentUser.id, goal);
    await Promise.all([].concat(
      goal.metrics.map(function(m){ return db.insertMetric(currentUser.id, goal.id, m); }),
      goal.habits.map(function(h){ return db.insertHabit(currentUser.id, goal.id, h); }),
      goal.milestones.map(function(m){ return db.insertMilestone(currentUser.id, goal.id, m); })
    ));
  }
  function wizardAddRow(list){
    var draft = uiState.wizardDraft;
    if (list === "metrics") draft.metrics.push({ id: uid(), name:"", unit:"", target:"" });
    if (list === "habits") draft.habits.push({ id: uid(), name:"", cadence:"Daily" });
    if (list === "milestones") draft.milestones.push({ id: uid(), name:"" });
    liveRender();
  }
  function wizardRemoveRow(list, idx){
    var draft = uiState.wizardDraft;
    draft[list].splice(idx, 1);
    if (draft[list].length === 0) {
      if (list === "metrics") draft.metrics.push({ id: uid(), name:"", unit:"", target:"" });
      if (list === "habits") draft.habits.push({ id: uid(), name:"", cadence:"Daily" });
      if (list === "milestones") draft.milestones.push({ id: uid(), name:"" });
    }
    liveRender();
  }

  // ---------- AI suggestions ----------
  async function ensureSample(){
    if (sampleApi) return sampleApi;
    if (sampleUnavailable) return null;
    try {
      if (window.claude && window.claude.use) sampleApi = await window.claude.use("sample");
    } catch (e) { sampleApi = null; }
    if (!sampleApi) sampleUnavailable = true;
    return sampleApi;
  }
  function goalContext(draft){
    return "Goal: " + draft.name +
      "\nWhy it matters: " + (draft.why || "(not specified)") +
      "\nIdentity they're aiming to become: " + (draft.identity || "(not specified)");
  }
  function applySuggestedRows(list, arr, mapFn){
    if (!Array.isArray(arr) || !arr.length) return false;
    var draft = uiState.wizardDraft;
    draft[list] = draft[list].filter(function(item){ return (item.name || "").trim(); });
    arr.slice(0, 6).forEach(function(x){
      if (x && x.name) draft[list].push(mapFn(x));
    });
    if (draft[list].length === 0) {
      if (list === "metrics") draft.metrics.push({ id: uid(), name:"", unit:"", target:"" });
      if (list === "habits") draft.habits.push({ id: uid(), name:"", cadence:"Daily" });
      if (list === "milestones") draft.milestones.push({ id: uid(), name:"" });
    }
    return true;
  }
  async function wizardSuggest(list){
    if (uiState.wizardBusy) return;
    var api = await ensureSample();
    if (!api) {
      uiState.wizardError = "Suggestions aren't available in this view.";
      liveRender();
      return;
    }
    uiState.wizardBusy = list;
    uiState.wizardError = "";
    liveRender();
    var draft = uiState.wizardDraft;
    try {
      if (list === "identity") {
        var res = await api(goalContext(draft) + "\n\nComplete this sentence with a short, concrete phrase (5-10 words, no surrounding quotes, no trailing period): \"I'm becoming someone who ___\"", { modelTier: "quick" });
        var text = (res && res.text || "").trim().replace(/^["']|["']$/g, "").replace(/\.$/, "");
        if (text) draft.identity = text;
      } else if (list === "metrics") {
        var existingM = draft.metrics.map(function(m){ return m.name; }).filter(Boolean).join(", ") || "none yet";
        var arrM = await api.json(goalContext(draft) + "\nMetrics already listed: " + existingM +
          "\n\nSuggest 4 specific, measurable metrics for tracking progress on this goal over the next 1-2 months. Respond with ONLY a JSON array, no prose, no markdown fences: [{\"name\":\"...\",\"target\":10,\"unit\":\"...\"}] (unit may be an empty string).", { modelTier: "quick" });
        applySuggestedRows("metrics", arrM, function(x){
          var t = parseFloat(x.target);
          return { id: uid(), name: String(x.name || "").slice(0, 60), unit: String(x.unit || "").slice(0, 16), target: isFinite(t) ? t : "" };
        });
      } else if (list === "habits") {
        var existingH = draft.habits.map(function(h){ return h.name; }).filter(Boolean).join(", ") || "none yet";
        var arrH = await api.json(goalContext(draft) + "\nHabits already listed: " + existingH +
          "\n\nSuggest 4 concrete, repeatable habits or actions that would meaningfully move this goal forward. Avoid vague habits like “stay motivated”. cadence must be exactly one of: \"Daily\", \"Weekdays\", \"3x / week\", \"Weekly\". Respond with ONLY a JSON array, no prose, no markdown fences: [{\"name\":\"...\",\"cadence\":\"Daily\"}]", { modelTier: "quick" });
        applySuggestedRows("habits", arrH, function(x){
          return { id: uid(), name: String(x.name || "").slice(0, 80), cadence: CADENCE_OPTS.indexOf(x.cadence) >= 0 ? x.cadence : "Daily" };
        });
      } else if (list === "milestones") {
        var existingMs = draft.milestones.map(function(m){ return m.name; }).filter(Boolean).join(", ") || "none yet";
        var arrMs = await api.json(goalContext(draft) + "\nMilestones already listed: " + existingMs +
          "\n\nSuggest 4 concrete one-time milestones (checkpoints, not ongoing habits) that would mark real progress on this goal within the next couple of months. Respond with ONLY a JSON array, no prose, no markdown fences: [{\"name\":\"...\"}]", { modelTier: "quick" });
        applySuggestedRows("milestones", arrMs, function(x){
          return { id: uid(), name: String(x.name || "").slice(0, 90) };
        });
      }
    } catch (e) {
      uiState.wizardError = "Couldn't get suggestions just now — try again in a moment.";
    }
    uiState.wizardBusy = null;
    liveRender();
  }
  function suggestButton(list, label){
    var busy = uiState.wizardBusy === list;
    return '<button type="button" class="btn btn-ghost" data-action="wizard-suggest" data-list="' + list + '"' + (busy ? ' disabled' : '') + '>' + (busy ? 'Thinking…' : label) + '</button>';
  }

  // ---------- render: pieces ----------
  function renderTopbar(){
    var totalHabits = 0, doneToday = 0, bestStreak = 0;
    var t = todayISO();
    state.goals.forEach(function(g){
      g.habits.forEach(function(h){
        totalHabits++;
        if (h.log[t]) doneToday++;
        bestStreak = Math.max(bestStreak, computeStreak(h.log));
      });
    });
    return (
      '<div class="topbar">' +
        '<div class="brand"><div class="brand-mark">🧭</div><div><h1>Waypoint</h1><div class="tag">Your goals, tracked the way habits actually form</div></div></div>' +
        '<div class="stats">' +
          '<div class="pill">Today <strong class="num">' + doneToday + '/' + totalHabits + '</strong></div>' +
          '<div class="pill">🔥 best streak <strong class="num">' + bestStreak + '</strong></div>' +
          '<div class="pill">Active goals <strong class="num">' + state.goals.length + '</strong></div>' +
          '<button class="btn btn-primary" data-action="open-wizard">+ New goal</button>' +
          (currentUser && currentUser.is_anonymous ? '<div class="pill" title="Sign-in isn\'t set up yet — this data lives in a guest session tied to this browser.">Guest session</div>' : '') +
          (currentUser && !currentUser.is_anonymous ? '<div class="pill" title="' + esc(currentUser.email||"") + '">' + esc((currentUser.email||"").split("@")[0]) + '</div><button class="btn btn-ghost" data-action="sign-out">Sign out</button>' : '') +
        '</div>' +
      '</div>'
    );
  }

  // ---------- dashboard overview: stats, chart, sidebar ----------
  function computeOverviewStats(){
    var t = todayISO();
    var totalHabits = 0, doneToday = 0;
    var metricPcts = [];
    state.goals.forEach(function(g){
      g.habits.forEach(function(h){ totalHabits++; if (h.log[t]) doneToday++; });
      g.metrics.forEach(function(m){ if (m.target > 0) metricPcts.push(clamp((m.current / m.target) * 100, 0, 100)); });
    });
    var habitsPct = totalHabits > 0 ? Math.round((doneToday / totalHabits) * 100) : 0;
    var metricsPct = metricPcts.length ? Math.round(metricPcts.reduce(function(a,b){ return a+b; },0) / metricPcts.length) : 0;
    return { habitsPct: habitsPct, doneToday: doneToday, totalHabits: totalHabits, metricsPct: metricsPct, metricsCount: metricPcts.length };
  }

  function renderOverview(){
    var stats = computeOverviewStats();
    var goalIcons = state.goals.slice(0, 6).map(function(g){
      return '<div class="goal-icon" title="' + esc(g.name) + '">' + g.emoji + '</div>';
    }).join('');
    return (
      '<div class="overview-grid">' +
        '<div class="stat-tile grad-1">' +
          '<div class="stat-tile-top"><div class="stat-tile-label">Habits<br>today</div><div class="stat-tile-icon">✓</div></div>' +
          '<div><div class="stat-tile-value num">' + stats.habitsPct + '%</div><div class="stat-tile-sub">' + stats.doneToday + ' of ' + stats.totalHabits + ' checked off</div></div>' +
        '</div>' +
        '<div class="stat-tile grad-2">' +
          '<div class="stat-tile-top"><div class="stat-tile-label">Metrics<br>progress</div><div class="stat-tile-icon">◔</div></div>' +
          '<div><div class="stat-tile-value num">' + stats.metricsPct + '%</div><div class="stat-tile-sub">avg. across ' + stats.metricsCount + ' metric' + (stats.metricsCount===1?'':'s') + '</div></div>' +
        '</div>' +
        '<div class="goals-card">' +
          '<div class="goals-card-top"><div><div class="goals-card-label">Goals in motion</div><div class="goals-card-sub">' + state.goals.length + ' active</div></div></div>' +
          '<div class="goal-icon-row">' + goalIcons + '<button class="goal-icon-add" data-action="open-wizard" title="Add a goal">+</button></div>' +
        '</div>' +
      '</div>'
    );
  }

  function computeMomentumSeries(days){
    var series = [];
    for (var i = days - 1; i >= 0; i--) {
      var day = shiftISO(todayISO(), -i);
      var total = 0, done = 0;
      state.goals.forEach(function(g){
        g.habits.forEach(function(h){ total++; if (h.log[day]) done++; });
      });
      series.push({ day: day, pct: total > 0 ? (done / total) * 100 : 0 });
    }
    return series;
  }

  function buildSmoothPath(points){
    if (points.length < 2) return "";
    var d = "M " + points[0].x.toFixed(1) + " " + points[0].y.toFixed(1);
    for (var i = 0; i < points.length - 1; i++) {
      var p0 = points[i], p1 = points[i+1];
      var midX = (p0.x + p1.x) / 2;
      d += " C " + midX.toFixed(1) + " " + p0.y.toFixed(1) + " " + midX.toFixed(1) + " " + p1.y.toFixed(1) + " " + p1.x.toFixed(1) + " " + p1.y.toFixed(1);
    }
    return d;
  }

  function renderMomentumChart(){
    var days = 14;
    var series = computeMomentumSeries(days);
    var W = 640, H = 200, padX = 10, padY = 16;
    var points = series.map(function(pt, i){
      var x = padX + (i / (series.length - 1)) * (W - padX * 2);
      var y = padY + (1 - pt.pct / 100) * (H - padY * 2);
      return { x: x, y: y, pct: pt.pct, day: pt.day };
    });
    var linePath = buildSmoothPath(points);
    var areaPath = linePath + " L " + points[points.length-1].x.toFixed(1) + " " + H + " L " + points[0].x.toFixed(1) + " " + H + " Z";
    var todayPt = points[points.length - 1];
    var avg = series.length ? Math.round(series.reduce(function(a,b){ return a+b.pct; },0) / series.length) : 0;
    var bubbleLeft = clamp((todayPt.x / W) * 100, 10, 90);
    var hasAnyHabits = state.goals.some(function(g){ return g.habits.length > 0; });
    return (
      '<div class="chart-card">' +
        '<div class="chart-card-head">' +
          '<div><h2>Momentum</h2><div class="sub">Daily habit completion, last ' + days + ' days</div></div>' +
        '</div>' +
        (hasAnyHabits ?
          ('<div class="chart-wrap">' +
            '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto;display:block;" preserveAspectRatio="none">' +
              '<defs><linearGradient id="momentumFill" x1="0" y1="0" x2="0" y2="1">' +
                '<stop offset="0%" stop-color="var(--chart-a)" stop-opacity="0.28"/>' +
                '<stop offset="100%" stop-color="var(--chart-a)" stop-opacity="0"/>' +
              '</linearGradient></defs>' +
              '<path d="' + areaPath + '" fill="url(#momentumFill)"/>' +
              '<path d="' + linePath + '" fill="none" stroke="var(--chart-a)" stroke-width="3" stroke-linecap="round"/>' +
              '<circle cx="' + todayPt.x.toFixed(1) + '" cy="' + todayPt.y.toFixed(1) + '" r="5" fill="var(--surface)" stroke="var(--chart-a)" stroke-width="3"/>' +
            '</svg>' +
            '<div class="chart-bubble" style="left:' + bubbleLeft.toFixed(0) + '%;top:' + ((todayPt.y / H) * 100).toFixed(0) + '%;">Today <span class="sub2">' + Math.round(todayPt.pct) + '%</span></div>' +
          '</div>' +
          '<div class="chart-legend"><span><span class="legend-dot" style="background:var(--chart-a);"></span>Completion rate</span></div>' +
          '<div class="chart-foot"><span class="big num">' + avg + '%</span><span class="lbl">avg. last ' + days + ' days</span></div>')
        : '<p style="font-size:13px;color:var(--ink-faint);padding:24px 0;">Add a habit to a goal to start seeing your momentum here.</p>') +
      '</div>'
    );
  }

  function collectOpenMilestones(limit){
    var out = [];
    state.goals.forEach(function(g){
      g.milestones.forEach(function(m){
        if (!m.done) out.push({ goal: g, ms: m });
      });
    });
    return out.slice(0, limit);
  }

  function computeHabitStrength(limit){
    var rows = [];
    state.goals.forEach(function(g){
      g.habits.forEach(function(h){
        var streak = computeStreak(h.log);
        var last7 = 0, prev7 = 0;
        for (var i = 0; i < 7; i++) { if (h.log[shiftISO(todayISO(), -i)]) last7++; }
        for (var j = 7; j < 14; j++) { if (h.log[shiftISO(todayISO(), -j)]) prev7++; }
        rows.push({ goal: g, habit: h, streak: streak, pct: clamp((streak / 21) * 100, 0, 100), trendUp: last7 >= prev7 });
      });
    });
    rows.sort(function(a,b){ return b.streak - a.streak; });
    return rows.slice(0, limit);
  }

  function renderSidebar(){
    var openMs = collectOpenMilestones(5);
    var strength = computeHabitStrength(5);
    var msRows = openMs.length ? openMs.map(function(o){
      return '<div class="side-row"><div class="side-emoji">' + o.goal.emoji + '</div>' +
        '<div class="side-text"><div class="side-title">' + esc(o.ms.name) + '</div><div class="side-meta">' + esc(o.goal.name) + '</div></div></div>';
    }).join('') : '<div class="empty-side">No open milestones — add one on a goal card below.</div>';

    var strengthRows = strength.length ? strength.map(function(r){
      return '<div class="strength-row">' +
        '<div class="strength-top"><span class="strength-name">' + esc(r.habit.name) + '</span>' +
          '<span class="strength-figs"><span class="num">' + Math.round(r.pct) + '%</span>' +
            '<span class="trend-chip ' + (r.trendUp ? 'up' : 'down') + '">' + (r.trendUp ? '↑' : '↓') + '</span></span></div>' +
        '<div class="strength-track"><div class="strength-fill" style="width:' + r.pct.toFixed(0) + '%"></div></div>' +
      '</div>';
    }).join('') : '<div class="empty-side">Add a habit to a goal to see its strength here.</div>';

    return (
      '<div style="display:flex;flex-direction:column;gap:16px;">' +
        '<div class="side-card"><h2>Open milestones</h2>' + msRows + '</div>' +
        '<div class="side-card"><h2>Habit strength</h2><div class="sub">21-day streak = full strength</div>' + strengthRows + '</div>' +
      '</div>'
    );
  }

  // ---------- pipeline (people / outreach) ----------
  function allContacts(){
    var out = [];
    state.goals.forEach(function(g){ g.contacts.forEach(function(c){ out.push({ g: g, c: c }); }); });
    return out;
  }

  function computePipelineStats(){
    var all = allContacts();
    var reached = all.filter(function(x){ return !!x.c.reachedOutAt; }).length;
    var met = all.filter(function(x){ return !!x.c.meetingAt; }).length;
    var byCategory = {};
    CATEGORY_OPTS.forEach(function(cat){ byCategory[cat] = 0; });
    all.forEach(function(x){ byCategory[x.c.category] = (byCategory[x.c.category] || 0) + 1; });
    return { total: all.length, reached: reached, met: met, byCategory: byCategory };
  }

  function computePipelineSeries(days){
    var all = allContacts();
    var series = [];
    for (var i = days - 1; i >= 0; i--) {
      var day = shiftISO(todayISO(), -i);
      var reachedCum = all.filter(function(x){ return x.c.reachedOutAt && x.c.reachedOutAt <= day; }).length;
      var metCum = all.filter(function(x){ return x.c.meetingAt && x.c.meetingAt <= day; }).length;
      series.push({ day: day, reached: reachedCum, met: metCum });
    }
    return series;
  }

  function renderPipelineChart(){
    var days = 30;
    var series = computePipelineSeries(days);
    var maxVal = Math.max(1, series[series.length-1].reached, series[series.length-1].met);
    var W = 640, H = 200, padX = 10, padY = 16;
    function toPoints(key){
      return series.map(function(pt, i){
        var x = padX + (i / (series.length - 1)) * (W - padX * 2);
        var y = padY + (1 - pt[key] / maxVal) * (H - padY * 2);
        return { x: x, y: y };
      });
    }
    var reachedPts = toPoints("reached");
    var metPts = toPoints("met");
    var reachedPath = buildSmoothPath(reachedPts);
    var metPath = buildSmoothPath(metPts);
    var last = series[series.length - 1];
    return (
      '<div class="chart-card">' +
        '<div class="chart-card-head">' +
          '<div><h2>Pipeline</h2><div class="sub">Cumulative outreach, last ' + days + ' days</div></div>' +
        '</div>' +
        '<div class="chart-wrap">' +
          '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto;display:block;" preserveAspectRatio="none">' +
            '<path d="' + reachedPath + '" fill="none" stroke="var(--chart-a)" stroke-width="3" stroke-linecap="round"/>' +
            '<path d="' + metPath + '" fill="none" stroke="var(--chart-b)" stroke-width="3" stroke-linecap="round"/>' +
            '<circle cx="' + reachedPts[reachedPts.length-1].x.toFixed(1) + '" cy="' + reachedPts[reachedPts.length-1].y.toFixed(1) + '" r="5" fill="var(--surface)" stroke="var(--chart-a)" stroke-width="3"/>' +
            '<circle cx="' + metPts[metPts.length-1].x.toFixed(1) + '" cy="' + metPts[metPts.length-1].y.toFixed(1) + '" r="5" fill="var(--surface)" stroke="var(--chart-b)" stroke-width="3"/>' +
          '</svg>' +
        '</div>' +
        '<div class="chart-legend">' +
          '<span><span class="legend-dot" style="background:var(--chart-a);"></span>Reached out</span>' +
          '<span><span class="legend-dot" style="background:var(--chart-b);"></span>Meetings booked</span>' +
        '</div>' +
        '<div class="pipeline-stats">' +
          '<div class="pipeline-stat"><span class="n num">' + last.reached + '</span><span class="l">reached out</span></div>' +
          '<div class="pipeline-stat"><span class="n num">' + last.met + '</span><span class="l">meetings booked</span></div>' +
        '</div>' +
      '</div>'
    );
  }

  function renderPipelineSidebar(){
    var stats = computePipelineStats();
    var rows = CATEGORY_OPTS.filter(function(cat){ return stats.byCategory[cat] > 0; }).map(function(cat){
      var pct = stats.total > 0 ? (stats.byCategory[cat] / stats.total) * 100 : 0;
      return '<div class="strength-row">' +
        '<div class="strength-top"><span class="strength-name">' + esc(cat) + '</span><span class="strength-figs"><span class="num">' + stats.byCategory[cat] + '</span></span></div>' +
        '<div class="strength-track"><div class="strength-fill" style="width:' + pct.toFixed(0) + '%"></div></div>' +
      '</div>';
    }).join('');
    var followUps = allContacts().filter(function(x){ return x.c.reachedOutAt && !x.c.meetingAt; }).slice(0, 5);
    var followUpRows = followUps.length ? followUps.map(function(x){
      return '<div class="side-row"><div class="side-emoji">' + x.g.emoji + '</div>' +
        '<div class="side-text"><div class="side-title">' + esc(x.c.name) + '</div><div class="side-meta">' + esc(x.c.category) + ' · ' + esc(x.g.name) + '</div></div></div>';
    }).join('') : '<div class="empty-side">Everyone reached out to has a meeting, or no one\'s logged yet.</div>';
    return (
      '<div style="display:flex;flex-direction:column;gap:16px;">' +
        '<div class="side-card"><h2>Needs a follow-up</h2><div class="sub">Reached out, no meeting yet</div>' + followUpRows + '</div>' +
        '<div class="side-card"><h2>Pipeline by category</h2>' + (rows || '<div class="empty-side">Add people to a goal to see the breakdown.</div>') + '</div>' +
      '</div>'
    );
  }

  function renderHero(){
    return (
      '<div class="hero">' +
        '<h2>Set a goal. Waypoint builds the plan around it.</h2>' +
        '<p>Tell it what you\'re working toward &mdash; a business, a fitness reset, a creative practice, anything &mdash; and it walks you through turning that into metrics you can watch move, habits you can check off daily, and milestones that mark real progress. Grounded in research on habit formation and identity change, not wishful thinking.</p>' +
        '<button class="btn btn-primary" data-action="open-wizard">Set up your first goal</button>' +
      '</div>'
    );
  }

  function renderMetric(g, m){
    var pct = m.target > 0 ? clamp((m.current / m.target) * 100, 0, 100) : 0;
    return (
      '<div class="metric-row">' +
        '<div class="metric-top"><span class="metric-name">' + esc(m.name) + '</span>' +
        '<button class="icon-btn danger" data-action="remove-metric" data-goal="' + g.id + '" data-metric="' + m.id + '" title="Remove metric">✕</button></div>' +
        '<div class="metric-bar-track"><div class="metric-bar-fill" style="width:' + pct.toFixed(0) + '%"></div></div>' +
        '<div class="metric-bottom">' +
          '<input type="number" step="any" class="metric-input" value="' + esc(m.current) + '" data-action="update-metric" data-goal="' + g.id + '" data-metric="' + m.id + '">' +
          '<span class="metric-target">/ ' + esc(m.target) + (m.unit ? (' ' + esc(m.unit)) : '') + '</span>' +
        '</div>' +
      '</div>'
    );
  }

  function renderHabit(g, h){
    var t = todayISO();
    var done = !!h.log[t];
    var streak = computeStreak(h.log);
    return (
      '<div class="habit-row">' +
        '<button class="habit-toggle' + (done ? ' is-done' : '') + '" data-action="toggle-habit" data-goal="' + g.id + '" data-habit="' + h.id + '" title="Mark done today">' + (done ? '✓' : '○') + '</button>' +
        '<div class="habit-info"><div class="habit-name">' + esc(h.name) + '</div><div class="habit-sub">' + esc(h.cadence) + ' · streak ' + streak + ' · best ' + (h.best||0) + '</div></div>' +
        '<button class="icon-btn danger" data-action="remove-habit" data-goal="' + g.id + '" data-habit="' + h.id + '" title="Remove habit">✕</button>' +
      '</div>'
    );
  }

  function renderMilestone(g, m){
    return (
      '<li class="ms-row">' +
        '<label><input type="checkbox" ' + (m.done ? 'checked' : '') + ' data-action="toggle-milestone" data-goal="' + g.id + '" data-ms="' + m.id + '">' +
        '<span class="' + (m.done ? 'ms-done' : '') + '">' + esc(m.name) + '</span></label>' +
        '<button class="icon-btn danger" data-action="remove-milestone" data-goal="' + g.id + '" data-ms="' + m.id + '" title="Remove">✕</button>' +
      '</li>'
    );
  }

  function contactBadge(category){
    return '<span class="contact-badge" style="' + (CATEGORY_STYLE[category] || CATEGORY_STYLE["Other"]) + '">' + esc(category) + '</span>';
  }

  function renderContact(g, c){
    var expanded = uiState.expandedContact === c.id;
    var reached = !!c.reachedOutAt, met = !!c.meetingAt;
    return (
      '<div class="contact-row">' +
        '<div class="contact-row-main">' +
          '<div class="contact-name-wrap"><span class="contact-name">' + esc(c.name) + '</span>' + contactBadge(c.category) + '</div>' +
          '<div class="contact-toggles">' +
            '<button class="contact-toggle' + (reached ? ' on' : '') + '" data-action="toggle-contact-reached" data-goal="' + g.id + '" data-contact="' + c.id + '">' + (reached ? '✓ Reached' : 'Reached out') + '</button>' +
            '<button class="contact-toggle meeting' + (met ? ' on' : '') + '" data-action="toggle-contact-meeting" data-goal="' + g.id + '" data-contact="' + c.id + '">' + (met ? '✓ Meeting' : 'Book meeting') + '</button>' +
          '</div>' +
          '<button class="contact-expand-btn" data-action="toggle-contact-expand" data-contact="' + c.id + '" title="Notes & category">' + (expanded ? '▾' : '▸') + '</button>' +
          '<button class="icon-btn danger" data-action="remove-contact" data-goal="' + g.id + '" data-contact="' + c.id + '" title="Remove">✕</button>' +
        '</div>' +
        (expanded ?
          ('<div class="contact-detail">' +
            '<div><div class="contact-detail-label">Category</div><select data-action="update-contact-category" data-goal="' + g.id + '" data-contact="' + c.id + '">' +
              CATEGORY_OPTS.map(function(cat){ return '<option value="' + cat + '"' + (cat===c.category?' selected':'') + '>' + cat + '</option>'; }).join('') +
            '</select></div>' +
            '<div><div class="contact-detail-label">Notes</div><textarea data-action="update-contact-notes" data-goal="' + g.id + '" data-contact="' + c.id + '" placeholder="How you know them, what they need, next step...">' + esc(c.notes) + '</textarea></div>' +
          '</div>')
        : '') +
      '</div>'
    );
  }

  function renderGoalCard(g){
    var meta = fmtDate(g.targetDate) + (g.targetDate ? ' · ' + daysLeftLabel(g.targetDate) : '');
    var visionBits = [];
    if (g.why) visionBits.push('"' + esc(g.why) + '"');
    if (g.identity) visionBits.push('becoming <strong>' + esc(g.identity) + '</strong>');
    var vision = visionBits.length ? '<p class="vision-line">' + visionBits.join(' &mdash; ') + '</p>' : '';

    var metricsHtml = g.metrics.map(function(m){ return renderMetric(g, m); }).join('');
    var habitsHtml = g.habits.map(function(h){ return renderHabit(g, h); }).join('');
    var msHtml = g.milestones.map(function(m){ return renderMilestone(g, m); }).join('');

    return (
      '<article class="goal-card">' +
        '<header>' +
          '<div class="goal-title"><span class="emoji">' + g.emoji + '</span>' +
          '<div><h3>' + esc(g.name) + '</h3><div class="goal-meta">' + esc(meta) + '</div></div></div>' +
          '<div class="goal-actions">' +
            '<button class="icon-btn" data-action="open-wizard" data-edit="' + g.id + '" title="Edit details">✎</button>' +
            '<button class="icon-btn danger" data-action="delete-goal" data-goal="' + g.id + '" title="Delete goal">🗑</button>' +
          '</div>' +
        '</header>' +
        vision +
        (g.metrics.length ? ('<div><div class="section-label" style="margin-bottom:8px;">Metrics</div>' + metricsHtml + '</div>') : '') +
        '<form class="inline-metric-add" data-action-submit="add-metric" data-goal="' + g.id + '">' +
          '<input type="text" name="name" placeholder="Add a metric" required>' +
          '<input type="number" step="any" name="target" placeholder="target">' +
          '<input type="text" name="unit" placeholder="unit">' +
          '<button type="submit">+</button>' +
        '</form>' +
        '<div class="divider"></div>' +
        '<div><div class="section-label" style="margin-bottom:8px;">Today\'s habits</div>' + (habitsHtml || '<p style="font-size:12.5px;color:var(--ink-faint);">No habits yet.</p>') + '</div>' +
        '<form class="inline-add" data-action-submit="add-habit" data-goal="' + g.id + '">' +
          '<input type="text" name="name" placeholder="Add a habit" required>' +
          '<select name="cadence">' + CADENCE_OPTS.map(function(c){ return '<option value="'+c+'">'+c+'</option>'; }).join('') + '</select>' +
          '<button type="submit">+</button>' +
        '</form>' +
        '<div class="divider"></div>' +
        '<div><div class="section-label" style="margin-bottom:8px;">Milestones</div>' +
          '<ul class="ms-list">' + (msHtml || '<p style="font-size:12.5px;color:var(--ink-faint);">No milestones yet.</p>') + '</ul>' +
        '</div>' +
        '<form class="inline-add" data-action-submit="add-milestone" data-goal="' + g.id + '">' +
          '<input type="text" name="name" placeholder="Add a milestone" required>' +
          '<button type="submit">+</button>' +
        '</form>' +
        '<div class="divider"></div>' +
        '<div><div class="section-label" style="margin-bottom:8px;">People</div>' +
          '<div class="contact-list">' + (g.contacts.length ? g.contacts.map(function(c){ return renderContact(g, c); }).join('') : '<p style="font-size:12.5px;color:var(--ink-faint);">No one logged yet.</p>') + '</div>' +
        '</div>' +
        '<form class="inline-contact-add" data-action-submit="add-contact" data-goal="' + g.id + '">' +
          '<input type="text" name="name" placeholder="Add a person" required>' +
          '<select name="category">' + CATEGORY_OPTS.map(function(c){ return '<option value="'+c+'">'+c+'</option>'; }).join('') + '</select>' +
          '<button type="submit">+</button>' +
        '</form>' +
      '</article>'
    );
  }

  function renderScience(){
    var cards = [
      { h:"Identity beats outcomes", p:"Habits stick better when tied to who you're becoming (“I'm someone who reaches out every day”) rather than the outcome alone. That's why every goal here starts with an identity line, not just a number.", c:"Clear, Atomic Habits; self-concept research" },
      { h:"If-then plans work", p:"Pairing a cue with an action (“when I sit down with coffee, I send one outreach email”) roughly doubles follow-through compared to just intending to do something.", c:"Gollwitzer & Sheeran, meta-analysis 2006" },
      { h:"Visible progress motivates most", p:"Across hundreds of workday diaries, seeing small forward progress was the single strongest driver of motivation — stronger than recognition or incentives.", c:"Amabile & Kramer, The Progress Principle" },
      { h:"Consistency, not intensity", p:"Habit automaticity took a median of 66 days to form in one study, with huge variation (18–254 days) by habit and person. Showing up matters more than any single big effort.", c:"Lally et al., 2010" },
      { h:"Vision alone can backfire", p:"Positively fantasizing about success, without a concrete plan, has been shown to reduce effort and energy. Vision only helps when it's paired with the metrics and habits to actually get there — which is the whole point of pairing that identity line with a plan below it.", c:"Oettingen, mental contrasting research" }
    ];
    return (
      '<div class="science">' +
        '<h2>The mechanics behind this</h2>' +
        '<p class="lede">Waypoint leans on habit-formation and motivation research rather than pure willpower or wishful thinking. Here\'s what it\'s actually built on:</p>' +
        '<div class="science-grid">' +
          cards.map(function(c){
            return '<div class="sci-card"><h4>' + esc(c.h) + '</h4><p>' + esc(c.p) + '</p><div class="cite">' + esc(c.c) + '</div></div>';
          }).join('') +
        '</div>' +
      '</div>'
    );
  }

  function renderWizardStep(){
    var draft = uiState.wizardDraft;
    var step = uiState.wizardSteps[uiState.wizardIdx];

    if (step === "basics") {
      return (
        '<div class="step-title">What are you working toward?</div>' +
        '<div class="step-sub">Give it a name and, if useful, a date to work toward.</div>' +
        '<div><label>Category</label><div class="emoji-grid">' +
          EMOJI_OPTS.map(function(e){ return '<button type="button" class="emoji-opt' + (draft.emoji===e?' selected':'') + '" data-action="wizard-pick-emoji" data-emoji="' + e + '">' + e + '</button>'; }).join('') +
        '</div></div>' +
        '<div><label>Goal name</label><input type="text" data-field="name" value="' + esc(draft.name) + '" placeholder="e.g. Launch my PE due-diligence practice"></div>' +
        '<div><label>Target date (optional)</label><input type="date" data-field="targetDate" value="' + esc(draft.targetDate) + '"></div>'
      );
    }
    if (step === "vision") {
      return (
        '<div class="step-title">Why this, and who does it make you?</div>' +
        '<div class="step-sub">Vision only moves the needle when it\'s specific — and paired with a plan (see the next steps).</div>' +
        '<div><label>Why this matters to you</label><textarea data-field="why" placeholder="e.g. Financial independence outside my current job, and proof I can build something of my own">' + esc(draft.why) + '</textarea></div>' +
        '<div><label>When you get there, who have you become?</label>' +
          '<div class="draft-row"><input class="grow" type="text" data-field="identity" value="' + esc(draft.identity) + '" placeholder="e.g. someone who builds real client relationships from scratch">' + suggestButton("identity", "✨ Suggest") + '</div>' +
          '<div class="field-hint">This becomes the identity line on your goal card — the thing your habits are quietly proving true, one day at a time.</div></div>'
      );
    }
    if (step === "metrics") {
      return (
        '<div class="step-title">How will you know it\'s working?</div>' +
        '<div class="step-sub">Add the numbers you want to watch move — contacts reached, meetings booked, revenue, workouts, words written, whatever fits.</div>' +
        '<div class="draft-list">' +
          draft.metrics.map(function(m, i){
            return '<div class="draft-row">' +
              '<input class="grow" type="text" placeholder="Metric name" data-field="metrics.'+i+'.name" value="' + esc(m.name) + '">' +
              '<input class="w70" type="number" placeholder="target" data-field="metrics.'+i+'.target" value="' + esc(m.target) + '">' +
              '<input class="w70" type="text" placeholder="unit" data-field="metrics.'+i+'.unit" value="' + esc(m.unit) + '">' +
              '<button type="button" class="icon-btn danger" data-action="wizard-remove-row" data-list="metrics" data-idx="'+i+'">✕</button>' +
            '</div>';
          }).join('') +
        '</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
          '<button type="button" class="btn btn-ghost" data-action="wizard-add-row" data-list="metrics">+ Add another metric</button>' +
          suggestButton("metrics", "✨ Suggest for me") +
        '</div>'
      );
    }
    if (step === "habits") {
      return (
        '<div class="step-title">What will you repeat to get there?</div>' +
        '<div class="step-sub">Small, repeatable actions — these are what you\'ll check off each day.</div>' +
        '<div class="draft-list">' +
          draft.habits.map(function(h, i){
            return '<div class="draft-row">' +
              '<input class="grow" type="text" placeholder="Habit name" data-field="habits.'+i+'.name" value="' + esc(h.name) + '">' +
              '<select class="w110" data-field="habits.'+i+'.cadence">' + CADENCE_OPTS.map(function(c){ return '<option value="'+c+'"' + (h.cadence===c?' selected':'') + '>'+c+'</option>'; }).join('') + '</select>' +
              '<button type="button" class="icon-btn danger" data-action="wizard-remove-row" data-list="habits" data-idx="'+i+'">✕</button>' +
            '</div>';
          }).join('') +
        '</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
          '<button type="button" class="btn btn-ghost" data-action="wizard-add-row" data-list="habits">+ Add another habit</button>' +
          suggestButton("habits", "✨ Suggest for me") +
        '</div>'
      );
    }
    if (step === "milestones") {
      return (
        '<div class="step-title">Any checkpoints along the way?</div>' +
        '<div class="step-sub">Optional — concrete milestones you\'ll mark done, not ongoing habits.</div>' +
        '<div class="draft-list">' +
          draft.milestones.map(function(m, i){
            return '<div class="draft-row">' +
              '<input class="grow" type="text" placeholder="Milestone" data-field="milestones.'+i+'.name" value="' + esc(m.name) + '">' +
              '<button type="button" class="icon-btn danger" data-action="wizard-remove-row" data-list="milestones" data-idx="'+i+'">✕</button>' +
            '</div>';
          }).join('') +
        '</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
          '<button type="button" class="btn btn-ghost" data-action="wizard-add-row" data-list="milestones">+ Add another milestone</button>' +
          suggestButton("milestones", "✨ Suggest for me") +
        '</div>'
      );
    }
    return '';
  }

  function renderWizard(){
    if (!uiState.wizardOpen) return '';
    var isLast = uiState.wizardIdx === uiState.wizardSteps.length - 1;
    var dots = uiState.wizardSteps.map(function(s, i){
      var cls = i === uiState.wizardIdx ? 'active' : (i < uiState.wizardIdx ? 'done' : '');
      return '<div class="step-dot ' + cls + '"></div>';
    }).join('');
    return (
      '<div class="modal-overlay">' +
        '<div class="modal">' +
          '<div class="wizard-head"><div class="step-dots">' + dots + '</div><button class="icon-btn" data-action="close-wizard">✕</button></div>' +
          '<div class="wizard-body">' + renderWizardStep() +
            (uiState.wizardError ? '<div style="color:var(--danger);font-size:12.5px;">' + esc(uiState.wizardError) + '</div>' : '') +
          '</div>' +
          '<div class="wizard-foot">' +
            (uiState.wizardIdx > 0 ? '<button class="btn btn-ghost" data-action="wizard-back">Back</button>' : '<span></span>') +
            (isLast ? '<button class="btn btn-primary" data-action="wizard-save">Save goal</button>' : '<button class="btn btn-primary" data-action="wizard-next">Next</button>') +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  function renderAppHTML(){
    var body = uiState.syncError ? ('<div class="sync-banner">' + esc(uiState.syncError) + ' <button type="button" class="icon-btn" data-action="dismiss-sync-error">✕</button></div>') : '';
    body += renderTopbar();
    if (state.goals.length === 0) {
      body += renderHero();
    } else {
      body += renderOverview();
      body += '<div class="dash-columns">' + renderMomentumChart() + renderSidebar() + '</div>';
      if (allContacts().length > 0) {
        body += '<div class="dash-columns">' + renderPipelineChart() + renderPipelineSidebar() + '</div>';
      }
      body += '<div class="goal-grid">' + state.goals.map(renderGoalCard).join('') + '</div>';
    }
    body += renderScience();
    body += '<div class="foot-note">Synced to your account &mdash; pick up where you left off on any device.</div>';
    body += renderWizard();
    return body;
  }

  // ---------- render + persist ----------
  function liveRender(){
    document.getElementById("app").innerHTML = renderAppHTML();
  }

  function render(){ liveRender(); }

  function persist(){
    liveRender();
  }

  // ---------- event delegation ----------
  document.addEventListener("click", function(e){
    var el = e.target.closest("[data-action]");
    if (!el) return;
    var action = el.getAttribute("data-action");
    var goal = el.getAttribute("data-goal");
    switch (action) {
      case "open-wizard": openWizard(el.getAttribute("data-edit") || null); break;
      case "close-wizard": closeWizard(); break;
      case "wizard-next": wizardNext(); break;
      case "wizard-back": wizardBack(); break;
      case "wizard-save": wizardSave(); break;
      case "wizard-pick-emoji": uiState.wizardDraft.emoji = el.getAttribute("data-emoji"); liveRender(); break;
      case "wizard-add-row": wizardAddRow(el.getAttribute("data-list")); break;
      case "wizard-remove-row": wizardRemoveRow(el.getAttribute("data-list"), parseInt(el.getAttribute("data-idx"), 10)); break;
      case "wizard-suggest": wizardSuggest(el.getAttribute("data-list")); break;
      case "toggle-habit": toggleHabitToday(goal, el.getAttribute("data-habit")); break;
      case "remove-habit": removeHabit(goal, el.getAttribute("data-habit")); break;
      case "remove-metric": removeMetric(goal, el.getAttribute("data-metric")); break;
      case "remove-milestone": removeMilestone(goal, el.getAttribute("data-ms")); break;
      case "delete-goal": deleteGoal(goal); break;
      case "toggle-contact-reached": toggleContactReached(goal, el.getAttribute("data-contact")); break;
      case "toggle-contact-meeting": toggleContactMeeting(goal, el.getAttribute("data-contact")); break;
      case "toggle-contact-expand": toggleContactExpand(el.getAttribute("data-contact")); break;
      case "remove-contact": removeContact(goal, el.getAttribute("data-contact")); break;
      case "sign-out": signOut(); break;
      case "dismiss-sync-error": uiState.syncError = ""; liveRender(); break;
    }
  });

  document.addEventListener("change", function(e){
    var el = e.target.closest("[data-action]");
    if (el) {
      var action = el.getAttribute("data-action");
      if (action === "update-metric") updateMetric(el.getAttribute("data-goal"), el.getAttribute("data-metric"), el.value);
      if (action === "toggle-milestone") toggleMilestone(el.getAttribute("data-goal"), el.getAttribute("data-ms"));
      if (action === "update-contact-category") updateContactField(el.getAttribute("data-goal"), el.getAttribute("data-contact"), "category", el.value);
      if (action === "update-contact-notes") updateContactField(el.getAttribute("data-goal"), el.getAttribute("data-contact"), "notes", el.value);
      return;
    }
    var fieldEl = e.target.closest("[data-field]");
    if (fieldEl && uiState.wizardOpen) {
      var path = fieldEl.getAttribute("data-field");
      var draft = uiState.wizardDraft;
      var parts = path.split(".");
      if (parts.length === 1) {
        draft[parts[0]] = fieldEl.value;
      } else {
        draft[parts[0]][parseInt(parts[1],10)][parts[2]] = fieldEl.value;
      }
    }
  });
  document.addEventListener("input", function(e){
    var fieldEl = e.target.closest("[data-field]");
    if (!fieldEl || !uiState.wizardOpen) return;
    if (fieldEl.tagName === "SELECT") return;
    var path = fieldEl.getAttribute("data-field");
    var draft = uiState.wizardDraft;
    var parts = path.split(".");
    if (parts.length === 1) {
      draft[parts[0]] = fieldEl.value;
    } else {
      draft[parts[0]][parseInt(parts[1],10)][parts[2]] = fieldEl.value;
    }
  });

  document.addEventListener("submit", function(e){
    var form = e.target.closest("[data-action-submit]");
    if (!form) return;
    e.preventDefault();
    var action = form.getAttribute("data-action-submit");
    var goal = form.getAttribute("data-goal");
    var fd = new FormData(form);
    if (action === "add-habit") addHabitInline(goal, fd.get("name"), fd.get("cadence"));
    if (action === "add-milestone") addMilestoneInline(goal, fd.get("name"));
    if (action === "add-metric") addMetricInline(goal, fd.get("name"), fd.get("target"), fd.get("unit"));
    if (action === "add-contact") addContactInline(goal, fd.get("name"), fd.get("category"));
    form.reset();
  });

  // ---------- boot / auth ----------
  var authGateEl = document.getElementById("authGate");
  var appEl = document.getElementById("app");
  var signInBtn = document.getElementById("googleSignInBtn");
  var authErrorEl = document.getElementById("authError");

  async function loadStateFromDb(){
    try {
      state = defaultState();
      state.goals = await db.fetchGoals();
      liveRender();
    } catch (e) {
      console.error(e);
      uiState.syncError = "Couldn't load your goals — check your connection and reload.";
      state = defaultState();
      liveRender();
    }
  }

  async function handleSessionChange(session){
    if (session && session.user) {
      currentUser = session.user;
      authGateEl.hidden = true;
      appEl.hidden = false;
      await loadStateFromDb();
    } else {
      currentUser = null;
      state = null;
      authGateEl.hidden = false;
      appEl.hidden = true;
    }
  }

  async function start(){
    signInBtn.addEventListener("click", async function(){
      authErrorEl.hidden = true;
      var res = await signInWithGoogle();
      if (res && res.error) {
        authErrorEl.textContent = res.error.message || "Couldn't start Google sign-in.";
        authErrorEl.hidden = false;
      }
    });
    onAuthStateChange(handleSessionChange);
    var session = await getSession();
    if (!session) {
      // No Google sign-in wired up yet: fall back to an anonymous Supabase
      // session so the app (and its database) still work. Requires
      // "Anonymous Sign-ins" to be turned on in the Supabase dashboard
      // (Authentication -> Sign In / Providers).
      var res2 = await signInAnonymously();
      if (res2 && res2.error) {
        authGateEl.hidden = false;
        authErrorEl.textContent = "Couldn't start a session automatically (" + res2.error.message + "). Turn on Anonymous Sign-ins in Supabase, or sign in with Google below.";
        authErrorEl.hidden = false;
        return;
      }
      session = res2.data.session;
    }
    await handleSessionChange(session);
  }

  start();
})();
