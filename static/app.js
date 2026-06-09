// TomOS PWA — v0.9.0
const API = "";
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ── State ─────────────────────────────────────────────────────────────────────
let state = {
  todos: [], news: [], calendar: [], emails: [],
  training: null,   // { next_template, active_workout }
  protein: null,    // { date, total_g, goal_g, entries }
  exercises: [],    // full exercise library (loaded once)
  activeSession: null, // { workout_id, session_name, exercises: [...] }
};

let timerInterval = null;
let timerStart = null;
let restInterval = null;
let restRemaining = 0;
let currentTemplate = null;  // template being edited
let pickerContext = null;    // 'session' | 'template'

const FOOD_SHORTCUTS = [
  { name: "Chicken breast 100g", g: 31 },
  { name: "Protein shake",       g: 25 },
  { name: "Greek yogurt 1 cup",  g: 17 },
  { name: "Eggs × 1",           g: 6  },
  { name: "Cottage cheese 1 cup",g: 28 },
  { name: "Tuna can",            g: 30 },
  { name: "Ground beef 100g",    g: 26 },
  { name: "Salmon 100g",         g: 25 },
  { name: "Turkey 100g",         g: 29 },
  { name: "Milk 1 cup",          g: 8  },
];

const SET_TYPES = ["working", "warmup", "drop", "failure", "amrap"];
const SET_TYPE_LABEL = { working: "1", warmup: "W", drop: "D", failure: "F", amrap: "A" };
const MUSCLE_GROUPS = ["All", "chest", "back", "shoulders", "quads", "hamstrings", "glutes", "biceps", "triceps", "calves", "core"];

// ── Helpers ───────────────────────────────────────────────────────────────────
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), 2500);
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function emptyState(icon, msg) {
  return `<div class="empty"><div class="big">${icon}</div>${esc(msg)}</div>`;
}

function fmtEventDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  const dateOnly = iso.length <= 10;
  return d.toLocaleString(undefined, dateOnly
    ? { weekday: "short", month: "short", day: "numeric" }
    : { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function relTime(iso) {
  const mins = Math.round((Date.now() - new Date(iso)) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return hrs < 24 ? `${hrs}h ago` : `${Math.round(hrs / 24)}d ago`;
}

function senderName(from) {
  return (from || "").replace(/<.*?>/g, "").trim() || from || "Unknown";
}

function elapsedStr(startIso) {
  const secs = Math.floor((Date.now() - new Date(startIso)) / 1000);
  const m = Math.floor(secs / 60), s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function fmtCountdown(secs) {
  const m = Math.floor(secs / 60), s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ── Navigation ────────────────────────────────────────────────────────────────
const TITLES = {
  home: "TomOS", todo: "Tasks", training: "Train", news: "Feed",
  emails: "Emails", calendar: "Calendar", checkin: "Daily Check-in",
  nudges: "Nudges", "template-editor": "Edit Template",
};
const TAB_VIEW_MAP = { home: "home", todo: "todo", training: "training", news: "news" };

function showView(name) {
  const isHome = name === "home";
  $$(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${name}`));
  if (isHome) {
    setHeader();
  } else {
    $("#greeting").textContent = TITLES[name] || "TomOS";
    $("#subline").textContent = "";
  }
  $$(".tab").forEach((t) => {
    const tv = TAB_VIEW_MAP[t.dataset.tab];
    t.classList.toggle("active", tv === name || (name === "template-editor" && tv === "training"));
  });
  window.scrollTo({ top: 0, behavior: "instant" });
}

$$(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    if (tab.dataset.tab === "more") { openMoreTray(); return; }
    showView(tab.dataset.tab);
  });
});

function openMoreTray() { $("#more-tray").hidden = false; $("#tray-scrim").hidden = false; }
function closeMoreTray() { $("#more-tray").hidden = true; $("#tray-scrim").hidden = true; }
$("#tray-scrim").addEventListener("click", closeMoreTray);
$$(".more-item").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); closeMoreTray(); showView(a.dataset.view); }));

function bindDashTaps() {
  $$("#dash .dash").forEach((el) => el.addEventListener("click", () => showView(el.dataset.view)));
}

// ── Header ────────────────────────────────────────────────────────────────────
function setHeader() {
  const h = new Date().getHours();
  const part = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  $("#greeting").textContent = `${part}, Tom`;
  const date = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const open = state.todos.filter((t) => !t.done).length;
  const bits = [date, open ? `${open} open task${open === 1 ? "" : "s"}` : "all clear ✓"];
  if (state.calendar.length) bits.push(`${state.calendar.length} event${state.calendar.length === 1 ? "" : "s"}`);
  $("#subline").textContent = bits.join("  ·  ");
}

$("#refresh").addEventListener("click", async () => {
  const btn = $("#refresh");
  btn.classList.add("spin");
  toast("Pulling Gmail + Calendar…");
  try {
    const r = await fetch(`${API}/refresh`, { method: "POST" });
    if (!r.ok) throw new Error();
    const data = await r.json();
    await loadAll();
    loadNews(true);
    toast(`${data.todos_added} new task${data.todos_added === 1 ? "" : "s"} · ${data.events} events`);
  } catch { toast("Refresh failed"); }
  finally { btn.classList.remove("spin"); }
});

// ── Dashboard ─────────────────────────────────────────────────────────────────
function renderDashboard() {
  const open = state.todos.filter((t) => !t.done);
  const ev = state.calendar[0];
  const headline = state.news[0];
  const em = state.emails[0];
  const proto = state.protein;
  const nextName = state.training?.next_template?.name ?? "—";
  const protoPct = proto ? Math.min(100, Math.round((proto.total_g / proto.goal_g) * 100)) : 0;
  const protoLabel = proto ? `${Math.round(proto.total_g)} / ${proto.goal_g}g` : "— / 200g";
  const barCls = protoPct >= 80 ? "good" : protoPct >= 50 ? "mid" : "low";

  const cards = [
    `<button class="dash hero" data-view="todo">
      <div class="dash-top"><span class="dash-label">Today</span><span class="arrow">›</span></div>
      ${open.slice(0,3).length
        ? `<ul class="hero-list">${open.slice(0,3).map((t) => `<li>○ ${esc(t.text)}</li>`).join("")}</ul>`
        : `<div class="hero-clear">No open tasks — all clear ✓</div>`}
      <div class="hero-next">${ev ? `▦ ${esc(ev.summary)} · ${esc(fmtEventDate(ev.start))}` : "▦ Nothing scheduled"}</div>
    </button>`,
    `<button class="dash" data-view="training">
      <div class="dash-top"><span class="dash-label">🏋 Train</span><span class="arrow">›</span></div>
      <div class="dash-body">Next up: <span class="hl">${esc(nextName)}</span></div>
      <div class="protein-bar mini ${barCls}"><i style="width:${protoPct}%"></i></div>
      <div style="font-size:12px;color:var(--muted);margin-top:4px">Protein ${protoLabel}</div>
    </button>`,
    `<button class="dash" data-view="news">
      <div class="dash-top"><span class="dash-label">📰 Feed</span><span class="badge">${state.news.length || "…"}</span></div>
      <div class="dash-body">${headline ? esc(headline.title) : "Loading headlines…"}</div>
    </button>`,
    `<button class="dash" data-view="emails">
      <div class="dash-top"><span class="dash-label">✉ Emails</span><span class="badge">${state.emails.length || 0}</span></div>
      <div class="dash-body">${em ? esc(senderName(em.from)) + " · " + esc(em.subject) : "Nothing flagged"}</div>
    </button>`,
    `<button class="dash" data-view="checkin">
      <div class="dash-top"><span class="dash-label">◎ Check-in</span><span class="arrow">›</span></div>
      <div class="dash-body">Set today's top 3 · evening reflection</div>
    </button>`,
  ];
  $("#dash").innerHTML = cards.join("");
  bindDashTaps();
}

// ── To-Do ─────────────────────────────────────────────────────────────────────
function renderTodos() {
  const t = state.todos;
  if (!t.length) { $("#todo").innerHTML = emptyState("✓", "No action items yet. Hit ⟳ to pull your latest."); return; }
  const open = t.filter((x) => !x.done).length;
  $("#todo").innerHTML = `<div class="section-label">${open} open · ${t.length - open} done</div>` +
    t.map((item) => `<div class="todo ${item.done ? "done" : ""}" data-id="${item.id}">
      <div class="box"></div>
      <div class="text">${esc(item.text)}${item.briefing_date ? `<span class="meta">${esc(item.briefing_date)}</span>` : ""}</div>
    </div>`).join("");
  $$("#todo .todo").forEach((el) => el.addEventListener("click", () => toggleTodo(Number(el.dataset.id))));
}

async function toggleTodo(id) {
  const item = state.todos.find((x) => x.id === id);
  if (!item) return;
  const next = !item.done;
  item.done = next;
  renderTodos(); renderDashboard();
  try {
    const r = await fetch(`${API}/todos/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ done: next }) });
    if (!r.ok) throw new Error();
  } catch { item.done = !next; renderTodos(); renderDashboard(); toast("Couldn't save"); }
}

// ── News / Calendar / Emails ───────────────────────────────────────────────────
function renderNews() {
  const n = state.news;
  if (!n?.length) { $("#news").innerHTML = emptyState("📰", "No fresh headlines right now."); return; }
  $("#news").innerHTML = `<div class="section-label">Top headlines · past 24h</div>` +
    n.map((a) => `<a class="card news" href="${esc(a.url)}" target="_blank" rel="noopener">
      <div class="news-meta"><span class="src">${esc(a.source)}</span> · ${esc(relTime(a.published))}</div>
      <div class="news-title">${esc(a.title)}</div>
    </a>`).join("");
}

function renderCalendar() {
  const c = state.calendar;
  if (!c.length) { $("#calendar").innerHTML = emptyState("▦", "Nothing scheduled in the next 7 days."); return; }
  $("#calendar").innerHTML = `<div class="section-label">Next 7 days</div>` +
    c.map((e) => `<div class="card event">
      <div class="when">${esc(fmtEventDate(e.start))}</div>
      <div class="what">${esc(e.summary)}</div>
      ${e.location ? `<div class="where">${esc(e.location)}</div>` : ""}
    </div>`).join("");
}

function renderEmails() {
  const m = state.emails;
  if (!m.length) { $("#emails").innerHTML = emptyState("✉", "No flagged emails. Hit ⟳ to screen your inbox."); return; }
  $("#emails").innerHTML = `<div class="section-label">Flagged by Claude</div>` +
    m.map((e) => `<div class="card email">
      <div class="from">${esc(senderName(e.from))}</div>
      <div class="subject">${esc(e.subject)}</div>
      ${e.reason ? `<div class="reason">${esc(e.reason)}</div>` : ""}
    </div>`).join("");
}

// ── Protein ───────────────────────────────────────────────────────────────────
function renderProtein() {
  const p = state.protein;
  if (!p) return;
  const pct = Math.min(100, Math.round((p.total_g / p.goal_g) * 100));
  const barCls = pct >= 80 ? "good" : pct >= 50 ? "mid" : "low";
  const barEl = $(".protein-bar:not(.mini)");
  if (barEl) { barEl.className = `protein-bar ${barCls}`; }
  const fill = $("#protein-bar-fill");
  if (fill) fill.style.width = `${pct}%`;
  const label = $("#protein-total-label");
  if (label) label.textContent = `${Math.round(p.total_g)} / ${p.goal_g}g`;

  const listEl = $("#protein-log-list");
  if (listEl) {
    listEl.innerHTML = p.entries.length
      ? p.entries.map((e) => `<div class="protein-entry">
          <span class="food">${esc(e.food_name)}</span>
          <span style="display:flex;align-items:center;gap:4px">
            <span class="grams">${e.protein_g}g</span>
            <span class="del" data-id="${e.id}">×</span>
          </span>
        </div>`).join("")
      : `<div style="color:var(--muted);font-size:13px;padding:4px 0">Nothing logged yet</div>`;
    listEl.querySelectorAll(".del").forEach((btn) => btn.addEventListener("click", () => deleteProtein(Number(btn.dataset.id))));
  }

  const chips = $("#food-chips");
  if (chips && !chips.children.length) {
    chips.innerHTML = FOOD_SHORTCUTS.map((f) =>
      `<button class="chip" data-name="${esc(f.name)}" data-g="${f.g}">${esc(f.name)} <b>+${f.g}g</b></button>`
    ).join("");
    chips.querySelectorAll(".chip").forEach((btn) => btn.addEventListener("click", () => quickLogProtein(btn.dataset.name, Number(btn.dataset.g))));
  }
}

async function quickLogProtein(name, g) {
  try {
    const r = await fetch(`${API}/protein/log`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ food_name: name, protein_g: g }) });
    if (!r.ok) throw new Error();
    const entry = await r.json();
    state.protein.entries.push(entry);
    state.protein.total_g = Math.round((state.protein.total_g + g) * 10) / 10;
    renderProtein(); renderDashboard();
    toast(`+${g}g protein`);
  } catch { toast("Couldn't log protein"); }
}

async function deleteProtein(id) {
  const entry = state.protein?.entries.find((e) => e.id === id);
  if (!entry) return;
  try {
    await fetch(`${API}/protein/log/${id}`, { method: "DELETE" });
    state.protein.entries = state.protein.entries.filter((e) => e.id !== id);
    state.protein.total_g = Math.max(0, Math.round((state.protein.total_g - entry.protein_g) * 10) / 10);
    renderProtein(); renderDashboard();
  } catch { toast("Couldn't delete entry"); }
}

$("#custom-protein-btn").addEventListener("click", () => {
  $("#protein-modal").hidden = false;
  $("#protein-food-name").value = "";
  $("#protein-g-input").value = "";
  setTimeout(() => $("#protein-food-name").focus(), 50);
});
$("#protein-modal-cancel").addEventListener("click", () => { $("#protein-modal").hidden = true; });
$("#protein-modal-add").addEventListener("click", async () => {
  const name = $("#protein-food-name").value.trim();
  const g = parseFloat($("#protein-g-input").value);
  if (!name || isNaN(g) || g <= 0) { toast("Enter a name and amount"); return; }
  $("#protein-modal").hidden = true;
  await quickLogProtein(name, g);
});

// ── Training: resting state ───────────────────────────────────────────────────
function renderTraining() {
  const t = state.training;

  if (t?.active_workout && state.activeSession) {
    showActiveSession(state.activeSession);
    return;
  }

  $("#train-active").hidden = true;
  $("#train-resting").hidden = false;
  renderProtein();

  const tmpl = t?.next_template;
  const nextName = tmpl?.name ?? "Push";

  // Next session card
  fetch(`${API}/templates/${tmpl?.id ?? 1}`)
    .then((r) => r.json())
    .then((data) => {
      const exercises = data.exercises ?? [];
      $("#next-session-card").innerHTML = `
        <div class="session-card-top">
          <div class="session-card-title">
            <div class="next-label">Next up</div>
            <div class="next-name">${esc(nextName)}</div>
          </div>
          <div class="session-card-actions">
            <button class="edit-template-btn" id="edit-tmpl-btn" data-id="${data.id}" title="Edit template">✎</button>
            <button class="start-btn" id="start-session-btn">Start</button>
          </div>
        </div>
        <ul class="exercise-preview">
          ${exercises.slice(0, 4).map((ex) => `<li><span>${esc(ex.name)}</span>${ex.default_sets}×${ex.default_reps}</li>`).join("")}
          ${exercises.length > 4 ? `<li style="color:var(--muted)">+ ${exercises.length - 4} more</li>` : ""}
        </ul>`;
      $("#start-session-btn")?.addEventListener("click", startSession);
      $("#edit-tmpl-btn")?.addEventListener("click", () => openTemplateEditor(data));
    })
    .catch(() => {
      $("#next-session-card").innerHTML = `<div class="next-label">Next up</div><div class="next-name">${esc(nextName)}</div><button class="start-btn" id="start-session-btn">Start</button>`;
      $("#start-session-btn")?.addEventListener("click", startSession);
    });

  loadTrainingWeek();
  loadWorkoutHistory();
}

async function loadTrainingWeek() {
  try {
    const r = await fetch(`${API}/training/week`);
    const data = await r.json();
    const done = new Set(data.sessions.map((s) => s.session_name));
    const SPLIT = ["Push", "Pull", "Legs", "Upper", "Lower"];
    $("#split-tracker").innerHTML = SPLIT.map((s) => `
      <div class="split-dot ${done.has(s) ? "done" : ""}">
        <div class="circle">${s[0]}</div>
        <div class="dot-label">${s}</div>
      </div>`).join("");
  } catch { /* silent */ }
}

async function loadWorkoutHistory() {
  try {
    const r = await fetch(`${API}/training/history`);
    const data = await r.json();
    const el = $("#workout-history-list");
    if (!data.length) {
      el.innerHTML = `<div class="history-empty">No sessions logged yet — start your first workout above.</div>`;
      return;
    }
    el.innerHTML = data.map((w) => {
      const d = new Date(w.completed_at);
      const dateStr = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
      const vol = w.total_volume >= 1000
        ? `${(w.total_volume / 1000).toFixed(1)}k` : String(Math.round(w.total_volume || 0));
      const dur = w.duration_mins ? `${w.duration_mins}m` : "";
      const meta = [dateStr, dur, w.total_sets ? `${w.total_sets} sets` : ""].filter(Boolean).join(" · ");
      return `<div class="history-card" data-id="${w.id}">
        <div class="history-pill">${esc(w.session_name.slice(0, 3).toUpperCase())}</div>
        <div class="history-main">
          <div class="history-name">${esc(w.session_name)}</div>
          <div class="history-meta">${meta}</div>
        </div>
        ${w.total_volume ? `<div class="history-vol">${vol}<br><span class="history-vol-unit">lbs</span></div>` : ""}
      </div>`;
    }).join("");
    el.querySelectorAll(".history-card").forEach((card) =>
      card.addEventListener("click", () => openWorkoutDetail(Number(card.dataset.id)))
    );
  } catch { /* silent */ }
}

async function openWorkoutDetail(workoutId) {
  try {
    const r = await fetch(`${API}/training/history/${workoutId}`);
    if (!r.ok) throw new Error();
    const w = await r.json();

    const d = new Date(w.completed_at);
    const dateStr = d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    const timeStr = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

    $("#wd-session-name").textContent = w.session_name;
    $("#wd-date").textContent = `${dateStr} · ${timeStr}`;

    const dur = w.duration_mins != null ? `${w.duration_mins}m` : "—";
    const vol = w.total_volume ? `${(w.total_volume / 1000).toFixed(1)}k lbs` : "—";
    $("#wd-stats").innerHTML = `
      <div class="wd-stat"><div class="wd-stat-val">${dur}</div><div class="wd-stat-label">Duration</div></div>
      <div class="wd-stat"><div class="wd-stat-val">${w.total_sets || 0}</div><div class="wd-stat-label">Sets</div></div>
      <div class="wd-stat"><div class="wd-stat-val">${vol}</div><div class="wd-stat-label">Volume</div></div>`;

    $("#wd-exercises").innerHTML = (w.exercises || []).map((ex) => {
      const setsHtml = ex.sets.map((s) => {
        const tag = s.set_type === "working" ? s.set_num : SET_TYPE_LABEL[s.set_type] ?? s.set_num;
        const weight = s.weight_lbs != null ? `${s.weight_lbs} lbs` : "—";
        const reps = s.reps != null ? `${s.reps}` : "—";
        const rpe = s.rpe != null ? `${s.rpe}` : "—";
        return `<div class="wd-set-row">
          <div class="wd-set-num">${tag}</div>
          <div class="wd-set-val ${s.is_pr ? "pr" : ""}">${weight}${s.is_pr ? " 🏆" : ""}</div>
          <div class="wd-set-val">${reps} reps</div>
          <div class="wd-set-val">${rpe !== "—" ? `RPE ${rpe}` : ""}</div>
        </div>`;
      }).join("");
      return `<div class="wd-exercise">
        <div class="wd-ex-name">${esc(ex.name)}</div>
        ${ex.muscle_group ? `<div class="wd-ex-muscle">${esc(ex.muscle_group)}</div>` : ""}
        <div class="wd-set-header"><span></span><span>Weight</span><span>Reps</span><span>RPE</span></div>
        ${setsHtml}
      </div>`;
    }).join("");

    $("#workout-detail-modal").hidden = false;
  } catch { toast("Couldn't load workout details"); }
}

$("#wd-close").addEventListener("click", () => { $("#workout-detail-modal").hidden = true; });

// ── Training: start session ───────────────────────────────────────────────────
async function startSession() {
  try {
    const r = await fetch(`${API}/training/start`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    if (!r.ok) {
      const err = await r.json();
      toast(err.detail ?? "Couldn't start");
      return;
    }
    const data = await r.json();
    state.activeSession = data;
    state.training = { ...state.training, active_workout: { id: data.workout_id, session_name: data.session_name } };
    showActiveSession(data);
  } catch { toast("Couldn't start session"); }
}

// ── Training: active session ──────────────────────────────────────────────────
function showActiveSession(session) {
  $("#train-resting").hidden = true;
  $("#train-active").hidden = false;
  $("#active-session-name").textContent = session.session_name;

  if (timerInterval) clearInterval(timerInterval);
  timerStart = state.training?.active_workout?.started_at ?? session.started_at ?? new Date().toISOString();
  $("#session-timer").textContent = elapsedStr(timerStart);
  timerInterval = setInterval(() => { $("#session-timer").textContent = elapsedStr(timerStart); }, 1000);

  renderActiveExercises(session.exercises ?? []);
}

function renderActiveExercises(exercises) {
  const container = $("#active-exercises");
  container.innerHTML = exercises.map((ex, exIdx) => buildExerciseBlock(ex, exIdx)).join("");
  bindExerciseBlockEvents(exercises);
}

function buildExerciseBlock(ex, exIdx) {
  const setsHtml = ex.sets.map((s) => buildSetRow(s, ex)).join("");
  const firstSet = ex.sets[0];
  const overloadHint = firstSet?.prev_weight != null
    ? `<div class="ex-overload-hint">Last: ${firstSet.prev_weight}×${firstSet.prev_reps} · try ${firstSet.prev_weight + 2.5}lbs</div>`
    : "";
  return `
    <div class="exercise-block" data-we-id="${ex.we_id}" data-ex-idx="${exIdx}">
      <div class="exercise-block-header">
        <div class="exercise-block-name-wrap">
          <div class="exercise-block-name">${esc(ex.name)}</div>
          ${overloadHint}
        </div>
        <button class="ex-action-btn add-set-btn" title="Add set">+set</button>
        <button class="ex-remove-btn" title="Remove exercise">×</button>
      </div>
      <div class="set-table-header">
        <span>Set</span><span>Prev</span><span>Weight</span><span></span><span>Reps</span><span>RPE</span><span></span>
      </div>
      <div class="set-rows">${setsHtml}</div>
    </div>`;
}

function buildSetRow(s, ex) {
  const typeLabel = s.set_type === "working" ? s.set_num : SET_TYPE_LABEL[s.set_type] ?? s.set_num;
  const prevText = s.prev_weight != null ? `${s.prev_weight}×${s.prev_reps}` : "—";
  const wVal = s.weight_lbs != null ? s.weight_lbs : (s.prev_weight ?? "");
  const rVal = s.reps != null ? s.reps : (s.prev_reps ?? "");
  const rpeVal = s.rpe != null ? s.rpe : "";
  return `
    <div class="set-row ${s.logged ? "logged-row" : ""}" data-set-num="${s.set_num}">
      <button class="set-type-tag ${s.set_type !== "working" ? s.set_type : ""}" data-type="${s.set_type}">${typeLabel}</button>
      <div class="set-prev">${prevText}</div>
      <input class="set-input weight-input" type="number" min="0" max="2000" step="2.5"
        placeholder="${s.prev_weight ?? "lbs"}" value="${wVal}" />
      <span class="set-sep">×</span>
      <input class="set-input reps-input" type="number" min="0" max="200"
        placeholder="${s.prev_reps ?? "reps"}" value="${rVal}" />
      <input class="set-input rpe-input" type="number" min="1" max="10" step="0.5"
        placeholder="RPE" value="${rpeVal}" />
      <button class="set-check ${s.logged ? "logged" : ""}">${s.logged ? "✓" : ""}</button>
    </div>`;
}

function bindExerciseBlockEvents(exercises) {
  const container = $("#active-exercises");

  // Add set
  container.querySelectorAll(".add-set-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const block = btn.closest(".exercise-block");
      const exIdx = Number(block.dataset.exIdx);
      const ex = exercises[exIdx];
      const lastSet = ex.sets[ex.sets.length - 1] ?? {};
      const newSet = {
        set_num: ex.sets.length + 1,
        set_type: lastSet.set_type ?? "working",
        prev_weight: lastSet.prev_weight,
        prev_reps: lastSet.prev_reps ?? ex.default_reps,
        weight_lbs: null, reps: null, logged: false,
      };
      ex.sets.push(newSet);
      const rowsContainer = block.querySelector(".set-rows");
      rowsContainer.insertAdjacentHTML("beforeend", buildSetRow(newSet, ex));
      // Re-bind the new row
      const newRow = rowsContainer.lastElementChild;
      bindSetRowEvents(newRow, ex, newSet, exercises);
    });
  });

  // Remove exercise
  container.querySelectorAll(".ex-remove-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const block = btn.closest(".exercise-block");
      const weId = Number(block.dataset.weId);
      const hasLogged = block.querySelectorAll(".set-check.logged").length > 0;
      if (hasLogged && !confirm("Remove this exercise? Logged sets will be deleted.")) return;
      try {
        await fetch(`${API}/training/exercises/${weId}`, { method: "DELETE" });
        block.remove();
        const exIdx = Number(block.dataset.exIdx);
        exercises.splice(exIdx, 1);
        // Update exIdx on remaining blocks
        $("#active-exercises").querySelectorAll(".exercise-block").forEach((b, i) => b.dataset.exIdx = i);
      } catch { toast("Couldn't remove exercise"); }
    });
  });

  // Set type cycle & check
  container.querySelectorAll(".exercise-block").forEach((block) => {
    const exIdx = Number(block.dataset.exIdx);
    const ex = exercises[exIdx];
    block.querySelectorAll(".set-row").forEach((row, setIdx) => {
      const s = ex.sets[setIdx];
      if (s) bindSetRowEvents(row, ex, s, exercises);
    });
  });
}

function bindSetRowEvents(row, ex, s, exercises) {
  // Set type tag cycle
  const tag = row.querySelector(".set-type-tag");
  if (tag) {
    tag.addEventListener("click", () => {
      const cur = SET_TYPES.indexOf(tag.dataset.type);
      const next = SET_TYPES[(cur + 1) % SET_TYPES.length];
      s.set_type = next;
      tag.dataset.type = next;
      tag.className = `set-type-tag ${next !== "working" ? next : ""}`;
      tag.textContent = next === "working" ? String(s.set_num) : SET_TYPE_LABEL[next];
    });
  }

  // Check / log set
  const checkBtn = row.querySelector(".set-check");
  if (checkBtn) {
    checkBtn.addEventListener("click", async () => {
      const wInput = row.querySelector(".weight-input");
      const rInput = row.querySelector(".reps-input");
      const rpeInput = row.querySelector(".rpe-input");
      const weight = parseFloat(wInput.value || wInput.placeholder) || null;
      const reps = parseInt(rInput.value || rInput.placeholder) || null;
      const rpe = rpeInput?.value ? parseFloat(rpeInput.value) : null;
      const weId = Number(row.closest(".exercise-block").dataset.weId);

      try {
        const r = await fetch(`${API}/training/sets`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workout_exercise_id: weId, set_num: s.set_num, set_type: s.set_type, weight_lbs: weight, reps, rpe }),
        });
        if (!r.ok) throw new Error();
        const result = await r.json();
        s.logged = true; s.weight_lbs = weight; s.reps = reps;
        checkBtn.classList.add("logged");
        checkBtn.textContent = "✓";
        row.classList.add("logged-row");
        if (weight) wInput.value = weight;
        if (reps) rInput.value = reps;
        if (result.is_pr) showPrBanner(ex.name, weight, reps, row);
        startRestTimer(ex.is_compound);
      } catch { toast("Couldn't log set"); }
    });
  }
}

function showPrBanner(exName, weight, reps, row) {
  const banner = $("#pr-banner");
  const text = $("#pr-banner-text");
  text.textContent = `New PR — ${exName}: ${weight}lbs × ${reps}`;
  banner.hidden = false;
  row.classList.add("pr-flash");
  clearTimeout(showPrBanner._t);
  showPrBanner._t = setTimeout(() => { banner.hidden = true; }, 4000);
}

// ── Rest Timer ────────────────────────────────────────────────────────────────
function startRestTimer(isCompound) {
  const duration = isCompound ? 120 : 60;
  restRemaining = duration;
  const bar = $("#rest-timer-bar");
  const countdown = $("#rest-countdown");
  bar.hidden = false;
  countdown.classList.remove("done");
  countdown.textContent = fmtCountdown(restRemaining);

  if (restInterval) clearInterval(restInterval);
  restInterval = setInterval(() => {
    restRemaining--;
    if (restRemaining <= 0) {
      clearInterval(restInterval);
      countdown.textContent = "Done!";
      countdown.classList.add("done");
    } else {
      countdown.textContent = fmtCountdown(restRemaining);
    }
  }, 1000);
}

function stopRestTimer() {
  if (restInterval) clearInterval(restInterval);
  $("#rest-timer-bar").hidden = true;
}

$("#rest-skip").addEventListener("click", stopRestTimer);

// ── Add exercise to session ───────────────────────────────────────────────────
$("#add-exercise-session-btn").addEventListener("click", () => openExercisePicker("session"));

// ── Finish / Abandon ──────────────────────────────────────────────────────────
$("#finish-btn").addEventListener("click", async () => {
  const workoutId = state.activeSession?.workout_id;
  if (!workoutId) return;
  try {
    const r = await fetch(`${API}/training/complete`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workout_id: workoutId }),
    });
    if (!r.ok) throw new Error();
    const data = await r.json();
    clearInterval(timerInterval); stopRestTimer();
    state.activeSession = null;
    await loadTraining();
    renderTraining();
    renderDashboard();
    toast(`Done! Next up: ${data.next_session}`);
  } catch { toast("Couldn't finish session"); }
});

$("#abandon-btn").addEventListener("click", async () => {
  if (!confirm("Abandon this session?")) return;
  try {
    await fetch(`${API}/training/active`, { method: "DELETE" });
    clearInterval(timerInterval); stopRestTimer();
    state.activeSession = null;
    state.training = { ...state.training, active_workout: null };
    await loadTraining();
    renderTraining();
  } catch { toast("Couldn't abandon"); }
});

// ── Template Editor ───────────────────────────────────────────────────────────
function openTemplateEditor(template) {
  currentTemplate = template;
  $("#editor-title").textContent = `Edit — ${template.name}`;
  renderTemplateEditor(template);
  showView("template-editor");
}

function renderTemplateEditor(template) {
  const list = $("#template-exercise-list");
  const exercises = template.exercises ?? [];
  list.innerHTML = exercises.map((ex, idx) => `
    <div class="te-row" data-te-id="${ex.te_id}" data-idx="${idx}">
      <div class="te-order-btns">
        <button class="te-order-btn up-btn" ${idx === 0 ? "disabled" : ""}>▲</button>
        <button class="te-order-btn dn-btn" ${idx === exercises.length - 1 ? "disabled" : ""}>▼</button>
      </div>
      <div class="te-row-main">
        <div class="te-name">${esc(ex.name)}</div>
        <div class="te-meta">${esc(ex.muscle_group ?? "")} · ${esc(ex.equipment ?? "")}</div>
        <div class="te-sets-reps">
          <input class="te-input sets-input" type="number" min="1" max="10" value="${ex.default_sets}" />
          <span class="te-sep">sets ×</span>
          <input class="te-input reps-input" type="number" min="1" max="30" value="${ex.default_reps}" />
          <span class="te-sep">reps</span>
        </div>
      </div>
      <button class="te-remove" data-te-id="${ex.te_id}">×</button>
    </div>`).join("");

  // Bind events
  list.querySelectorAll(".te-remove").forEach((btn) => btn.addEventListener("click", async () => {
    const teId = Number(btn.dataset.teId);
    try {
      await fetch(`${API}/templates/${currentTemplate.id}/exercises/${teId}`, { method: "DELETE" });
      currentTemplate.exercises = currentTemplate.exercises.filter((e) => e.te_id !== teId);
      renderTemplateEditor(currentTemplate);
    } catch { toast("Couldn't remove"); }
  }));

  list.querySelectorAll(".sets-input, .reps-input").forEach((input) => {
    input.addEventListener("change", async () => {
      const row = input.closest(".te-row");
      const teId = Number(row.dataset.teId);
      const sets = Number(row.querySelector(".sets-input").value);
      const reps = Number(row.querySelector(".reps-input").value);
      try {
        await fetch(`${API}/templates/${currentTemplate.id}/exercises/${teId}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ default_sets: sets, default_reps: reps }),
        });
        const ex = currentTemplate.exercises.find((e) => e.te_id === teId);
        if (ex) { ex.default_sets = sets; ex.default_reps = reps; }
      } catch { toast("Couldn't save"); }
    });
  });

  // Up / down reorder
  list.querySelectorAll(".up-btn, .dn-btn").forEach((btn) => btn.addEventListener("click", async () => {
    const row = btn.closest(".te-row");
    const idx = Number(row.dataset.idx);
    const isUp = btn.classList.contains("up-btn");
    const swapIdx = isUp ? idx - 1 : idx + 1;
    const exs = currentTemplate.exercises;
    if (swapIdx < 0 || swapIdx >= exs.length) return;
    [exs[idx], exs[swapIdx]] = [exs[swapIdx], exs[idx]];
    // Patch both order indices
    try {
      await fetch(`${API}/templates/${currentTemplate.id}/exercises/${exs[idx].te_id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ order_idx: idx }),
      });
      await fetch(`${API}/templates/${currentTemplate.id}/exercises/${exs[swapIdx].te_id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ order_idx: swapIdx }),
      });
    } catch { /* silent — rerender anyway */ }
    renderTemplateEditor(currentTemplate);
  }));
}

$("#editor-back-btn").addEventListener("click", async () => {
  await loadTraining();
  renderTraining();
  showView("training");
});

$("#add-exercise-template-btn").addEventListener("click", () => openExercisePicker("template"));

// ── Exercise Picker ───────────────────────────────────────────────────────────
let activeFilterGroup = "All";

async function openExercisePicker(context) {
  pickerContext = context;
  if (!state.exercises.length) {
    try {
      const r = await fetch(`${API}/exercises`);
      state.exercises = await r.json();
    } catch { toast("Couldn't load exercises"); return; }
  }

  $("#exercise-picker").hidden = false;
  $("#ex-picker-scrim").hidden = false;
  $("#ex-search").value = "";
  activeFilterGroup = "All";

  // Build filter chips
  const filterEl = $("#ex-filter-chips");
  filterEl.innerHTML = MUSCLE_GROUPS.map((g) =>
    `<button class="ex-filter-chip ${g === "All" ? "active" : ""}" data-group="${g}">${g.charAt(0).toUpperCase() + g.slice(1)}</button>`
  ).join("");
  filterEl.querySelectorAll(".ex-filter-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeFilterGroup = btn.dataset.group;
      filterEl.querySelectorAll(".ex-filter-chip").forEach((b) => b.classList.toggle("active", b === btn));
      renderExerciseList();
    });
  });

  renderExerciseList();
  setTimeout(() => $("#ex-search").focus(), 100);
}

function renderExerciseList() {
  const q = ($("#ex-search")?.value ?? "").toLowerCase();
  let filtered = state.exercises;
  if (activeFilterGroup !== "All") filtered = filtered.filter((e) => e.muscle_group === activeFilterGroup);
  if (q) filtered = filtered.filter((e) => e.name.toLowerCase().includes(q));

  $("#ex-list").innerHTML = filtered.length
    ? filtered.map((e) => `
        <div class="ex-item" data-id="${e.id}" data-name="${esc(e.name)}" data-compound="${e.is_compound}">
          <div class="ex-item-name">${esc(e.name)}</div>
          <div class="ex-item-meta"><span class="mg">${esc(e.muscle_group ?? "")}</span> · ${esc(e.equipment ?? "")}</div>
        </div>`).join("")
    : emptyState("🔍", "No exercises found");

  $("#ex-list").querySelectorAll(".ex-item").forEach((item) => {
    item.addEventListener("click", () => selectExercise(Number(item.dataset.id), item.dataset.name, Boolean(Number(item.dataset.compound))));
  });
}

$("#ex-search").addEventListener("input", renderExerciseList);

function closeExercisePicker() {
  $("#exercise-picker").hidden = true;
  $("#ex-picker-scrim").hidden = true;
}

$("#ex-picker-close").addEventListener("click", closeExercisePicker);
$("#ex-picker-scrim").addEventListener("click", closeExercisePicker);

async function selectExercise(exerciseId, name, isCompound) {
  closeExercisePicker();

  if (pickerContext === "session") {
    const workoutId = state.activeSession?.workout_id;
    if (!workoutId) return;
    try {
      const r = await fetch(`${API}/training/exercises`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workout_id: workoutId, exercise_id: exerciseId }),
      });
      if (!r.ok) throw new Error();
      const data = await r.json();
      // Build a local exercise entry and add to session
      const newEx = {
        we_id: data.we_id, exercise_id: exerciseId, name, is_compound: isCompound,
        default_sets: 3, default_reps: 10,
        sets: [{
          set_num: 1, set_type: "working",
          prev_weight: data.prev_weight, prev_reps: data.prev_reps ?? 10,
          weight_lbs: null, reps: null, logged: false,
        }],
      };
      state.activeSession.exercises.push(newEx);
      const exIdx = state.activeSession.exercises.length - 1;
      const container = $("#active-exercises");
      container.insertAdjacentHTML("beforeend", buildExerciseBlock(newEx, exIdx));
      const newBlock = container.lastElementChild;
      // Bind events for this block only
      const addSetBtn = newBlock.querySelector(".add-set-btn");
      const removeBtn = newBlock.querySelector(".ex-remove-btn");
      if (addSetBtn) addSetBtn.addEventListener("click", () => {
        const lastSet = newEx.sets[newEx.sets.length - 1] ?? {};
        const s2 = { set_num: newEx.sets.length + 1, set_type: lastSet.set_type ?? "working", prev_weight: lastSet.prev_weight, prev_reps: lastSet.prev_reps ?? 10, weight_lbs: null, reps: null, logged: false };
        newEx.sets.push(s2);
        newBlock.querySelector(".set-rows").insertAdjacentHTML("beforeend", buildSetRow(s2, newEx));
        bindSetRowEvents(newBlock.querySelector(".set-rows").lastElementChild, newEx, s2, state.activeSession.exercises);
      });
      if (removeBtn) removeBtn.addEventListener("click", async () => {
        if (!confirm("Remove this exercise?")) return;
        try {
          await fetch(`${API}/training/exercises/${newEx.we_id}`, { method: "DELETE" });
          newBlock.remove();
          state.activeSession.exercises = state.activeSession.exercises.filter((e) => e.we_id !== newEx.we_id);
        } catch { toast("Couldn't remove"); }
      });
      newBlock.querySelectorAll(".set-row").forEach((row, i) => bindSetRowEvents(row, newEx, newEx.sets[i], state.activeSession.exercises));
      toast(`${name} added`);
    } catch { toast("Couldn't add exercise"); }

  } else if (pickerContext === "template" && currentTemplate) {
    try {
      const r = await fetch(`${API}/templates/${currentTemplate.id}/exercises`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exercise_id: exerciseId, default_sets: 3, default_reps: 10 }),
      });
      if (!r.ok) throw new Error();
      const data = await r.json();
      currentTemplate.exercises.push({
        te_id: data.id, exercise_id: exerciseId, name: data.name,
        muscle_group: data.muscle_group, equipment: data.equipment,
        default_sets: 3, default_reps: 10,
        order_idx: currentTemplate.exercises.length,
      });
      renderTemplateEditor(currentTemplate);
      toast(`${name} added`);
    } catch { toast("Couldn't add exercise"); }
  }
}

// ── Data Loading ──────────────────────────────────────────────────────────────
async function loadAll() {
  try {
    const r = await fetch(`${API}/briefing/today`);
    const data = await r.json();
    state.todos = data.todos || [];
    state.calendar = data.calendar || [];
    state.emails = data.emails || [];
    renderTodos(); renderCalendar(); renderEmails(); renderDashboard();
    setHeader();
  } catch { toast("Can't reach server"); }
}

async function loadNews(force = false) {
  try {
    const r = await fetch(`${API}/news${force ? "?force=true" : ""}`);
    state.news = await r.json();
    renderNews(); renderDashboard();
  } catch { renderNews(); }
}

async function loadTraining() {
  try {
    const r = await fetch(`${API}/training/next`);
    const data = await r.json();
    state.training = data;
    if (data.active_workout && !state.activeSession) {
      try {
        const ar = await fetch(`${API}/training/active`);
        const ad = await ar.json();
        if (ad.workout_id) state.activeSession = ad;
      } catch { /* silent */ }
    }
  } catch { /* silent */ }
}

async function loadProtein() {
  try {
    const r = await fetch(`${API}/protein/today`);
    state.protein = await r.json();
  } catch { /* silent */ }
}

// ── Boot ──────────────────────────────────────────────────────────────────────
async function boot() {
  showView("home");
  await Promise.all([loadAll(), loadTraining(), loadProtein()]);
  renderTraining();
  renderDashboard();
  loadNews();
}

boot();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
