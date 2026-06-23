"""TomOS API — FastAPI backend."""

import os
import re
import json
import threading
from pathlib import Path
from datetime import datetime, date, timedelta
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

import pull
import db
import news

STATIC_DIR = Path(__file__).parent / "static"
PULL_HOUR = int(os.environ.get("TOMOS_PULL_HOUR", "8"))
PROTEIN_GOAL = 200
SPLIT_ORDER = db.SPLIT_ORDER

scheduler = BackgroundScheduler()


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    scheduler.add_job(run_pull, CronTrigger(hour=PULL_HOUR, minute=0),
                      id="daily_pull", replace_existing=True, misfire_grace_time=3600)
    scheduler.start()
    threading.Thread(target=news.get_news, daemon=True).start()
    try:
        yield
    finally:
        scheduler.shutdown(wait=False)


APP_VERSION = "0.9.0"
app = FastAPI(title="TomOS API", version=APP_VERSION, lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


# ── Helpers ───────────────────────────────────────────────────────────────────

def _norm(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", text.lower())


def _serialize_event(e: dict) -> dict:
    return {
        "summary": e.get("summary", "(No title)"),
        "start": e["start"].get("dateTime", e["start"].get("date", "")),
        "end": e.get("end", {}).get("dateTime", e.get("end", {}).get("date", "")),
        "location": e.get("location", ""),
    }


def _prev_for_exercise(conn, exercise_id: int) -> dict | None:
    """Most recent completed set data for this exercise (for PREVIOUS column)."""
    row = conn.execute("""
        SELECT ws.weight_lbs, ws.reps
        FROM workout_sets ws
        JOIN workouts w ON w.id = ws.workout_id
        WHERE ws.exercise_id = ? AND w.completed_at IS NOT NULL
          AND ws.set_type IN ('working','amrap','failure')
        ORDER BY w.completed_at DESC, ws.set_num ASC
        LIMIT 1
    """, (exercise_id,)).fetchone()
    return dict(row) if row else None


def _epley_1rm(weight, reps) -> float:
    if not weight or not reps or reps <= 0:
        return 0.0
    return float(weight) * (1 + float(reps) / 30)


def _build_session_exercises(conn, template_id: int, workout_id: int) -> list:
    """
    Create workout_exercises rows from a template and return the full exercise list
    with previous performance data for the PREVIOUS column.
    """
    template_exercises = conn.execute("""
        SELECT te.id as te_id, te.exercise_id, te.default_sets, te.default_reps,
               te.order_idx, e.name, e.is_compound
        FROM template_exercises te
        JOIN exercises e ON e.id = te.exercise_id
        WHERE te.template_id = ?
        ORDER BY te.order_idx
    """, (template_id,)).fetchall()

    result = []
    for idx, te in enumerate(template_exercises):
        cur = conn.execute(
            "INSERT INTO workout_exercises(workout_id, exercise_id, order_idx) VALUES (?,?,?)",
            (workout_id, te["exercise_id"], idx),
        )
        we_id = cur.lastrowid
        prev = _prev_for_exercise(conn, te["exercise_id"])
        sets = []
        for i in range(1, te["default_sets"] + 1):
            sets.append({
                "set_num": i,
                "set_type": "working",
                "prev_weight": prev["weight_lbs"] if prev else None,
                "prev_reps": prev["reps"] if prev else te["default_reps"],
                "weight_lbs": None,
                "reps": None,
                "logged": False,
            })
        result.append({
            "we_id": we_id,
            "exercise_id": te["exercise_id"],
            "name": te["name"],
            "is_compound": bool(te["is_compound"]),
            "default_sets": te["default_sets"],
            "default_reps": te["default_reps"],
            "sets": sets,
        })
    return result


# ── Briefing pull ─────────────────────────────────────────────────────────────

def run_pull() -> dict:
    cal, gmail = pull.services()
    events = pull.get_events(cal)
    raw_emails = pull.get_emails(gmail)
    flagged, actions = pull.analyze(raw_emails, events)

    today = datetime.now().strftime("%Y-%m-%d")
    now = datetime.now().isoformat()

    conn = db.get_conn()
    conn.execute(
        "INSERT INTO briefings(date, emails_json, events_json, created_at) VALUES (?,?,?,?)",
        (today, json.dumps(flagged), json.dumps([_serialize_event(e) for e in events]), now),
    )
    conn.execute("DELETE FROM todos WHERE source='briefing' AND done=0 AND briefing_date=?", (today,))
    skip = {
        _norm(r["text"])
        for r in conn.execute(
            "SELECT text FROM todos WHERE done=1 AND briefing_date=? "
            "UNION SELECT text FROM todos WHERE done=0", (today,),
        ).fetchall()
    }
    added = 0
    for a in actions:
        key = _norm(a)
        if key in skip:
            continue
        conn.execute(
            "INSERT INTO todos(text, source, done, created_at, briefing_date) VALUES (?,?,0,?,?)",
            (a, 'briefing', now, today),
        )
        skip.add(key)
        added += 1
    conn.commit()
    conn.close()
    return {"events": len(events), "flagged_emails": len(flagged), "actions_extracted": len(actions), "todos_added": added}


# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    job = scheduler.get_job("daily_pull")
    return {"ok": True, "service": "tomos-api", "version": APP_VERSION,
            "next_pull": job.next_run_time.isoformat() if job and job.next_run_time else None}


# ── PWA shell ─────────────────────────────────────────────────────────────────

@app.get("/")
def root():
    return FileResponse(STATIC_DIR / "index.html")

@app.get("/sw.js")
def service_worker():
    return FileResponse(STATIC_DIR / "sw.js", media_type="application/javascript")

@app.get("/manifest.json")
def manifest():
    return FileResponse(STATIC_DIR / "manifest.json", media_type="application/manifest+json")


# ── To-Do ─────────────────────────────────────────────────────────────────────

class TodoCreate(BaseModel):
    text: str

class TodoPatch(BaseModel):
    done: bool

@app.get("/todos")
def list_todos():
    conn = db.get_conn()
    rows = conn.execute("SELECT * FROM todos ORDER BY done ASC, created_at DESC").fetchall()
    conn.close()
    return [dict(r) for r in rows]

@app.post("/todos")
def create_todo(body: TodoCreate):
    if not body.text.strip():
        raise HTTPException(status_code=400, detail="text required")
    now = datetime.now().isoformat()
    today = date.today().isoformat()
    conn = db.get_conn()
    cur = conn.execute(
        "INSERT INTO todos(text, source, done, created_at, briefing_date) VALUES (?,?,0,?,?)",
        (body.text.strip(), "manual", now, today),
    )
    row = conn.execute("SELECT * FROM todos WHERE id=?", (cur.lastrowid,)).fetchone()
    conn.commit()
    conn.close()
    return dict(row)

@app.patch("/todos/{todo_id}")
def patch_todo(todo_id: int, patch: TodoPatch):
    conn = db.get_conn()
    if not conn.execute("SELECT id FROM todos WHERE id=?", (todo_id,)).fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="todo not found")
    done_at = datetime.now().isoformat() if patch.done else None
    conn.execute("UPDATE todos SET done=?, done_at=? WHERE id=?", (1 if patch.done else 0, done_at, todo_id))
    conn.commit()
    row = conn.execute("SELECT * FROM todos WHERE id=?", (todo_id,)).fetchone()
    conn.close()
    return dict(row)

@app.delete("/todos/{todo_id}")
def delete_todo(todo_id: int):
    conn = db.get_conn()
    if not conn.execute("SELECT id FROM todos WHERE id=?", (todo_id,)).fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="not found")
    conn.execute("DELETE FROM todos WHERE id=?", (todo_id,))
    conn.commit()
    conn.close()
    return {"ok": True}


# ── Calendar ──────────────────────────────────────────────────────────────────

@app.get("/calendar")
def calendar():
    cal, _ = pull.services()
    return [_serialize_event(e) for e in pull.get_events(cal)]


# ── Emails ────────────────────────────────────────────────────────────────────

@app.get("/news")
def news_endpoint(force: bool = False):
    return news.get_news(force=force)

@app.get("/emails")
def emails():
    conn = db.get_conn()
    row = conn.execute("SELECT emails_json FROM briefings ORDER BY created_at DESC LIMIT 1").fetchone()
    conn.close()
    if not row or not row["emails_json"]:
        return []
    return json.loads(row["emails_json"])


# ── Refresh ───────────────────────────────────────────────────────────────────

@app.post("/refresh")
def refresh():
    return run_pull()


# ── Combined briefing ─────────────────────────────────────────────────────────

@app.get("/briefing/today")
def briefing_today():
    cal, _ = pull.services()
    events = [_serialize_event(e) for e in pull.get_events(cal)]
    conn = db.get_conn()
    rows = conn.execute("SELECT * FROM todos ORDER BY done ASC, created_at DESC").fetchall()
    em_row = conn.execute("SELECT emails_json FROM briefings ORDER BY created_at DESC LIMIT 1").fetchone()
    conn.close()
    return {
        "date": datetime.now().strftime("%Y-%m-%d"),
        "todos": [dict(r) for r in rows],
        "emails": json.loads(em_row["emails_json"]) if em_row and em_row["emails_json"] else [],
        "calendar": events,
    }


# ── Exercise Library ──────────────────────────────────────────────────────────

class ExerciseCreate(BaseModel):
    name: str
    equipment: Optional[str] = None
    muscle_group: Optional[str] = None
    movement_pattern: Optional[str] = None
    is_compound: bool = False

@app.get("/exercises")
def list_exercises(
    q: Optional[str] = Query(None),
    group: Optional[str] = Query(None),
    equipment: Optional[str] = Query(None),
):
    conn = db.get_conn()
    sql = "SELECT * FROM exercises WHERE 1=1"
    params: list = []
    if q:
        sql += " AND name LIKE ?"
        params.append(f"%{q}%")
    if group:
        sql += " AND muscle_group = ?"
        params.append(group)
    if equipment:
        sql += " AND equipment = ?"
        params.append(equipment)
    sql += " ORDER BY name"
    rows = conn.execute(sql, params).fetchall()
    conn.close()
    return [dict(r) for r in rows]

@app.post("/exercises")
def create_exercise(body: ExerciseCreate):
    conn = db.get_conn()
    try:
        cur = conn.execute(
            "INSERT INTO exercises(name, equipment, muscle_group, movement_pattern, is_compound, created_by) VALUES (?,?,?,?,?,?)",
            (body.name, body.equipment, body.muscle_group, body.movement_pattern, 1 if body.is_compound else 0, "user"),
        )
        row_id = cur.lastrowid
        conn.commit()
        row = conn.execute("SELECT * FROM exercises WHERE id=?", (row_id,)).fetchone()
        conn.close()
        return dict(row)
    except Exception:
        conn.close()
        raise HTTPException(status_code=409, detail="Exercise name already exists")

@app.get("/exercises/{exercise_id}/history")
def exercise_history(exercise_id: int):
    conn = db.get_conn()
    rows = conn.execute("""
        SELECT ws.*, w.session_name, w.completed_at as workout_date
        FROM workout_sets ws
        JOIN workouts w ON w.id = ws.workout_id
        WHERE ws.exercise_id = ? AND w.completed_at IS NOT NULL
          AND ws.set_type IN ('working','amrap','failure')
        ORDER BY w.completed_at DESC, ws.set_num ASC
        LIMIT 20
    """, (exercise_id,)).fetchall()
    conn.close()
    return [dict(r) for r in rows]


# ── Workout Templates ─────────────────────────────────────────────────────────

class TemplateExerciseAdd(BaseModel):
    exercise_id: int
    default_sets: int = 3
    default_reps: int = 10

class TemplateExercisePatch(BaseModel):
    default_sets: Optional[int] = None
    default_reps: Optional[int] = None
    order_idx: Optional[int] = None

@app.get("/templates")
def list_templates():
    conn = db.get_conn()
    rows = conn.execute("""
        SELECT wt.*, COUNT(te.id) as exercise_count
        FROM workout_templates wt
        LEFT JOIN template_exercises te ON te.template_id = wt.id
        GROUP BY wt.id ORDER BY wt.id
    """).fetchall()
    conn.close()
    return [dict(r) for r in rows]

@app.get("/templates/{template_id}")
def get_template(template_id: int):
    conn = db.get_conn()
    tmpl = conn.execute("SELECT * FROM workout_templates WHERE id=?", (template_id,)).fetchone()
    if not tmpl:
        conn.close()
        raise HTTPException(status_code=404, detail="template not found")
    exercises = conn.execute("""
        SELECT te.id as te_id, te.exercise_id, te.order_idx, te.default_sets, te.default_reps,
               e.name, e.equipment, e.muscle_group, e.is_compound
        FROM template_exercises te
        JOIN exercises e ON e.id = te.exercise_id
        WHERE te.template_id = ?
        ORDER BY te.order_idx
    """, (template_id,)).fetchall()
    conn.close()
    return {**dict(tmpl), "exercises": [dict(r) for r in exercises]}

@app.post("/templates/{template_id}/exercises")
def add_template_exercise(template_id: int, body: TemplateExerciseAdd):
    conn = db.get_conn()
    if not conn.execute("SELECT id FROM workout_templates WHERE id=?", (template_id,)).fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="template not found")
    if not conn.execute("SELECT id FROM exercises WHERE id=?", (body.exercise_id,)).fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="exercise not found")
    max_idx = conn.execute(
        "SELECT COALESCE(MAX(order_idx),0)+1 FROM template_exercises WHERE template_id=?", (template_id,)
    ).fetchone()[0]
    cur = conn.execute(
        "INSERT INTO template_exercises(template_id, exercise_id, order_idx, default_sets, default_reps) VALUES (?,?,?,?,?)",
        (template_id, body.exercise_id, max_idx, body.default_sets, body.default_reps),
    )
    conn.execute("UPDATE workout_templates SET updated_at=? WHERE id=?", (datetime.now().isoformat(), template_id))
    conn.commit()
    te_id = cur.lastrowid
    row = conn.execute("""
        SELECT te.*, e.name, e.equipment, e.muscle_group FROM template_exercises te
        JOIN exercises e ON e.id = te.exercise_id WHERE te.id=?
    """, (te_id,)).fetchone()
    conn.close()
    return dict(row)

@app.delete("/templates/{template_id}/exercises/{te_id}")
def remove_template_exercise(template_id: int, te_id: int):
    conn = db.get_conn()
    if not conn.execute("SELECT id FROM template_exercises WHERE id=? AND template_id=?", (te_id, template_id)).fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="not found")
    conn.execute("DELETE FROM template_exercises WHERE id=?", (te_id,))
    conn.execute("UPDATE workout_templates SET updated_at=? WHERE id=?", (datetime.now().isoformat(), template_id))
    conn.commit()
    conn.close()
    return {"ok": True}

@app.patch("/templates/{template_id}/exercises/{te_id}")
def patch_template_exercise(template_id: int, te_id: int, body: TemplateExercisePatch):
    conn = db.get_conn()
    row = conn.execute("SELECT * FROM template_exercises WHERE id=? AND template_id=?", (te_id, template_id)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="not found")
    sets = body.default_sets if body.default_sets is not None else row["default_sets"]
    reps = body.default_reps if body.default_reps is not None else row["default_reps"]
    idx = body.order_idx if body.order_idx is not None else row["order_idx"]
    conn.execute("UPDATE template_exercises SET default_sets=?, default_reps=?, order_idx=? WHERE id=?", (sets, reps, idx, te_id))
    conn.execute("UPDATE workout_templates SET updated_at=? WHERE id=?", (datetime.now().isoformat(), template_id))
    conn.commit()
    conn.close()
    return {"ok": True, "default_sets": sets, "default_reps": reps, "order_idx": idx}


# ── Training — Session ────────────────────────────────────────────────────────

class TrainingStart(BaseModel):
    template_id: Optional[int] = None

class SessionExerciseAdd(BaseModel):
    workout_id: int
    exercise_id: int

class SetLog(BaseModel):
    workout_exercise_id: int
    set_num: int
    set_type: str = "working"
    weight_lbs: Optional[float] = None
    reps: Optional[int] = None
    rpe: Optional[float] = None

class SetPatch(BaseModel):
    weight_lbs: Optional[float] = None
    reps: Optional[int] = None
    set_type: Optional[str] = None

class WorkoutComplete(BaseModel):
    workout_id: int
    notes: Optional[str] = None


def _next_template(conn) -> dict | None:
    last = conn.execute(
        "SELECT session_name FROM workouts WHERE completed_at IS NOT NULL ORDER BY completed_at DESC LIMIT 1"
    ).fetchone()
    if last and last["session_name"] in SPLIT_ORDER:
        idx = SPLIT_ORDER.index(last["session_name"])
        next_name = SPLIT_ORDER[(idx + 1) % len(SPLIT_ORDER)]
    else:
        next_name = SPLIT_ORDER[0]
    tmpl = conn.execute("SELECT * FROM workout_templates WHERE name=?", (next_name,)).fetchone()
    return dict(tmpl) if tmpl else None


@app.get("/training/next")
def training_next():
    conn = db.get_conn()
    active = conn.execute(
        "SELECT * FROM workouts WHERE completed_at IS NULL ORDER BY started_at DESC LIMIT 1"
    ).fetchone()
    next_tmpl = _next_template(conn)
    conn.close()
    return {
        "next_template": next_tmpl,
        "active_workout": dict(active) if active else None,
    }


@app.post("/training/start")
def training_start(body: TrainingStart):
    conn = db.get_conn()
    active = conn.execute("SELECT id FROM workouts WHERE completed_at IS NULL").fetchone()
    if active:
        conn.close()
        raise HTTPException(status_code=409, detail="session already active")

    if body.template_id:
        tmpl = conn.execute("SELECT * FROM workout_templates WHERE id=?", (body.template_id,)).fetchone()
    else:
        tmpl_dict = _next_template(conn)
        tmpl = conn.execute("SELECT * FROM workout_templates WHERE id=?", (tmpl_dict["id"],)).fetchone() if tmpl_dict else None

    if not tmpl:
        conn.close()
        raise HTTPException(status_code=404, detail="no template found")

    now = datetime.now().isoformat()
    cur = conn.execute(
        "INSERT INTO workouts(template_id, session_name, started_at) VALUES (?,?,?)",
        (tmpl["id"], tmpl["name"], now),
    )
    workout_id = cur.lastrowid
    exercises = _build_session_exercises(conn, tmpl["id"], workout_id)
    conn.commit()
    conn.close()
    return {"workout_id": workout_id, "session_name": tmpl["name"], "template_id": tmpl["id"],
            "started_at": now, "exercises": exercises}


@app.post("/training/exercises")
def add_session_exercise(body: SessionExerciseAdd):
    conn = db.get_conn()
    if not conn.execute("SELECT id FROM workouts WHERE id=? AND completed_at IS NULL", (body.workout_id,)).fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="active workout not found")
    ex = conn.execute("SELECT * FROM exercises WHERE id=?", (body.exercise_id,)).fetchone()
    if not ex:
        conn.close()
        raise HTTPException(status_code=404, detail="exercise not found")
    max_idx = conn.execute(
        "SELECT COALESCE(MAX(order_idx),0)+1 FROM workout_exercises WHERE workout_id=?", (body.workout_id,)
    ).fetchone()[0]
    cur = conn.execute(
        "INSERT INTO workout_exercises(workout_id, exercise_id, order_idx) VALUES (?,?,?)",
        (body.workout_id, body.exercise_id, max_idx),
    )
    we_id = cur.lastrowid
    conn.commit()
    prev = _prev_for_exercise(conn, body.exercise_id)
    conn.close()
    return {
        "we_id": we_id, "exercise_id": body.exercise_id, "name": ex["name"],
        "is_compound": bool(ex["is_compound"]),
        "prev_weight": prev["weight_lbs"] if prev else None,
        "prev_reps": prev["reps"] if prev else None,
        "sets": [],
    }


@app.delete("/training/exercises/{we_id}")
def remove_session_exercise(we_id: int):
    conn = db.get_conn()
    we = conn.execute("SELECT * FROM workout_exercises WHERE id=?", (we_id,)).fetchone()
    if not we:
        conn.close()
        raise HTTPException(status_code=404, detail="not found")
    conn.execute("DELETE FROM workout_sets WHERE workout_exercise_id=?", (we_id,))
    conn.execute("DELETE FROM workout_exercises WHERE id=?", (we_id,))
    conn.commit()
    conn.close()
    return {"ok": True}


@app.post("/training/sets")
def log_set(body: SetLog):
    conn = db.get_conn()
    we = conn.execute("SELECT * FROM workout_exercises WHERE id=?", (body.workout_exercise_id,)).fetchone()
    if not we:
        conn.close()
        raise HTTPException(status_code=404, detail="workout exercise not found")

    now = datetime.now().isoformat()
    is_pr = 0
    if body.weight_lbs and body.reps and body.set_type in ("working", "amrap", "failure"):
        new_1rm = _epley_1rm(body.weight_lbs, body.reps)
        best = conn.execute("""
            SELECT MAX(weight_lbs * (1 + reps / 30.0)) FROM workout_sets ws
            JOIN workouts w ON w.id = ws.workout_id
            WHERE ws.exercise_id = ? AND w.completed_at IS NOT NULL
              AND ws.set_type IN ('working','amrap','failure')
        """, (we["exercise_id"],)).fetchone()[0] or 0
        if new_1rm > best:
            is_pr = 1

    # Upsert — replace existing set if same exercise + set_num
    conn.execute("""
        INSERT OR REPLACE INTO workout_sets
          (workout_id, workout_exercise_id, exercise_id, set_num, set_type, weight_lbs, reps, rpe, logged_at, is_pr)
        VALUES (?,?,?,?,?,?,?,?,?,?)
    """, (we["workout_id"], body.workout_exercise_id, we["exercise_id"],
          body.set_num, body.set_type, body.weight_lbs, body.reps, body.rpe, now, is_pr))
    conn.commit()
    conn.close()
    return {"ok": True, "is_pr": bool(is_pr)}


@app.delete("/training/sets/{set_id}")
def delete_set(set_id: int):
    conn = db.get_conn()
    if not conn.execute("SELECT id FROM workout_sets WHERE id=?", (set_id,)).fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="not found")
    conn.execute("DELETE FROM workout_sets WHERE id=?", (set_id,))
    conn.commit()
    conn.close()
    return {"ok": True}


@app.patch("/training/sets/{set_id}")
def patch_set(set_id: int, body: SetPatch):
    conn = db.get_conn()
    row = conn.execute("SELECT * FROM workout_sets WHERE id=?", (set_id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="not found")
    w = body.weight_lbs if body.weight_lbs is not None else row["weight_lbs"]
    r = body.reps if body.reps is not None else row["reps"]
    t = body.set_type if body.set_type is not None else row["set_type"]
    conn.execute("UPDATE workout_sets SET weight_lbs=?, reps=?, set_type=? WHERE id=?", (w, r, t, set_id))
    conn.commit()
    conn.close()
    return {"ok": True}


@app.post("/training/complete")
def complete_workout(body: WorkoutComplete):
    conn = db.get_conn()
    if not conn.execute("SELECT id FROM workouts WHERE id=?", (body.workout_id,)).fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="workout not found")
    now = datetime.now().isoformat()
    conn.execute("UPDATE workouts SET completed_at=?, notes=? WHERE id=?", (now, body.notes, body.workout_id))
    conn.commit()
    next_tmpl = _next_template(conn)
    conn.close()
    return {"ok": True, "completed_at": now,
            "next_session": next_tmpl["name"] if next_tmpl else SPLIT_ORDER[0]}


@app.delete("/training/active")
def abandon_workout():
    conn = db.get_conn()
    active = conn.execute("SELECT id FROM workouts WHERE completed_at IS NULL").fetchone()
    if not active:
        conn.close()
        raise HTTPException(status_code=404, detail="no active session")
    conn.execute("DELETE FROM workout_sets WHERE workout_id=?", (active["id"],))
    conn.execute("DELETE FROM workout_exercises WHERE workout_id=?", (active["id"],))
    conn.execute("DELETE FROM workouts WHERE id=?", (active["id"],))
    conn.commit()
    conn.close()
    return {"ok": True}


@app.get("/training/active")
def get_active_workout():
    conn = db.get_conn()
    active = conn.execute(
        "SELECT * FROM workouts WHERE completed_at IS NULL ORDER BY started_at DESC LIMIT 1"
    ).fetchone()
    if not active:
        conn.close()
        return {"active_workout": None}

    workout_id = active["id"]
    wes = conn.execute("""
        SELECT we.id as we_id, we.exercise_id, we.order_idx,
               e.name, e.is_compound
        FROM workout_exercises we
        JOIN exercises e ON e.id = we.exercise_id
        WHERE we.workout_id = ?
        ORDER BY we.order_idx
    """, (workout_id,)).fetchall()

    exercises = []
    for we in wes:
        logged_sets = conn.execute(
            "SELECT * FROM workout_sets WHERE workout_exercise_id=? ORDER BY set_num",
            (we["we_id"],)
        ).fetchall()
        prev = _prev_for_exercise(conn, we["exercise_id"])
        if logged_sets:
            sets = [{"set_num": s["set_num"], "set_type": s["set_type"],
                     "weight_lbs": s["weight_lbs"], "reps": s["reps"],
                     "prev_weight": prev["weight_lbs"] if prev else None,
                     "prev_reps": prev["reps"] if prev else None,
                     "logged": True} for s in logged_sets]
        else:
            sets = [{"set_num": 1, "set_type": "working",
                     "prev_weight": prev["weight_lbs"] if prev else None,
                     "prev_reps": prev["reps"] if prev else 10,
                     "weight_lbs": None, "reps": None, "logged": False}]
        exercises.append({
            "we_id": we["we_id"], "exercise_id": we["exercise_id"],
            "name": we["name"], "is_compound": bool(we["is_compound"]),
            "default_sets": 3, "default_reps": 10, "sets": sets,
        })

    conn.close()
    return {"workout_id": workout_id, "session_name": active["session_name"],
            "template_id": active["template_id"], "started_at": active["started_at"],
            "exercises": exercises}


@app.get("/training/history")
def training_history():
    conn = db.get_conn()
    rows = conn.execute("""
        SELECT w.*,
               COUNT(ws.id) as total_sets,
               COALESCE(SUM(ws.weight_lbs * ws.reps), 0) as total_volume
        FROM workouts w
        LEFT JOIN workout_sets ws ON ws.workout_id = w.id
            AND ws.set_type IN ('working','amrap','failure')
            AND ws.weight_lbs IS NOT NULL AND ws.reps IS NOT NULL
        WHERE w.completed_at IS NOT NULL
        GROUP BY w.id
        ORDER BY w.completed_at DESC
        LIMIT 20
    """).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.get("/training/history/{workout_id}")
def training_history_detail(workout_id: int):
    conn = db.get_conn()
    workout = conn.execute(
        "SELECT * FROM workouts WHERE id=? AND completed_at IS NOT NULL", (workout_id,)
    ).fetchone()
    if not workout:
        conn.close()
        raise HTTPException(status_code=404, detail="workout not found")

    # Get exercises via workout_exercises (v0.9.0+ sessions)
    wes = conn.execute("""
        SELECT we.id as we_id, we.exercise_id, we.order_idx, e.name, e.muscle_group
        FROM workout_exercises we
        JOIN exercises e ON e.id = we.exercise_id
        WHERE we.workout_id = ?
        ORDER BY we.order_idx
    """, (workout_id,)).fetchall()

    exercises = []
    total_volume = 0
    total_sets = 0

    if wes:
        for we in wes:
            sets = conn.execute(
                "SELECT * FROM workout_sets WHERE workout_exercise_id=? ORDER BY set_num",
                (we["we_id"],)
            ).fetchall()
            sets_data = [dict(s) for s in sets]
            vol = sum((s["weight_lbs"] or 0) * (s["reps"] or 0) for s in sets_data
                      if s["set_type"] in ("working", "amrap", "failure"))
            total_volume += vol
            total_sets += len(sets_data)
            exercises.append({"name": we["name"], "muscle_group": we["muscle_group"],
                               "sets": sets_data, "volume": round(vol)})
    else:
        # Legacy session — sets stored without workout_exercise_id, grouped by exercise name
        sets = conn.execute(
            "SELECT * FROM workout_sets WHERE workout_id=? ORDER BY exercise, set_num",
            (workout_id,)
        ).fetchall()
        grouped = {}
        for s in sets:
            key = s["exercise"] or "Unknown"
            grouped.setdefault(key, []).append(dict(s))
        for name, ex_sets in grouped.items():
            vol = sum((s["weight_lbs"] or 0) * (s["reps"] or 0) for s in ex_sets
                      if s.get("set_type", "working") in ("working", "amrap", "failure"))
            total_volume += vol
            total_sets += len(ex_sets)
            exercises.append({"name": name, "muscle_group": None,
                               "sets": ex_sets, "volume": round(vol)})

    # Duration in minutes
    duration_mins = None
    if workout["started_at"] and workout["completed_at"]:
        try:
            start = datetime.fromisoformat(workout["started_at"])
            end = datetime.fromisoformat(workout["completed_at"])
            duration_mins = round((end - start).total_seconds() / 60)
        except Exception:
            pass

    conn.close()
    return {**dict(workout), "exercises": exercises,
            "total_volume": round(total_volume), "total_sets": total_sets,
            "duration_mins": duration_mins}


@app.get("/training/week")
def training_week(offset: int = Query(0)):
    today = date.today()
    monday = today - timedelta(days=today.weekday()) + timedelta(weeks=offset)
    sunday = monday + timedelta(days=6)
    conn = db.get_conn()
    rows = conn.execute("""
        SELECT w.id, w.session_name, w.completed_at, w.started_at,
               COUNT(ws.id) as total_sets,
               COALESCE(SUM(ws.weight_lbs * ws.reps), 0) as total_volume
        FROM workouts w
        LEFT JOIN workout_sets ws ON ws.workout_id = w.id
            AND ws.set_type IN ('working','amrap','failure')
            AND ws.weight_lbs IS NOT NULL AND ws.reps IS NOT NULL
        WHERE w.completed_at IS NOT NULL
          AND DATE(w.completed_at) >= ? AND DATE(w.completed_at) <= ?
        GROUP BY w.id
        ORDER BY w.completed_at ASC
    """, (monday.isoformat(), sunday.isoformat())).fetchall()
    conn.close()
    return {"week_start": monday.isoformat(), "week_end": sunday.isoformat(),
            "sessions": [dict(r) for r in rows]}


# ── Protein ───────────────────────────────────────────────────────────────────

class ProteinEntry(BaseModel):
    food_name: str
    protein_g: float

@app.get("/protein/today")
def protein_today():
    today = datetime.now().strftime("%Y-%m-%d")
    conn = db.get_conn()
    rows = conn.execute("SELECT * FROM protein_log WHERE date=? ORDER BY logged_at ASC", (today,)).fetchall()
    conn.close()
    total = sum(r["protein_g"] for r in rows)
    return {"date": today, "total_g": total, "goal_g": PROTEIN_GOAL, "entries": [dict(r) for r in rows]}

@app.post("/protein/log")
def protein_log(entry: ProteinEntry):
    today = datetime.now().strftime("%Y-%m-%d")
    now = datetime.now().isoformat()
    conn = db.get_conn()
    cur = conn.execute(
        "INSERT INTO protein_log(date, food_name, protein_g, logged_at) VALUES (?,?,?,?)",
        (today, entry.food_name, entry.protein_g, now),
    )
    row_id = cur.lastrowid
    conn.commit()
    conn.close()
    return {"id": row_id, "date": today, "food_name": entry.food_name, "protein_g": entry.protein_g}

@app.delete("/protein/log/{entry_id}")
def protein_delete(entry_id: int):
    conn = db.get_conn()
    if not conn.execute("SELECT id FROM protein_log WHERE id=?", (entry_id,)).fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="entry not found")
    conn.execute("DELETE FROM protein_log WHERE id=?", (entry_id,))
    conn.commit()
    conn.close()
    return {"ok": True}


# ── Nudges ────────────────────────────────────────────────────────────────────

@app.get("/nudges")
def get_nudges():
    conn = db.get_conn()
    nudges = []
    now = datetime.now()
    today = date.today().isoformat()
    hour = now.hour

    # Protein
    prow = conn.execute(
        "SELECT COALESCE(SUM(protein_g),0) as total FROM protein_log WHERE date=?", (today,)
    ).fetchone()
    protein_g = prow["total"] if prow else 0
    if hour >= 20 and protein_g < PROTEIN_GOAL * 0.8:
        nudges.append({"type": "warn", "title": "Protein behind tonight",
                       "body": f"{round(protein_g)}g logged — {PROTEIN_GOAL - round(protein_g)}g still to go."})
    elif hour >= 14 and protein_g < PROTEIN_GOAL * 0.5:
        nudges.append({"type": "warn", "title": "Protein lagging",
                       "body": f"Only {round(protein_g)}g by the afternoon. Aim for {PROTEIN_GOAL}g today."})

    # Training frequency
    last = conn.execute(
        "SELECT completed_at FROM workouts WHERE completed_at IS NOT NULL ORDER BY completed_at DESC LIMIT 1"
    ).fetchone()
    if last:
        try:
            last_dt = datetime.fromisoformat(last["completed_at"].split(".")[0])
            days_ago = (now - last_dt).days
            if days_ago >= 3:
                nudges.append({"type": "warn", "title": f"Training gap: {days_ago} days",
                               "body": "Consistency wins. Time to get back in the gym."})
            elif days_ago == 2:
                nudges.append({"type": "info", "title": "Second rest day",
                               "body": "Body's had time to recover — consider training today."})
        except Exception:
            pass
    else:
        nudges.append({"type": "info", "title": "No workouts logged yet",
                       "body": "Head to the Train tab to start your first session."})

    # Check-in priorities
    ci = conn.execute("SELECT p1 FROM daily_checkins WHERE date=?", (today,)).fetchone()
    if not ci or not ci["p1"]:
        nudges.append({"type": "info", "title": "Priorities not set today",
                       "body": "Open Daily Check-in to lock in your top 3."})

    # Sleep
    sleep = conn.execute("SELECT hours FROM sleep_log ORDER BY date DESC LIMIT 3").fetchall()
    if sleep:
        recent_avg = sum(r["hours"] for r in sleep) / len(sleep)
        if recent_avg < 7:
            nudges.append({"type": "warn", "title": f"Sleep avg: {recent_avg:.1f}h",
                           "body": "You've been under 7h recently. Prioritize sleep tonight."})

    conn.close()

    if not nudges:
        nudges.append({"type": "good", "title": "All good",
                       "body": "Protein on track, training consistent, priorities set. Keep it up."})
    return nudges


# ── Daily Check-in ────────────────────────────────────────────────────────────

class CheckinBody(BaseModel):
    p1: Optional[str] = None
    p2: Optional[str] = None
    p3: Optional[str] = None
    reflection: Optional[str] = None

@app.get("/checkin/today")
def checkin_today():
    today = date.today().isoformat()
    conn = db.get_conn()
    row = conn.execute("SELECT * FROM daily_checkins WHERE date=?", (today,)).fetchone()
    conn.close()
    if row:
        return dict(row)
    return {"date": today, "p1": None, "p2": None, "p3": None, "reflection": None}

@app.post("/checkin/today")
def save_checkin(body: CheckinBody):
    today = date.today().isoformat()
    now = datetime.now().isoformat()
    conn = db.get_conn()
    existing = conn.execute("SELECT id FROM daily_checkins WHERE date=?", (today,)).fetchone()
    if existing:
        conn.execute(
            "UPDATE daily_checkins SET p1=?, p2=?, p3=?, reflection=?, updated_at=? WHERE date=?",
            (body.p1, body.p2, body.p3, body.reflection, now, today),
        )
    else:
        conn.execute(
            "INSERT INTO daily_checkins(date, p1, p2, p3, reflection, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
            (today, body.p1, body.p2, body.p3, body.reflection, now, now),
        )
    conn.commit()
    row = conn.execute("SELECT * FROM daily_checkins WHERE date=?", (today,)).fetchone()
    conn.close()
    return dict(row)


# ── Finance ────────────────────────────────────────────────────────────────────

FINANCE_CATEGORIES = ["food", "coffee", "transport", "entertainment", "shopping", "health", "other"]

class FinanceEntry(BaseModel):
    amount: float
    category: str = "other"
    note: Optional[str] = None

@app.get("/finance/month")
def finance_month(year: int = Query(None), month: int = Query(None)):
    today = date.today()
    y = year or today.year
    m = month or today.month
    start = f"{y:04d}-{m:02d}-01"
    end = f"{y+1:04d}-01-01" if m == 12 else f"{y:04d}-{m+1:02d}-01"
    conn = db.get_conn()
    rows = conn.execute(
        "SELECT * FROM finance_log WHERE date >= ? AND date < ? ORDER BY logged_at DESC",
        (start, end),
    ).fetchall()
    by_cat = conn.execute(
        "SELECT category, ROUND(SUM(amount),2) as total FROM finance_log WHERE date >= ? AND date < ? GROUP BY category ORDER BY total DESC",
        (start, end),
    ).fetchall()
    conn.close()
    total = round(sum(r["amount"] for r in rows), 2)
    return {
        "year": y, "month": m, "total": total,
        "by_category": [{"category": r["category"], "total": r["total"]} for r in by_cat],
        "entries": [dict(r) for r in rows],
    }

@app.post("/finance/log")
def finance_log(entry: FinanceEntry):
    cat = entry.category if entry.category in FINANCE_CATEGORIES else "other"
    today = date.today().isoformat()
    now = datetime.now().isoformat()
    conn = db.get_conn()
    cur = conn.execute(
        "INSERT INTO finance_log(date, amount, category, note, logged_at) VALUES (?,?,?,?,?)",
        (today, round(entry.amount, 2), cat, entry.note, now),
    )
    row = conn.execute("SELECT * FROM finance_log WHERE id=?", (cur.lastrowid,)).fetchone()
    conn.commit()
    conn.close()
    return dict(row)

@app.delete("/finance/log/{entry_id}")
def finance_delete(entry_id: int):
    conn = db.get_conn()
    if not conn.execute("SELECT id FROM finance_log WHERE id=?", (entry_id,)).fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="not found")
    conn.execute("DELETE FROM finance_log WHERE id=?", (entry_id,))
    conn.commit()
    conn.close()
    return {"ok": True}

@app.get("/finance/weeks")
def finance_weeks(count: int = Query(8)):
    today = date.today()
    conn = db.get_conn()
    weeks = []
    for i in range(count - 1, -1, -1):
        monday = today - timedelta(days=today.weekday()) - timedelta(weeks=i)
        sunday = monday + timedelta(days=6)
        row = conn.execute(
            "SELECT COALESCE(SUM(amount), 0) as total FROM finance_log WHERE date >= ? AND date <= ?",
            (monday.isoformat(), sunday.isoformat()),
        ).fetchone()
        weeks.append({"week_start": monday.isoformat(), "total": round(row["total"], 2)})
    conn.close()
    return weeks

@app.get("/finance/months")
def finance_months(count: int = Query(6)):
    today = date.today()
    conn = db.get_conn()
    months = []
    for i in range(count - 1, -1, -1):
        # walk back i months from the current month
        m = today.month - i
        y = today.year
        while m <= 0:
            m += 12
            y -= 1
        start = f"{y:04d}-{m:02d}-01"
        nm = m + 1 if m < 12 else 1
        ny = y if m < 12 else y + 1
        end = f"{ny:04d}-{nm:02d}-01"
        row = conn.execute(
            "SELECT COALESCE(SUM(amount), 0) as total FROM finance_log WHERE date >= ? AND date < ?",
            (start, end),
        ).fetchone()
        months.append({"year": y, "month": m, "total": round(row["total"], 2)})
    conn.close()
    return months


# ── Sleep ──────────────────────────────────────────────────────────────────────

class SleepEntry(BaseModel):
    hours: float
    quality: Optional[int] = None
    note: Optional[str] = None

@app.get("/sleep/recent")
def sleep_recent(days: int = Query(7)):
    conn = db.get_conn()
    rows = conn.execute("SELECT * FROM sleep_log ORDER BY date DESC LIMIT ?", (days,)).fetchall()
    conn.close()
    data = [dict(r) for r in rows]
    avg = round(sum(r["hours"] for r in data) / len(data), 1) if data else None
    return {"entries": data, "avg_hours": avg}

@app.post("/sleep/log")
def sleep_log_entry(entry: SleepEntry):
    if entry.hours <= 0 or entry.hours > 24:
        raise HTTPException(status_code=400, detail="hours must be 0-24")
    today = date.today().isoformat()
    now = datetime.now().isoformat()
    conn = db.get_conn()
    existing = conn.execute("SELECT id FROM sleep_log WHERE date=?", (today,)).fetchone()
    if existing:
        conn.execute(
            "UPDATE sleep_log SET hours=?, quality=?, note=?, logged_at=? WHERE date=?",
            (entry.hours, entry.quality, entry.note, now, today),
        )
    else:
        conn.execute(
            "INSERT INTO sleep_log(date, hours, quality, note, logged_at) VALUES (?,?,?,?,?)",
            (today, entry.hours, entry.quality, entry.note, now),
        )
    conn.commit()
    row = conn.execute("SELECT * FROM sleep_log WHERE date=?", (today,)).fetchone()
    conn.close()
    return dict(row)


# Static assets — mounted last so explicit routes win.
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
