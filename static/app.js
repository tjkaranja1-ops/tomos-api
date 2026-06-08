// TomOS PWA — command-center home + full-screen drill-in detail views.
const API = ""; // same origin

const $ = (sel) => document.querySelector(sel);
const view = {
  todo: $("#todo"),
  news: $("#news"),
  calendar: $("#calendar"),
  emails: $("#emails"),
};

let state = { todos: [], news: [], calendar: [], emails: [] };
let currentView = "home";

const TITLES = {
  home: "TomOS", todo: "To-Do", news: "News", checkin: "Daily Check-in",
  training: "Health & Training", nudges: "Proactive Nudges",
  calendar: "Calendar", emails: "Emails",
};
const TEMPLATE_VIEWS = new Set(["checkin", "training", "nudges"]);

// ── Helpers ──────────────────────────────────────────────────────────────
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), 2200);
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
  const opts = dateOnly
    ? { weekday: "short", month: "short", day: "numeric" }
    : { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };
  return d.toLocaleString(undefined, opts);
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

// ── Detail renderers ─────────────────────────────────────────────────────
function renderTodos() {
  const t = state.todos;
  if (!t.length) {
    view.todo.innerHTML = emptyState("✓", "No action items yet. Hit ⟳ to pull your latest.");
    return;
  }
  const open = t.filter((x) => !x.done).length;
  view.todo.innerHTML =
    `<div class="section-label">${open} open · ${t.length - open} done</div>` +
    t.map((item) => `
      <div class="todo ${item.done ? "done" : ""}" data-id="${item.id}">
        <div class="box"></div>
        <div class="text">${esc(item.text)}
          ${item.briefing_date ? `<span class="meta">${esc(item.briefing_date)}</span>` : ""}
        </div>
      </div>`).join("");
  view.todo.querySelectorAll(".todo").forEach((el) =>
    el.addEventListener("click", () => toggleTodo(Number(el.dataset.id)))
  );
}

function renderNews() {
  const n = state.news;
  if (!n || !n.length) {
    view.news.innerHTML = emptyState("📰", "No fresh headlines right now.");
    return;
  }
  view.news.innerHTML =
    `<div class="section-label">Top headlines · past 24h</div>` +
    n.map((a) => `
      <a class="card news" href="${esc(a.url)}" target="_blank" rel="noopener">
        <div class="news-meta"><span class="src">${esc(a.source)}</span> · ${esc(relTime(a.published))}</div>
        <div class="news-title">${esc(a.title)}</div>
      </a>`).join("");
}

function renderCalendar() {
  const c = state.calendar;
  if (!c.length) {
    view.calendar.innerHTML = emptyState("▦", "Nothing scheduled in the next 7 days.");
    return;
  }
  view.calendar.innerHTML =
    `<div class="section-label">Next 7 days</div>` +
    c.map((e) => `
      <div class="card event">
        <div class="when">${esc(fmtEventDate(e.start))}</div>
        <div class="what">${esc(e.summary)}</div>
        ${e.location ? `<div class="where">${esc(e.location)}</div>` : ""}
      </div>`).join("");
}

function renderEmails() {
  const m = state.emails;
  if (!m.length) {
    view.emails.innerHTML = emptyState("✉", "No flagged emails. Hit ⟳ to screen your inbox.");
    return;
  }
  view.emails.innerHTML =
    `<div class="section-label">Flagged by Claude</div>` +
    m.map((e) => `
      <div class="card email">
        <div class="from">${esc(senderName(e.from))}</div>
        <div class="subject">${esc(e.subject)}</div>
        ${e.reason ? `<div class="reason">${esc(e.reason)}</div>` : ""}
      </div>`).join("");
}

// ── Home dashboard ───────────────────────────────────────────────────────
function renderDashboard() {
  const open = state.todos.filter((t) => !t.done);
  const top = open.slice(0, 3);
  const ev = state.calendar[0];
  const headline = state.news[0];
  const em = state.emails[0];

  const cards = [];

  cards.push(`
    <button class="dash hero" data-view="todo">
      <div class="dash-top"><span class="dash-label">Today</span><span class="arrow">›</span></div>
      ${top.length
        ? `<ul class="hero-list">${top.map((t) => `<li>○ ${esc(t.text)}</li>`).join("")}</ul>`
        : `<div class="hero-clear">No open tasks — all clear ✓</div>`}
      <div class="hero-next">${ev ? `▦ ${esc(ev.summary)} · ${esc(fmtEventDate(ev.start))}` : "▦ Nothing scheduled"}</div>
    </button>`);

  cards.push(`
    <button class="dash" data-view="training">
      <div class="dash-top"><span class="dash-label">🏋 Training</span><span class="arrow">›</span></div>
      <div class="dash-body">Push day · <span class="hl">84 / 200g protein</span></div>
      <div class="protein-bar mini"><i style="width:42%"></i></div>
    </button>`);

  cards.push(`
    <button class="dash" data-view="news">
      <div class="dash-top"><span class="dash-label">📰 News</span><span class="badge">${state.news.length || "…"}</span></div>
      <div class="dash-body">${headline ? esc(headline.title) : "Loading headlines…"}</div>
    </button>`);

  cards.push(`
    <button class="dash" data-view="nudges">
      <div class="dash-top"><span class="dash-label">⚡ Nudges</span><span class="badge warn">2</span></div>
      <div class="dash-body">Protein behind · no lift logged yet</div>
    </button>`);

  cards.push(`
    <button class="dash" data-view="emails">
      <div class="dash-top"><span class="dash-label">✉ Emails</span><span class="badge">${state.emails.length || 0}</span></div>
      <div class="dash-body">${em ? esc(senderName(em.from)) + " · " + esc(em.subject) : "Nothing flagged"}</div>
    </button>`);

  cards.push(`
    <button class="dash" data-view="checkin">
      <div class="dash-top"><span class="dash-label">◎ Daily Check-in</span><span class="arrow">›</span></div>
      <div class="dash-body">Set today's top 3 · evening reflection</div>
    </button>`);

  $("#dash").innerHTML = cards.join("");
  $("#dash").querySelectorAll(".dash").forEach((el) =>
    el.addEventListener("click", () => showView(el.dataset.view))
  );
}

function setHeader() {
  const now = new Date();
  const h = now.getHours();
  const part = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  $("#greeting").textContent = `${part}, Tom`;
  const date = now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const openCount = state.todos.filter((t) => !t.done).length;
  const bits = [date, openCount ? `${openCount} open task${openCount === 1 ? "" : "s"}` : "all clear ✓"];
  if (state.calendar.length) bits.push(`${state.calendar.length} event${state.calendar.length === 1 ? "" : "s"}`);
  $("#subline").textContent = bits.join("  ·  ");
}

function renderAll() {
  renderTodos();
  renderNews();
  renderCalendar();
  renderEmails();
  renderDashboard();
  if (currentView === "home") setHeader();
}

// ── Data ─────────────────────────────────────────────────────────────────
async function loadTodos() {
  try {
    const r = await fetch(`${API}/todos`);
    state.todos = await r.json();
    renderTodos();
    renderDashboard();
  } catch (e) {
    toast("Can't reach server");
  }
}

async function toggleTodo(id) {
  const item = state.todos.find((x) => x.id === id);
  if (!item) return;
  const next = !item.done;
  item.done = next;
  renderTodos();
  renderDashboard();
  if (currentView === "home") setHeader();
  try {
    const r = await fetch(`${API}/todos/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ done: next }),
    });
    if (!r.ok) throw new Error();
  } catch (e) {
    item.done = !next;
    renderTodos();
    renderDashboard();
    toast("Couldn't save — try again");
  }
}

async function refresh() {
  const btn = $("#refresh");
  btn.classList.add("spin");
  toast("Pulling Gmail + Calendar…");
  try {
    const r = await fetch(`${API}/refresh`, { method: "POST" });
    if (!r.ok) throw new Error();
    const data = await r.json();
    await loadAll();
    loadNews(true);
    toast(`${data.todos_added} new to-do${data.todos_added === 1 ? "" : "s"} · ${data.events} events`);
  } catch (e) {
    toast("Refresh failed — is the server running?");
  } finally {
    btn.classList.remove("spin");
  }
}

async function loadAll() {
  try {
    const r = await fetch(`${API}/briefing/today`);
    const data = await r.json();
    state.todos = data.todos || [];
    state.calendar = data.calendar || [];
    state.emails = data.emails || [];
    renderAll();
  } catch (e) {
    await loadTodos();
    toast("Loaded to-dos (calendar/email need server auth)");
  }
}

async function loadNews(force = false) {
  try {
    const r = await fetch(`${API}/news${force ? "?force=true" : ""}`);
    state.news = await r.json();
    renderNews();
    renderDashboard();
  } catch (e) {
    renderNews();
  }
}

// ── View router ──────────────────────────────────────────────────────────
function showView(name) {
  currentView = name;
  document.querySelectorAll(".view").forEach((v) =>
    v.classList.toggle("active", v.id === `view-${name}`)
  );
  const onHome = name === "home";
  $("#backBtn").hidden = onHome;
  if (onHome) {
    setHeader();
  } else {
    $("#greeting").textContent = TITLES[name] || "TomOS";
    $("#subline").textContent = TEMPLATE_VIEWS.has(name) ? "Template — not live data yet" : "";
  }
  setMenu(false);
  window.scrollTo({ top: 0 });
}

// ── Pop-down menu + back + refresh ───────────────────────────────────────
const menuBtn = $("#menuBtn");
const menu = $("#menu");
const scrim = $("#scrim");

function setMenu(open) {
  menu.classList.toggle("open", open);
  scrim.classList.toggle("show", open);
  menuBtn.classList.toggle("active", open);
}

menuBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  setMenu(!menu.classList.contains("open"));
});
scrim.addEventListener("click", () => setMenu(false));
menu.querySelectorAll("a[data-view]").forEach((a) =>
  a.addEventListener("click", (e) => {
    e.preventDefault();
    showView(a.dataset.view);
  })
);
$("#backBtn").addEventListener("click", () => showView("home"));
$("#refresh").addEventListener("click", refresh);

// ── Boot ─────────────────────────────────────────────────────────────────
showView("home");
loadAll();
loadNews();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
