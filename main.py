"""TomOS API — FastAPI backend for the Phase 2 app.

Three sections, per the approved plan:
  - Emails   (screened highlights, read-only)
  - Calendar (next 7 days, read-only)
  - To-Do    (action items, checkable, persisted in SQLite)

Pull/screening logic lives in pull.py (shared with the laptop briefing). A
built-in scheduler runs the pull daily so the app stays fresh in the cloud with
no laptop involved.
"""

import os
import json
from pathlib import Path
from datetime import datetime
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

import pull
import db

STATIC_DIR = Path(__file__).parent / "static"
# Hour (0-23) to run the automatic daily pull in the cloud.
PULL_HOUR = int(os.environ.get("TOMOS_PULL_HOUR", "8"))

scheduler = BackgroundScheduler()


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    # Daily automatic pull — keeps the app fresh without the laptop.
    scheduler.add_job(
        run_pull,
        CronTrigger(hour=PULL_HOUR, minute=0),
        id="daily_pull",
        replace_existing=True,
        misfire_grace_time=3600,
    )
    scheduler.start()
    try:
        yield
    finally:
        scheduler.shutdown(wait=False)


app = FastAPI(title="TomOS API", version="0.2.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Serialization ─────────────────────────────────────────────────────────────

def _serialize_event(e: dict) -> dict:
    return {
        "summary": e.get("summary", "(No title)"),
        "start": e["start"].get("dateTime", e["start"].get("date", "")),
        "end": e.get("end", {}).get("dateTime", e.get("end", {}).get("date", "")),
        "location": e.get("location", ""),
    }


# ── Core pull (used by /refresh AND the scheduler) ────────────────────────────

def run_pull() -> dict:
    cal, gmail = pull.services()
    events = pull.get_events(cal)
    raw_emails = pull.get_emails(gmail)
    flagged, actions = pull.analyze(raw_emails, events)

    today = datetime.now().strftime("%Y-%m-%d")
    now = datetime.now().isoformat()

    conn = db.get_conn()
    conn.execute(
        "INSERT INTO briefings(date, emails_json, events_json, created_at) "
        "VALUES (?, ?, ?, ?)",
        (today, json.dumps(flagged), json.dumps([_serialize_event(e) for e in events]), now),
    )
    open_texts = {
        r["text"] for r in conn.execute("SELECT text FROM todos WHERE done=0").fetchall()
    }
    added = 0
    for a in actions:
        if a not in open_texts:
            conn.execute(
                "INSERT INTO todos(text, source, done, created_at, briefing_date) "
                "VALUES (?, 'briefing', 0, ?, ?)",
                (a, now, today),
            )
            added += 1
    conn.commit()
    conn.close()

    return {
        "events": len(events),
        "flagged_emails": len(flagged),
        "actions_extracted": len(actions),
        "todos_added": added,
    }


# ── Models ───────────────────────────────────────────────────────────────────

class TodoPatch(BaseModel):
    done: bool


# ── Health ───────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    job = scheduler.get_job("daily_pull")
    return {
        "ok": True,
        "service": "tomos-api",
        "next_pull": job.next_run_time.isoformat() if job and job.next_run_time else None,
    }


# ── PWA shell ────────────────────────────────────────────────────────────────

@app.get("/")
def root():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/sw.js")
def service_worker():
    return FileResponse(STATIC_DIR / "sw.js", media_type="application/javascript")


@app.get("/manifest.json")
def manifest():
    return FileResponse(STATIC_DIR / "manifest.json", media_type="application/manifest+json")


# ── To-Do ────────────────────────────────────────────────────────────────────

@app.get("/todos")
def list_todos():
    conn = db.get_conn()
    rows = conn.execute("SELECT * FROM todos ORDER BY done ASC, created_at DESC").fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.patch("/todos/{todo_id}")
def patch_todo(todo_id: int, patch: TodoPatch):
    conn = db.get_conn()
    if not conn.execute("SELECT id FROM todos WHERE id=?", (todo_id,)).fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="todo not found")
    done_at = datetime.now().isoformat() if patch.done else None
    conn.execute(
        "UPDATE todos SET done=?, done_at=? WHERE id=?",
        (1 if patch.done else 0, done_at, todo_id),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM todos WHERE id=?", (todo_id,)).fetchone()
    conn.close()
    return dict(row)


# ── Calendar ─────────────────────────────────────────────────────────────────

@app.get("/calendar")
def calendar():
    cal, _ = pull.services()
    return [_serialize_event(e) for e in pull.get_events(cal)]


# ── Emails ───────────────────────────────────────────────────────────────────

@app.get("/emails")
def emails():
    conn = db.get_conn()
    row = conn.execute(
        "SELECT emails_json FROM briefings ORDER BY created_at DESC LIMIT 1"
    ).fetchone()
    conn.close()
    if not row or not row["emails_json"]:
        return []
    return json.loads(row["emails_json"])


# ── Refresh (manual trigger of the same pull the scheduler runs) ──────────────

@app.post("/refresh")
def refresh():
    return run_pull()


# ── Combined view for the app home ───────────────────────────────────────────

@app.get("/briefing/today")
def briefing_today():
    cal, _ = pull.services()
    events = [_serialize_event(e) for e in pull.get_events(cal)]
    return {
        "date": datetime.now().strftime("%Y-%m-%d"),
        "todos": list_todos(),
        "emails": emails(),
        "calendar": events,
    }


# Static assets (css, js, icons). Mounted last so explicit routes win.
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
