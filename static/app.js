// TomOS PWA — talks to the FastAPI backend on the same origin.
const API = ""; // same origin

const $ = (sel) => document.querySelector(sel);
const view = {
  todo: $("#todo"),
  news: $("#news"),
  calendar: $("#calendar"),
  emails: $("#emails"),
};

let state = { todos: [], news: [], calendar: [], emails: [] };

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
  const dateOnly = iso.length <= 10; // all-day event
  const opts = dateOnly
    ? { weekday: "short", month: "short", day: "numeric" }
    : { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };
  return d.toLocaleString(undefined, opts);
}

// ── Renderers ────────────────────────────────────────────────────────────
function renderTodos() {
  const t = state.todos;
  if (!t.length) {
    view.todo.innerHTML = emptyState("✓", "No action items yet. Hit ⟳ to pull your latest.");
    return;
  }
  const open = t.filter((x) => !x.done).length;
  view.todo.innerHTML =
    `<div class="section-label">${open} open · ${t.length - open} done</div>` +
    t
      .map(
        (item) => `
      <div class="todo ${item.done ? "done" : ""}" data-id="${item.id}">
        <div class="box"></div>
        <div class="text">${esc(item.text)}
          ${item.briefing_date ? `<span class="meta">${esc(item.briefing_date)}</span>` : ""}
        </div>
      </div>`
      )
      .join("");

  view.todo.querySelectorAll(".todo").forEach((el) =>
    el.addEventListener("click", () => toggleTodo(Number(el.dataset.id)))
  );
  setHeader();
}

function relTime(iso) {
  const mins = Math.round((Date.now() - new Date(iso)) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return hrs < 24 ? `${hrs}h ago` : `${Math.round(hrs / 24)}d ago`;
}

function renderNews() {
  const n = state.news;
  if (!n || !n.length) {
    view.news.innerHTML = emptyState("📰", "No fresh headlines right now.");
    return;
  }
  view.news.innerHTML =
    `<div class="section-label">Top headlines · past 24h</div>` +
    n
      .map(
        (a) => `
      <a class="card news" href="${esc(a.url)}" target="_blank" rel="noopener">
        <div class="news-meta"><span class="src">${esc(a.source)}</span> · ${esc(relTime(a.published))}</div>
        <div class="news-title">${esc(a.title)}</div>
      </a>`
      )
      .join("");
}

function renderCalendar() {
  const c = state.calendar;
  if (!c.length) {
    view.calendar.innerHTML = emptyState("▦", "Nothing scheduled in the next 7 days.");
    return;
  }
  view.calendar.innerHTML =
    `<div class="section-label">Next 7 days</div>` +
    c
      .map(
        (e) => `
      <div class="card event">
        <div class="when">${esc(fmtEventDate(e.start))}</div>
        <div class="what">${esc(e.summary)}</div>
        ${e.location ? `<div class="where">${esc(e.location)}</div>` : ""}
      </div>`
      )
      .join("");
}

function renderEmails() {
  const m = state.emails;
  if (!m.length) {
    view.emails.innerHTML = emptyState("✉", "No flagged emails. Hit ⟳ to screen your inbox.");
    return;
  }
  view.emails.innerHTML =
    `<div class="section-label">Flagged by Claude</div>` +
    m
      .map((e) => {
        const sender = (e.from || "").replace(/<.*?>/g, "").trim() || e.from || "Unknown";
        return `
      <div class="card email">
        <div class="from">${esc(sender)}</div>
        <div class="subject">${esc(e.subject)}</div>
        ${e.reason ? `<div class="reason">${esc(e.reason)}</div>` : ""}
      </div>`;
      })
      .join("");
}

function setHeader() {
  const now = new Date();
  const h = now.getHours();
  const part = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  const greetEl = document.getElementById("greeting");
  if (greetEl) greetEl.textContent = `${part}, Tom`;

  const date = now.toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric",
  });
  const open = state.todos.filter((t) => !t.done).length;
  const events = state.calendar.length;
  const bits = [date];
  bits.push(open ? `${open} open task${open === 1 ? "" : "s"}` : "all clear ✓");
  if (events) bits.push(`${events} event${events === 1 ? "" : "s"}`);
  const sub = document.getElementById("subline");
  if (sub) sub.textContent = bits.join("  ·  ");
}

function renderAll() {
  renderTodos();
  renderCalendar();
  renderEmails();
  setHeader();
}

// ── Data ─────────────────────────────────────────────────────────────────
async function loadTodos() {
  try {
    const r = await fetch(`${API}/todos`);
    state.todos = await r.json();
    renderTodos();
  } catch (e) {
    toast("Can't reach server");
  }
}

async function toggleTodo(id) {
  const item = state.todos.find((x) => x.id === id);
  if (!item) return;
  const next = !item.done;
  item.done = next; // optimistic
  renderTodos();
  try {
    const r = await fetch(`${API}/todos/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ done: next }),
    });
    if (!r.ok) throw new Error();
  } catch (e) {
    item.done = !next; // revert
    renderTodos();
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
    // Fall back to just todos (works without Google auth)
    await loadTodos();
    toast("Loaded to-dos (calendar/email need server auth)");
  }
}

async function loadNews(force = false) {
  try {
    const r = await fetch(`${API}/news${force ? "?force=true" : ""}`);
    state.news = await r.json();
    renderNews();
  } catch (e) {
    renderNews(); // shows empty state
  }
}

// ── Pop-down menu + scroll navigation ────────────────────────────────────
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
menu.querySelectorAll("a[data-jump]").forEach((a) =>
  a.addEventListener("click", () => setMenu(false))
);

$("#refresh").addEventListener("click", refresh);

// ── Boot ─────────────────────────────────────────────────────────────────
loadAll();
loadNews();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
