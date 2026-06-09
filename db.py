"""TomOS API — SQLite layer."""

import os
import sqlite3
from pathlib import Path
from datetime import datetime

DATA_DIR = Path(os.environ.get("TOMOS_DATA_DIR", Path(__file__).parent))
DB_PATH = DATA_DIR / "tomos.db"

SPLIT_ORDER = ["Push", "Pull", "Legs", "Upper", "Lower"]

# ── Exercise seed data ────────────────────────────────────────────────────────
# (name, equipment, muscle_group, movement_pattern, is_compound)
EXERCISE_SEED = [
    # PUSH
    ("Flat Barbell Bench Press",        "barbell",    "chest",      "push_h",    1),
    ("Incline Barbell Bench Press",     "barbell",    "chest",      "push_h",    1),
    ("Incline Dumbbell Press",          "dumbbell",   "chest",      "push_h",    1),
    ("Dumbbell Flat Press",             "dumbbell",   "chest",      "push_h",    1),
    ("Cable Chest Fly (Low to High)",   "cable",      "chest",      "push_h",    0),
    ("Cable Chest Fly (High to Low)",   "cable",      "chest",      "push_h",    0),
    ("Chest Press Machine",             "machine",    "chest",      "push_h",    1),
    ("Overhead Press (Barbell)",        "barbell",    "shoulders",  "push_v",    1),
    ("Seated Dumbbell Shoulder Press",  "dumbbell",   "shoulders",  "push_v",    1),
    ("Dumbbell Lateral Raise",          "dumbbell",   "shoulders",  "isolation", 0),
    ("Cable Lateral Raise",             "cable",      "shoulders",  "isolation", 0),
    ("Tricep Pushdown (Rope)",          "cable",      "triceps",    "isolation", 0),
    ("Tricep Pushdown (Bar)",           "cable",      "triceps",    "isolation", 0),
    ("Overhead Tricep Extension",       "cable",      "triceps",    "isolation", 0),
    ("Skull Crusher (EZ Bar)",          "ez-bar",     "triceps",    "isolation", 0),
    ("Close-Grip Bench Press",          "barbell",    "triceps",    "push_h",    1),
    # PULL
    ("Deadlift",                        "barbell",    "back",       "hinge",     1),
    ("Romanian Deadlift",               "barbell",    "hamstrings", "hinge",     1),
    ("Barbell Row (Bent-Over)",         "barbell",    "back",       "pull_h",    1),
    ("Dumbbell Row (Single-Arm)",       "dumbbell",   "back",       "pull_h",    1),
    ("Cable Row (Seated, Close Grip)",  "cable",      "back",       "pull_h",    1),
    ("Cable Row (Seated, Wide Grip)",   "cable",      "back",       "pull_h",    1),
    ("Pull-Up (Overhand)",              "bodyweight", "back",       "pull_v",    1),
    ("Chin-Up (Underhand)",             "bodyweight", "back",       "pull_v",    1),
    ("Weighted Pull-Up",                "barbell",    "back",       "pull_v",    1),
    ("Lat Pulldown (Wide Grip)",        "cable",      "back",       "pull_v",    1),
    ("Lat Pulldown (Close Grip)",       "cable",      "back",       "pull_v",    1),
    ("Straight-Arm Lat Pulldown",       "cable",      "back",       "isolation", 0),
    ("Face Pull",                       "cable",      "shoulders",  "pull_h",    0),
    ("Rear Delt Fly (Dumbbell)",        "dumbbell",   "shoulders",  "isolation", 0),
    ("Rear Delt Fly (Machine)",         "machine",    "shoulders",  "isolation", 0),
    ("Barbell Curl",                    "barbell",    "biceps",     "isolation", 0),
    ("Dumbbell Curl",                   "dumbbell",   "biceps",     "isolation", 0),
    ("Hammer Curl",                     "dumbbell",   "biceps",     "isolation", 0),
    ("Preacher Curl (EZ Bar)",          "ez-bar",     "biceps",     "isolation", 0),
    ("Cable Curl",                      "cable",      "biceps",     "isolation", 0),
    ("Incline Dumbbell Curl",           "dumbbell",   "biceps",     "isolation", 0),
    ("Barbell Shrug",                   "barbell",    "back",       "isolation", 0),
    ("Dumbbell Shrug",                  "dumbbell",   "back",       "isolation", 0),
    # LEGS
    ("Barbell Back Squat",              "barbell",    "quads",      "squat",     1),
    ("Barbell Front Squat",             "barbell",    "quads",      "squat",     1),
    ("Leg Press",                       "machine",    "quads",      "squat",     1),
    ("Bulgarian Split Squat",           "dumbbell",   "quads",      "squat",     1),
    ("Hack Squat (Machine)",            "machine",    "quads",      "squat",     1),
    ("Goblet Squat",                    "dumbbell",   "quads",      "squat",     1),
    ("Romanian Deadlift (Dumbbell)",    "dumbbell",   "hamstrings", "hinge",     1),
    ("Lying Leg Curl",                  "machine",    "hamstrings", "isolation", 0),
    ("Seated Leg Curl",                 "machine",    "hamstrings", "isolation", 0),
    ("Nordic Hamstring Curl",           "bodyweight", "hamstrings", "isolation", 0),
    ("Leg Extension",                   "machine",    "quads",      "isolation", 0),
    ("Hip Thrust (Barbell)",            "barbell",    "glutes",     "hinge",     1),
    ("Cable Pull-Through",              "cable",      "glutes",     "hinge",     0),
    ("Barbell Walking Lunge",           "barbell",    "quads",      "squat",     1),
    ("Dumbbell Lunge",                  "dumbbell",   "quads",      "squat",     1),
    ("Standing Calf Raise",             "machine",    "calves",     "isolation", 0),
    ("Seated Calf Raise",               "machine",    "calves",     "isolation", 0),
    ("Sumo Deadlift",                   "barbell",    "glutes",     "hinge",     1),
    ("Trap Bar Deadlift",               "barbell",    "back",       "hinge",     1),
    # CORE / ACCESSORIES
    ("Cable Crunch",                    "cable",      "core",       "core",      0),
    ("Hanging Leg Raise",               "bodyweight", "core",       "core",      0),
    ("Plank",                           "bodyweight", "core",       "core",      0),
    ("Ab Wheel Rollout",                "none",       "core",       "core",      0),
    ("Dumbbell Fly",                    "dumbbell",   "chest",      "isolation", 0),
    ("Calf Raise",                      "machine",    "calves",     "isolation", 0),
]

# Template seed: (template_name, [(exercise_name, default_sets, default_reps), ...])
TEMPLATE_SEED = [
    ("Push", [
        ("Flat Barbell Bench Press",    4, 6),
        ("Overhead Press (Barbell)",    4, 8),
        ("Incline Dumbbell Press",      3, 10),
        ("Tricep Pushdown (Rope)",      3, 12),
        ("Dumbbell Lateral Raise",      3, 15),
    ]),
    ("Pull", [
        ("Deadlift",                    4, 5),
        ("Barbell Row (Bent-Over)",     4, 8),
        ("Pull-Up (Overhand)",          3, 8),
        ("Face Pull",                   3, 15),
        ("Barbell Curl",                3, 12),
    ]),
    ("Legs", [
        ("Barbell Back Squat",          4, 6),
        ("Romanian Deadlift",           4, 8),
        ("Leg Press",                   3, 10),
        ("Lying Leg Curl",              3, 12),
        ("Calf Raise",                  4, 15),
    ]),
    ("Upper", [
        ("Flat Barbell Bench Press",    4, 6),
        ("Barbell Row (Bent-Over)",     4, 8),
        ("Overhead Press (Barbell)",    3, 8),
        ("Dumbbell Fly",                3, 12),
        ("Barbell Curl",                3, 12),
    ]),
    ("Lower", [
        ("Barbell Back Squat",          4, 6),
        ("Romanian Deadlift",           4, 8),
        ("Leg Press",                   3, 10),
        ("Lying Leg Curl",              3, 12),
    ]),
]


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _alter_add(conn, table, column, definition):
    try:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
    except sqlite3.OperationalError:
        pass  # column already exists


def init_db():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = get_conn()

    conn.executescript("""
        CREATE TABLE IF NOT EXISTS todos (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            text          TEXT    NOT NULL,
            source        TEXT    NOT NULL DEFAULT 'briefing',
            done          INTEGER NOT NULL DEFAULT 0,
            created_at    TEXT    NOT NULL,
            done_at       TEXT,
            briefing_date TEXT
        );

        CREATE TABLE IF NOT EXISTS briefings (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            date        TEXT NOT NULL,
            emails_json TEXT,
            events_json TEXT,
            created_at  TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS exercises (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            name             TEXT NOT NULL UNIQUE,
            equipment        TEXT,
            muscle_group     TEXT,
            movement_pattern TEXT,
            is_compound      INTEGER DEFAULT 0,
            created_by       TEXT DEFAULT 'system'
        );

        CREATE TABLE IF NOT EXISTS workout_templates (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT NOT NULL,
            created_at  TEXT,
            updated_at  TEXT
        );

        CREATE TABLE IF NOT EXISTS template_exercises (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            template_id  INTEGER NOT NULL REFERENCES workout_templates(id) ON DELETE CASCADE,
            exercise_id  INTEGER NOT NULL REFERENCES exercises(id),
            order_idx    INTEGER NOT NULL DEFAULT 0,
            default_sets INTEGER NOT NULL DEFAULT 3,
            default_reps INTEGER NOT NULL DEFAULT 10
        );

        CREATE TABLE IF NOT EXISTS workouts (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            template_id   INTEGER REFERENCES workout_templates(id),
            session_name  TEXT NOT NULL,
            started_at    TEXT,
            completed_at  TEXT,
            notes         TEXT
        );

        CREATE TABLE IF NOT EXISTS workout_exercises (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            workout_id  INTEGER NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
            exercise_id INTEGER NOT NULL REFERENCES exercises(id),
            order_idx   INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS workout_sets (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            workout_id          INTEGER NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
            workout_exercise_id INTEGER REFERENCES workout_exercises(id),
            exercise_id         INTEGER REFERENCES exercises(id),
            exercise            TEXT,
            set_num             INTEGER NOT NULL,
            set_type            TEXT NOT NULL DEFAULT 'working',
            weight_lbs          REAL,
            reps                INTEGER,
            rpe                 REAL,
            logged_at           TEXT,
            is_pr               INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS protein_log (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            date        TEXT NOT NULL,
            food_name   TEXT NOT NULL,
            protein_g   REAL NOT NULL,
            logged_at   TEXT
        );
    """)
    conn.commit()
    # Migrate columns added after initial deploy
    _alter_add(conn, "workouts", "template_id", "INTEGER REFERENCES workout_templates(id)")
    _alter_add(conn, "workouts", "notes", "TEXT")
    _alter_add(conn, "workout_sets", "workout_exercise_id", "INTEGER REFERENCES workout_exercises(id)")
    _alter_add(conn, "workout_sets", "exercise_id", "INTEGER REFERENCES exercises(id)")
    _alter_add(conn, "workout_sets", "set_type", "TEXT NOT NULL DEFAULT 'working'")
    _alter_add(conn, "workout_sets", "rpe", "REAL")
    _alter_add(conn, "workout_sets", "is_pr", "INTEGER DEFAULT 0")
    conn.commit()
    seed_db(conn)
    conn.close()


def seed_db(conn):
    if conn.execute("SELECT COUNT(*) FROM exercises").fetchone()[0] > 0:
        return  # already seeded

    now = datetime.now().isoformat()

    # Seed exercises
    conn.executemany(
        "INSERT OR IGNORE INTO exercises(name, equipment, muscle_group, movement_pattern, is_compound) VALUES (?,?,?,?,?)",
        EXERCISE_SEED,
    )

    # Seed templates
    for tname, exercises in TEMPLATE_SEED:
        cur = conn.execute(
            "INSERT INTO workout_templates(name, created_at, updated_at) VALUES (?,?,?)",
            (tname, now, now),
        )
        tid = cur.lastrowid
        for idx, (ename, sets, reps) in enumerate(exercises):
            row = conn.execute("SELECT id FROM exercises WHERE name=?", (ename,)).fetchone()
            if row:
                conn.execute(
                    "INSERT INTO template_exercises(template_id, exercise_id, order_idx, default_sets, default_reps) VALUES (?,?,?,?,?)",
                    (tid, row["id"], idx, sets, reps),
                )

    conn.commit()


if __name__ == "__main__":
    init_db()
    print(f"Initialized {DB_PATH}")
