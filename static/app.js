// TomOS PWA — talks to the FastAPI backend on the same origin.
const API = ""; // same origin

const $ = (sel) => document.querySelector(sel);
const view = {
  todo: $("#todo"),
  calendar: $("#calendar"),
  emails: $("#emails"),
};

let state = { todos: [], calendar: [], emails: [] };

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

function renderAll() {
  renderTodos();
  renderCalendar();
  renderEmails();
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

// ── Tabs ─────────────────────────────────────────────────────────────────
document.querySelectorAll(".tab").forEach((tab) =>
  tab.addEventListener("click", () => {
    const name = tab.dataset.tab;
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === tab));
    document.querySelectorAll(".panel").forEach((p) =>
      p.classList.toggle("active", p.id === name)
    );
  })
);

$("#refresh").addEventListener("click", refresh);

// ── Boot ─────────────────────────────────────────────────────────────────
loadAll();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
