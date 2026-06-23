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
  checkin: null,    // { date, p1, p2, p3, reflection }
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
  nudges: "Nudges", finance: "Finance", sleep: "Sleep",
  "template-editor": "Edit Template",
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
  if (name === "checkin") loadCheckin();
  if (name === "nudges")  loadNudges();
  if (name === "finance") loadFinance();
  if (name === "sleep")   loadSleep();
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
      <div class="dash-body">${(() => {
        const c = state.checkin;
        const filled = [c?.p1, c?.p2, c?.p3].filter(Boolean).length;
        if (filled === 3) return `<span style="color:var(--accent)">All 3 priorities set ✓</span>`;
        if (filled > 0) return `${filled} of 3 priorities set · tap to continue`;
        return "Set today's top 3 · evening reflection";
      })()}</div>
    </button>`,
    `<button class="dash" data-view="finance">
      <div class="dash-top"><span class="dash-label">$ Finance</span><span class="arrow">›</span></div>
      <div class="dash-body">${financeData ? `$${financeData.total.toFixed(2)} spent this month` : "Track your spending"}</div>
    </button>`,
    `<button class="dash" data-view="sleep">
      <div class="dash-top"><span class="dash-label">◗ Sleep</span><span class="arrow">›</span></div>
      <div class="dash-body">${sleepData?.avg_hours != null ? `${sleepData.avg_hours}h avg · tap to log last night` : "Log your sleep"}</div>
    </button>`,
  ];
  $("#dash").innerHTML = cards.join("");
  bindDashTaps();
}

// ── To-Do ─────────────────────────────────────────────────────────────────────
function renderTodos() {
  const t = state.todos;
  if (!t.length) { $("#todo").innerHTML = emptyState("✓", "No tasks yet — add one above or hit ⟳ to pull from Gmail."); return; }
  const open = t.filter((x) => !x.done).length;
  $("#todo").innerHTML = `<div class="section-label">${open} open · ${t.length - open} done</div>` +
    t.map((item) => `<div class="todo ${item.done ? "done" : ""}" data-id="${item.id}">
      <div class="box"></div>
      <div class="text">${esc(item.text)}${item.briefing_date ? `<span class="meta">${esc(item.briefing_date)}</span>` : ""}</div>
      ${item.source === "manual" ? `<button class="del-btn" data-id="${item.id}" title="Delete">×</button>` : ""}
    </div>`).join("");
  $$("#todo .todo").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target.classList.contains("del-btn")) return;
      toggleTodo(Number(el.dataset.id));
    });
  });
  $$("#todo .del-btn").forEach((btn) => btn.addEventListener("click", () => deleteTodo(Number(btn.dataset.id))));
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

async function createTodo(text) {
  if (!text.trim()) return;
  try {
    const r = await fetch(`${API}/todos`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text.trim() }),
    });
    if (!r.ok) throw new Error();
    const item = await r.json();
    state.todos.unshift(item);
    renderTodos(); renderDashboard();
    const inp = $("#todo-new-input");
    if (inp) inp.value = "";
  } catch { toast("Couldn't create task"); }
}

async function deleteTodo(id) {
  try {
    await fetch(`${API}/todos/${id}`, { method: "DELETE" });
    state.todos = state.todos.filter((x) => x.id !== id);
    renderTodos(); renderDashboard();
  } catch { toast("Couldn't delete task"); }
}

$("#todo-new-btn").addEventListener("click", () => createTodo($("#todo-new-input").value));
$("#todo-new-input").addEventListener("keydown", (e) => { if (e.key === "Enter") createTodo($("#todo-new-input").value); });

// ── News / Calendar / Emails ───────────────────────────────────────────────────
// Brand color per outlet so the source panel reads at a glance.
const NEWS_BRANDS = {
  "BBC": "#bb1919",
  "NPR": "#2b6cb0",
  "The Guardian": "#052962",
  "Al Jazeera": "#c8731a",
};

function newsSourceChip(a) {
  const color = NEWS_BRANDS[a.source] || "var(--accent)";
  const fav = a.domain
    ? `<img class="news-fav" src="https://www.google.com/s2/favicons?domain=${encodeURIComponent(a.domain)}&sz=64" alt="" loading="lazy" onerror="this.remove()">`
    : "";
  return `<span class="news-src" style="--brand:${color}">${fav}${esc(a.source)}</span>`;
}

function renderNews() {
  const n = state.news;
  if (!n?.length) { $("#news").innerHTML = emptyState("📰", "No fresh headlines right now."); return; }
  $("#news").innerHTML = `<div class="section-label">Top headlines · past 24h</div>` +
    n.map((a) => {
      const img = a.image
        ? `<div class="news-img"><img src="${esc(a.image)}" alt="" loading="lazy" onerror="this.closest('.news-img').remove()"></div>`
        : "";
      return `<a class="card news" href="${esc(a.url)}" target="_blank" rel="noopener">
        ${img}
        <div class="news-body">
          <div class="news-meta">${newsSourceChip(a)}<span class="news-time">${esc(relTime(a.published))}</span></div>
          <div class="news-title">${esc(a.title)}</div>
        </div>
      </a>`;
    }).join("");
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

  loadWeekView(0);
}

// ── Week calendar ─────────────────────────────────────────────────────────────
let weekOffset = 0;
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// Locale-safe YYYY-MM-DD from a local Date object
function dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Parse an ISO timestamp that may have no timezone (stored as server local time)
// Returns a local Date by stripping sub-second precision then treating as-is
function parseTs(ts) {
  return new Date(ts.slice(0, 19).replace("T", "T")); // trim microseconds
}

async function loadWeekView(offset) {
  weekOffset = offset;
  $("#week-next").disabled = offset >= 0;
  try {
    const r = await fetch(`${API}/training/week?offset=${offset}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    renderWeekView(data);
  } catch (err) {
    console.error("loadWeekView failed:", err);
    const el = $("#week-days");
    if (el) el.innerHTML = `<div style="grid-column:1/-1;color:var(--muted);font-size:12px;text-align:center">Couldn't load week</div>`;
  }
}

function renderWeekView(data) {
  const sessions = data.sessions || [];

  // Parse week bounds as local dates (add noon to avoid DST edge)
  const [sy, sm, sd] = data.week_start.split("-").map(Number);
  const [ey, em, ed] = data.week_end.split("-").map(Number);
  const weekStart = new Date(sy, sm - 1, sd, 12, 0, 0);
  const weekEnd   = new Date(ey, em - 1, ed, 12, 0, 0);

  // Week label e.g. "Jun 8 – 14" or "Jun 30 – Jul 6"
  const fmtDay = (d) => `${MONTH_ABBR[d.getMonth()]} ${d.getDate()}`;
  const label = weekStart.getMonth() === weekEnd.getMonth()
    ? `${fmtDay(weekStart)} – ${weekEnd.getDate()}`
    : `${fmtDay(weekStart)} – ${fmtDay(weekEnd)}`;
  $("#week-label").textContent = label;

  // Build date → session map using locale-independent keys
  const todayKey = dateKey(new Date());
  const dayMap = {};
  sessions.forEach((s) => {
    const d = parseTs(s.completed_at);
    dayMap[dateKey(d)] = s;
  });

  // 7 day slots Mon–Sun
  const slots = DAY_NAMES.map((name, i) => {
    const d = new Date(sy, sm - 1, sd + i, 12, 0, 0);
    const key = dateKey(d);
    return { name, key, session: dayMap[key] || null, isToday: key === todayKey };
  });

  $("#week-days").innerHTML = slots.map(({ name, session, isToday }) => {
    const cls = isToday ? " today" : "";
    if (session) {
      const abbr = esc(session.session_name.slice(0, 2));
      return `<div class="day-slot">
        <div class="day-name${cls}">${name}</div>
        <button class="day-circle" data-id="${session.id}">${abbr}</button>
        <div class="day-session-label done">${esc(session.session_name)}</div>
      </div>`;
    }
    return `<div class="day-slot">
      <div class="day-name${cls}">${name}</div>
      <div class="day-circle"></div>
      <div class="day-session-label">—</div>
    </div>`;
  }).join("");

  $("#week-days").querySelectorAll("button.day-circle").forEach((btn) =>
    btn.addEventListener("click", () => openWorkoutDetail(Number(btn.dataset.id)))
  );

  // Summary
  const totalSets = sessions.reduce((a, s) => a + (s.total_sets || 0), 0);
  const totalVol  = sessions.reduce((a, s) => a + (s.total_volume || 0), 0);
  if (!sessions.length) {
    $("#week-summary").innerHTML = `<span class="week-empty">No sessions this week</span>`;
  } else {
    const parts = [`${sessions.length} session${sessions.length !== 1 ? "s" : ""}`];
    if (totalSets) parts.push(`${totalSets} sets`);
    if (totalVol)  parts.push(`${totalVol >= 1000 ? (totalVol / 1000).toFixed(1) + "k" : Math.round(totalVol)} lbs`);
    $("#week-summary").textContent = parts.join(" · ");
  }
}

$("#week-prev").addEventListener("click", () => loadWeekView(weekOffset - 1));
$("#week-next").addEventListener("click", () => loadWeekView(weekOffset + 1));

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

// ── Nudges ────────────────────────────────────────────────────────────────────
async function loadNudges() {
  try {
    const r = await fetch(`${API}/nudges`);
    if (!r.ok) throw new Error();
    const data = await r.json();
    renderNudges(data);
  } catch {
    $("#nudges-list").innerHTML = emptyState("✦", "Couldn't load nudges.");
  }
}

function renderNudges(nudges) {
  if (!nudges.length) { $("#nudges-list").innerHTML = emptyState("✦", "No nudges right now."); return; }
  $("#nudges-list").innerHTML = nudges.map((n) =>
    `<div class="card nudge-card ${n.type}">
      <div class="nudge-title">${esc(n.title)}</div>
      <div class="nudge-body">${esc(n.body)}</div>
    </div>`
  ).join("");
}

// ── Finance (redesigned) ──────────────────────────────────────────────────────
const FINANCE_CATS = [
  { id: "food",          label: "Food",          icon: "🍔", color: "#f97316" },
  { id: "coffee",        label: "Coffee",         icon: "☕", color: "#c084fc" },
  { id: "transport",     label: "Transport",      icon: "🚗", color: "#38bdf8" },
  { id: "entertainment", label: "Fun",            icon: "🎮", color: "#34d399" },
  { id: "shopping",      label: "Shopping",       icon: "🛍", color: "#fb7185" },
  { id: "health",        label: "Health",         icon: "💊", color: "#4ade80" },
  { id: "other",         label: "Other",          icon: "📦", color: "#94a3b8" },
];
const MONTH_NAMES_LONG  = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const MONTH_NAMES_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

let financeData   = null;
let financeWeeks  = null;
let financeMonths = null;
let finYear  = new Date().getFullYear();
let finMonth = new Date().getMonth() + 1;
let selectedFinanceCat = "food";
let finTrendMode = "weekly"; // "weekly" | "monthly"

function catMeta(id) {
  return FINANCE_CATS.find((c) => c.id === id) ?? FINANCE_CATS[FINANCE_CATS.length - 1];
}

// ── SVG helpers ───────────────────────────────────────────────────────────────
function polarToCart(cx, cy, r, deg) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function donutPath(cx, cy, R, r, startDeg, endDeg) {
  if (endDeg - startDeg >= 360) endDeg = startDeg + 359.99;
  const s  = polarToCart(cx, cy, R, startDeg);
  const e  = polarToCart(cx, cy, R, endDeg);
  const si = polarToCart(cx, cy, r, endDeg);
  const ei = polarToCart(cx, cy, r, startDeg);
  const lg = (endDeg - startDeg) > 180 ? 1 : 0;
  const f  = (n) => n.toFixed(2);
  return `M${f(s.x)},${f(s.y)} A${R},${R},0,${lg},1,${f(e.x)},${f(e.y)} L${f(si.x)},${f(si.y)} A${r},${r},0,${lg},0,${f(ei.x)},${f(ei.y)} Z`;
}

function drawDonut(byCategory, total) {
  const svg = $("#fin-donut");
  if (!svg) return;
  const cx = 100, cy = 100, R = 85, r = 58, GAP = 2;

  if (!total || !byCategory.length) {
    svg.innerHTML = `<circle cx="100" cy="100" r="85" fill="none" stroke="var(--surface-2)" stroke-width="27"/>`;
    return;
  }

  let cursor = 0;
  const paths = byCategory.map((c) => {
    const slice = (c.total / total) * 360;
    const start = cursor + GAP / 2;
    const end   = cursor + slice - GAP / 2;
    cursor += slice;
    const meta = catMeta(c.category);
    return `<path d="${donutPath(cx, cy, R, r, start, end)}" fill="${meta.color}" opacity="0.9"/>`;
  });
  svg.innerHTML = paths.join("");
}

function drawTrendBars(bars, labels) {
  const svg = $("#fin-trend-svg");
  if (!svg) return;
  const W = 320, H = 70, labelH = 20, barW = Math.floor(W / bars.length) - 4;
  const maxVal = Math.max(...bars, 1);

  const rects = bars.map((v, i) => {
    const bh = Math.max(3, Math.round((v / maxVal) * H));
    const x  = Math.round(i * (W / bars.length) + 2);
    const y  = H - bh;
    const opacity = i === bars.length - 1 ? "1" : "0.55";
    return `<rect x="${x}" y="${y}" width="${barW}" height="${bh}" rx="4" fill="var(--accent)" opacity="${opacity}"/>
            <text x="${x + barW / 2}" y="${H + labelH - 2}" text-anchor="middle" font-size="9" fill="var(--muted)" font-family="inherit">${esc(labels[i])}</text>`;
  });

  svg.setAttribute("viewBox", `0 0 ${W} ${H + labelH}`);
  svg.innerHTML = rects.join("");
}

// ── Finance load & render ─────────────────────────────────────────────────────
async function loadFinance() {
  try {
    const [mRes, wRes, moRes] = await Promise.all([
      fetch(`${API}/finance/month?year=${finYear}&month=${finMonth}`),
      fetch(`${API}/finance/weeks?count=8`),
      fetch(`${API}/finance/months?count=6`),
    ]);
    financeData   = mRes.ok  ? await mRes.json()  : null;
    financeWeeks  = wRes.ok  ? await wRes.json()  : null;
    financeMonths = moRes.ok ? await moRes.json() : null;
    renderFinance();
  } catch { toast("Couldn't load finance"); }
}

function renderFinance() {
  if (!financeData) return;
  const { year, month, total, by_category, entries } = financeData;
  const now = new Date();
  const isCurrent = year === now.getFullYear() && month === now.getMonth() + 1;

  // Period label + nav
  $("#fin-period-label").textContent = `${MONTH_NAMES_LONG[month - 1]} ${year}`;
  $("#fin-next").disabled = isCurrent;

  // Donut
  drawDonut(by_category, total);
  $("#fin-donut-total").textContent = `$${total.toFixed(0)}`;

  // Legend
  const legendEl = $("#fin-legend");
  if (legendEl) {
    legendEl.innerHTML = by_category.length
      ? by_category.map((c) => {
          const meta = catMeta(c.category);
          const pct  = total ? Math.round((c.total / total) * 100) : 0;
          return `<div class="fin-legend-item">
            <div class="fin-legend-dot" style="background:${meta.color}"></div>
            <div class="fin-legend-name">${meta.icon} ${meta.label}</div>
            <div class="fin-legend-pct">${pct}%</div>
            <div class="fin-legend-amt">$${c.total.toFixed(0)}</div>
          </div>`;
        }).join("")
      : `<div style="color:var(--muted);font-size:13px">Nothing logged yet</div>`;
  }

  // Trend chart
  renderTrendChart();

  // Transactions (grouped by date)
  const entriesEl = $("#finance-entries");
  if (!entries.length) { entriesEl.innerHTML = ""; return; }

  const byDate = {};
  entries.forEach((e) => {
    (byDate[e.date] = byDate[e.date] || []).push(e);
  });

  entriesEl.innerHTML = Object.entries(byDate).map(([dateStr, rows]) => {
    const d = new Date(dateStr + "T12:00:00");
    const label = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    const rowsHtml = rows.map((e) => {
      const meta = catMeta(e.category);
      return `<div class="fin-entry-row">
        <div class="fin-entry-icon">${meta.icon}</div>
        <div class="fin-entry-info">
          <div class="fin-entry-note">${esc(e.note || meta.label)}</div>
          <div class="fin-entry-cat" style="color:${meta.color}">${meta.label}</div>
        </div>
        <div class="fin-entry-amt">−$${Number(e.amount).toFixed(2)}</div>
        <button class="fin-entry-del" data-id="${e.id}">×</button>
      </div>`;
    }).join("");
    return `<div class="fin-date-group">
      <div class="fin-date-label">${esc(label)}</div>
      <div class="fin-entry-card">${rowsHtml}</div>
    </div>`;
  }).join("");

  entriesEl.querySelectorAll(".fin-entry-del").forEach((btn) =>
    btn.addEventListener("click", async () => {
      try {
        await fetch(`${API}/finance/log/${btn.dataset.id}`, { method: "DELETE" });
        await loadFinance();
      } catch { toast("Couldn't delete"); }
    })
  );
}

function renderTrendChart() {
  if (finTrendMode === "weekly" && financeWeeks) {
    const bars   = financeWeeks.map((w) => w.total);
    const labels = financeWeeks.map((w) => {
      const d = new Date(w.week_start + "T12:00:00");
      return `${MONTH_NAMES_SHORT[d.getMonth()]} ${d.getDate()}`;
    });
    drawTrendBars(bars, labels);
  } else if (finTrendMode === "monthly" && financeMonths) {
    const bars   = financeMonths.map((m) => m.total);
    const labels = financeMonths.map((m) => MONTH_NAMES_SHORT[m.month - 1]);
    drawTrendBars(bars, labels);
  }
}

// Period navigation
let _finPrevEl, _finNextEl;
function bindFinNav() {
  _finPrevEl = $("#fin-prev");
  _finNextEl = $("#fin-next");
  if (_finPrevEl) _finPrevEl.addEventListener("click", () => {
    finMonth--;
    if (finMonth < 1) { finMonth = 12; finYear--; }
    loadFinance();
  });
  if (_finNextEl) _finNextEl.addEventListener("click", () => {
    finMonth++;
    if (finMonth > 12) { finMonth = 1; finYear++; }
    loadFinance();
  });
}
bindFinNav();

// Trend toggle
const _weeklyBtn  = $("#fin-weekly-btn");
const _monthlyBtn = $("#fin-monthly-btn");
if (_weeklyBtn) _weeklyBtn.addEventListener("click", () => {
  finTrendMode = "weekly";
  _weeklyBtn.classList.add("active"); _monthlyBtn.classList.remove("active");
  renderTrendChart();
});
if (_monthlyBtn) _monthlyBtn.addEventListener("click", () => {
  finTrendMode = "monthly";
  _monthlyBtn.classList.add("active"); _weeklyBtn.classList.remove("active");
  renderTrendChart();
});

// Log modal
function openFinanceModal() {
  const chipsEl = $("#finance-cat-chips");
  chipsEl.innerHTML = FINANCE_CATS.map((c) =>
    `<button class="finance-cat-chip ${c.id === selectedFinanceCat ? "active" : ""}" data-cat="${c.id}">${c.icon} ${c.label}</button>`
  ).join("");
  chipsEl.querySelectorAll(".finance-cat-chip").forEach((btn) =>
    btn.addEventListener("click", () => {
      selectedFinanceCat = btn.dataset.cat;
      chipsEl.querySelectorAll(".finance-cat-chip").forEach((b) => b.classList.toggle("active", b === btn));
    })
  );
  $("#finance-amount").value = "";
  $("#finance-note").value = "";
  $("#finance-modal").hidden = false;
  setTimeout(() => $("#finance-amount").focus(), 80);
}
function closeFinanceModal() { $("#finance-modal").hidden = true; }

$("#fin-log-fab").addEventListener("click", openFinanceModal);
$("#finance-modal-close").addEventListener("click", closeFinanceModal);
$("#finance-modal-cancel").addEventListener("click", closeFinanceModal);
$("#finance-modal-log").addEventListener("click", async () => {
  const amount = parseFloat($("#finance-amount").value);
  if (!amount || amount <= 0) { toast("Enter an amount"); return; }
  const note = $("#finance-note").value.trim() || null;
  try {
    await fetch(`${API}/finance/log`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount, category: selectedFinanceCat, note }),
    });
    closeFinanceModal();
    toast(`$${amount.toFixed(2)} logged`);
    await loadFinance();
    renderDashboard();
  } catch { toast("Couldn't log expense"); }
});

// ── Sleep ──────────────────────────────────────────────────────────────────────
let sleepData = null;
let sleepQuality = 0;

async function loadSleep() {
  try {
    const r = await fetch(`${API}/sleep/recent?days=7`);
    if (!r.ok) throw new Error();
    sleepData = await r.json();
    renderSleep();
  } catch { /* silent */ }
}

function renderSleep() {
  if (!sleepData) return;
  const { entries, avg_hours } = sleepData;

  $("#sleep-avg").textContent = avg_hours != null ? `${avg_hours}h` : "—";

  // Pre-fill today's logged value if it exists
  const todayKey = dateKey(new Date());
  const todayEntry = entries.find((e) => e.date === todayKey);
  if (todayEntry) {
    const inp = $("#sleep-hours");
    if (inp && document.activeElement !== inp) inp.value = todayEntry.hours;
    sleepQuality = todayEntry.quality ?? 0;
    renderSleepStars();
  }

  // 7-day bar chart (Mon–Sun of the current week)
  const barsEl = $("#sleep-bars");
  const maxH = 10;
  const today = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const bars = DAY_NAMES.map((name, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const key = dateKey(d);
    const entry = entries.find((e) => e.date === key);
    const h = entry?.hours ?? 0;
    const heightPct = h ? Math.min(100, Math.round((h / maxH) * 100)) : 0;
    const cls = !h ? "" : h >= 7.5 ? "good" : h >= 6 ? "mid" : "low";
    return `<div class="sleep-bar-slot">
      <div class="sleep-bar ${cls}" style="height:${heightPct}%"></div>
      <div class="sleep-bar-label">${name}</div>
    </div>`;
  });
  barsEl.innerHTML = bars.join("");
}

function renderSleepStars() {
  const el = $("#sleep-stars");
  if (!el) return;
  el.innerHTML = [1,2,3,4,5].map((n) =>
    `<button class="sleep-star ${n <= sleepQuality ? "active" : ""}" data-q="${n}">${n}</button>`
  ).join("");
  el.querySelectorAll(".sleep-star").forEach((btn) =>
    btn.addEventListener("click", () => {
      sleepQuality = Number(btn.dataset.q);
      renderSleepStars();
    })
  );
}

$("#sleep-log-btn").addEventListener("click", async () => {
  const hours = parseFloat($("#sleep-hours").value);
  if (!hours || hours <= 0 || hours > 24) { toast("Enter valid hours (e.g. 7.5)"); return; }
  try {
    await fetch(`${API}/sleep/log`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hours, quality: sleepQuality || null }),
    });
    toast(`${hours}h logged`);
    await loadSleep();
  } catch { toast("Couldn't log sleep"); }
});

// ── Daily Check-in ────────────────────────────────────────────────────────────
let ciSaveTimer = null;

async function loadCheckin() {
  try {
    const r = await fetch(`${API}/checkin/today`);
    if (!r.ok) throw new Error();
    state.checkin = await r.json();
    renderCheckin();
  } catch { /* silent — view still usable */ }
}

function renderCheckin() {
  const c = state.checkin;
  if (!c) return;
  const p1 = $("#ci-p1"); if (p1 && document.activeElement !== p1) p1.value = c.p1 ?? "";
  const p2 = $("#ci-p2"); if (p2 && document.activeElement !== p2) p2.value = c.p2 ?? "";
  const p3 = $("#ci-p3"); if (p3 && document.activeElement !== p3) p3.value = c.p3 ?? "";
  const ref = $("#ci-reflection"); if (ref && document.activeElement !== ref) ref.value = c.reflection ?? "";
  updateCheckinStatus();
}

function updateCheckinStatus() {
  const p1 = ($("#ci-p1")?.value ?? "").trim();
  const p2 = ($("#ci-p2")?.value ?? "").trim();
  const p3 = ($("#ci-p3")?.value ?? "").trim();
  const filled = [p1, p2, p3].filter(Boolean).length;
  const el = $("#ci-status");
  if (!el) return;
  el.textContent = filled === 3 ? "All 3 priorities set ✓" : filled > 0 ? `${filled} of 3 priorities set` : "";
}

async function saveCheckin() {
  const body = {
    p1: ($("#ci-p1")?.value ?? "").trim() || null,
    p2: ($("#ci-p2")?.value ?? "").trim() || null,
    p3: ($("#ci-p3")?.value ?? "").trim() || null,
    reflection: ($("#ci-reflection")?.value ?? "").trim() || null,
  };
  try {
    const r = await fetch(`${API}/checkin/today`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error();
    state.checkin = await r.json();
    updateCheckinStatus();
    renderDashboard();
    const el = $("#ci-status");
    if (el) { el.textContent = (el.textContent || "Saved") + " · saved"; setTimeout(() => updateCheckinStatus(), 1500); }
  } catch { /* silent — will retry on next blur */ }
}

function scheduleSave() {
  clearTimeout(ciSaveTimer);
  ciSaveTimer = setTimeout(saveCheckin, 800);
}

["ci-p1", "ci-p2", "ci-p3", "ci-reflection"].forEach((id) => {
  const el = $(`#${id}`);
  if (el) {
    el.addEventListener("input", () => { updateCheckinStatus(); scheduleSave(); });
    el.addEventListener("blur", () => { clearTimeout(ciSaveTimer); saveCheckin(); });
  }
});

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
  renderSleepStars(); // render stars before DOM is active so listeners bind
  await Promise.all([loadAll(), loadTraining(), loadProtein(), loadCheckin()]);
  renderTraining();
  renderDashboard();
  loadNews();
}

boot();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
