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

    # ── EXPANSION: common movements ──────────────────────────────────────────
    # CHEST
    ("Decline Barbell Bench Press",     "barbell",    "chest",      "push_h",    1),
    ("Push-Up",                         "bodyweight", "chest",      "push_h",    1),
    ("Weighted Dip (Chest)",            "bodyweight", "chest",      "push_h",    1),
    ("Pec Deck Machine",                "machine",    "chest",      "isolation", 0),
    ("Incline Cable Fly",               "cable",      "chest",      "isolation", 0),
    ("Smith Machine Bench Press",       "machine",    "chest",      "push_h",    1),
    ("Svend Press",                     "plate",      "chest",      "isolation", 0),
    # SHOULDERS
    ("Arnold Press",                    "dumbbell",   "shoulders",  "push_v",    1),
    ("Machine Shoulder Press",          "machine",    "shoulders",  "push_v",    1),
    ("Upright Row (Cable)",             "cable",      "shoulders",  "pull_v",    0),
    ("Front Raise (Dumbbell)",          "dumbbell",   "shoulders",  "isolation", 0),
    ("Plate Front Raise",               "plate",      "shoulders",  "isolation", 0),
    ("Landmine Press",                  "barbell",    "shoulders",  "push_v",    1),
    ("Cable Y-Raise",                   "cable",      "shoulders",  "isolation", 0),
    # TRICEPS
    ("Dip (Triceps)",                   "bodyweight", "triceps",    "push_v",    1),
    ("Cable Overhead Extension (Rope)", "cable",      "triceps",    "isolation", 0),
    ("Dumbbell Skull Crusher",          "dumbbell",   "triceps",    "isolation", 0),
    ("Bench Dip",                       "bodyweight", "triceps",    "push_v",    0),
    ("JM Press",                        "barbell",    "triceps",    "push_h",    1),
    # BACK
    ("T-Bar Row",                       "barbell",    "back",       "pull_h",    1),
    ("Chest-Supported Row (Machine)",   "machine",    "back",       "pull_h",    1),
    ("Pendlay Row",                     "barbell",    "back",       "pull_h",    1),
    ("Meadows Row",                     "barbell",    "back",       "pull_h",    1),
    ("Inverted Row",                    "bodyweight", "back",       "pull_h",    1),
    ("Rack Pull",                       "barbell",    "back",       "hinge",     1),
    ("Seal Row",                        "dumbbell",   "back",       "pull_h",    1),
    ("Wide-Grip Pull-Up",               "bodyweight", "back",       "pull_v",    1),
    # BICEPS
    ("EZ Bar Curl",                     "ez-bar",     "biceps",     "isolation", 0),
    ("Concentration Curl",              "dumbbell",   "biceps",     "isolation", 0),
    ("Spider Curl",                     "dumbbell",   "biceps",     "isolation", 0),
    ("Cable Hammer Curl (Rope)",        "cable",      "biceps",     "isolation", 0),
    ("Reverse Curl",                    "barbell",    "biceps",     "isolation", 0),
    ("Bayesian Cable Curl",             "cable",      "biceps",     "isolation", 0),
    # QUADS
    ("Smith Machine Squat",             "machine",    "quads",      "squat",     1),
    ("Pause Squat",                     "barbell",    "quads",      "squat",     1),
    ("Box Squat",                       "barbell",    "quads",      "squat",     1),
    ("Sissy Squat",                     "bodyweight", "quads",      "squat",     0),
    ("Step-Up (Dumbbell)",              "dumbbell",   "quads",      "squat",     1),
    ("Belt Squat",                      "machine",    "quads",      "squat",     1),
    ("Pendulum Squat",                  "machine",    "quads",      "squat",     1),
    # HAMSTRINGS
    ("Stiff-Leg Deadlift",              "barbell",    "hamstrings", "hinge",     1),
    ("Good Morning",                    "barbell",    "hamstrings", "hinge",     1),
    ("Glute-Ham Raise",                 "bodyweight", "hamstrings", "isolation", 0),
    ("Single-Leg Romanian Deadlift",    "dumbbell",   "hamstrings", "hinge",     1),
    ("Kettlebell Swing",                "kettlebell", "hamstrings", "hinge",     1),
    # GLUTES
    ("Single-Leg Hip Thrust",           "bodyweight", "glutes",     "hinge",     0),
    ("Glute Kickback (Cable)",          "cable",      "glutes",     "isolation", 0),
    ("Frog Pump",                       "bodyweight", "glutes",     "isolation", 0),
    ("Hip Abduction Machine",           "machine",    "glutes",     "isolation", 0),
    ("Curtsy Lunge",                    "dumbbell",   "glutes",     "squat",     1),
    ("B-Stance Hip Thrust",             "barbell",    "glutes",     "hinge",     1),
    # CALVES
    ("Leg Press Calf Raise",            "machine",    "calves",     "isolation", 0),
    ("Single-Leg Calf Raise",           "dumbbell",   "calves",     "isolation", 0),
    ("Donkey Calf Raise",               "machine",    "calves",     "isolation", 0),
    # CORE
    ("Russian Twist",                   "bodyweight", "core",       "core",      0),
    ("Cable Woodchop",                  "cable",      "core",       "core",      0),
    ("Decline Sit-Up",                  "bodyweight", "core",       "core",      0),
    ("Dead Bug",                        "bodyweight", "core",       "core",      0),
    ("Pallof Press",                    "cable",      "core",       "core",      0),
    ("Side Plank",                      "bodyweight", "core",       "core",      0),
    ("Toes-to-Bar",                     "bodyweight", "core",       "core",      0),
    ("Weighted Decline Crunch",         "bodyweight", "core",       "core",      0),
    ("Mountain Climber",                "bodyweight", "core",       "core",      0),

    # ── POWER — Olympic & explosive barbell ──────────────────────────────────
    ("Power Clean",                     "barbell",    "power",      "olympic",   1),
    ("Hang Clean",                      "barbell",    "power",      "olympic",   1),
    ("Clean & Jerk",                    "barbell",    "power",      "olympic",   1),
    ("Snatch",                          "barbell",    "power",      "olympic",   1),
    ("Power Snatch",                    "barbell",    "power",      "olympic",   1),
    ("Hang Snatch",                     "barbell",    "power",      "olympic",   1),
    ("Push Press",                      "barbell",    "power",      "olympic",   1),
    ("Push Jerk",                       "barbell",    "power",      "olympic",   1),
    ("Split Jerk",                      "barbell",    "power",      "olympic",   1),
    ("Clean Pull",                      "barbell",    "power",      "olympic",   1),
    ("Snatch-Grip High Pull",          "barbell",    "power",      "olympic",   1),
    ("Barbell High Pull",               "barbell",    "power",      "olympic",   1),
    ("Jump Squat (Barbell)",            "barbell",    "power",      "olympic",   1),
    ("Trap Bar Jump",                   "barbell",    "power",      "olympic",   1),
    ("Dumbbell Snatch",                 "dumbbell",   "power",      "olympic",   1),
    ("Kettlebell Clean",                "kettlebell", "power",      "olympic",   1),

    # ── PLYOMETRIC — jumps & throws ──────────────────────────────────────────
    ("Box Jump",                        "bodyweight", "plyometric", "plyo",     1),
    ("Seated Box Jump",                 "bodyweight", "plyometric", "plyo",     1),
    ("Single-Leg Box Jump",            "bodyweight", "plyometric", "plyo",     1),
    ("Depth Jump",                      "bodyweight", "plyometric", "plyo",     1),
    ("Depth Drop",                      "bodyweight", "plyometric", "plyo",     1),
    ("Broad Jump",                      "bodyweight", "plyometric", "plyo",     1),
    ("Tuck Jump",                       "bodyweight", "plyometric", "plyo",     0),
    ("Lateral Bound",                   "bodyweight", "plyometric", "plyo",     0),
    ("Pogo Hops",                       "bodyweight", "plyometric", "plyo",     0),
    ("Hurdle Hops",                     "bodyweight", "plyometric", "plyo",     0),
    ("Plyo Push-Up",                    "bodyweight", "plyometric", "plyo",     1),
    ("Med Ball Slam",                   "med-ball",   "plyometric", "plyo",     0),
    ("Med Ball Chest Pass",             "med-ball",   "plyometric", "plyo",     0),
    ("Overhead Med Ball Throw",         "med-ball",   "plyometric", "plyo",     0),
    ("Med Ball Rotational Throw",       "med-ball",   "plyometric", "plyo",     0),

    # ── CONDITIONING — sprints, sleds, carries ───────────────────────────────
    ("Sprint (40yd)",                   "none",       "conditioning", "sprint",   1),
    ("Sprint (100m)",                   "none",       "conditioning", "sprint",   1),
    ("Flying Sprint",                   "none",       "conditioning", "sprint",   1),
    ("Hill Sprint",                     "none",       "conditioning", "sprint",   1),
    ("Shuttle Run (Pro Agility)",       "none",       "conditioning", "sprint",   1),
    ("Sled Push (Prowler)",             "sled",       "conditioning", "carry",    1),
    ("Sled Pull",                       "sled",       "conditioning", "carry",    1),
    ("Sled Drag (Backward)",            "sled",       "conditioning", "carry",    1),
    ("Farmer's Carry",                  "dumbbell",   "conditioning", "carry",    1),
    ("Suitcase Carry",                  "dumbbell",   "conditioning", "carry",    1),
    ("Yoke Walk",                       "yoke",       "conditioning", "carry",    1),
    ("Sandbag Carry",                   "sandbag",    "conditioning", "carry",    1),
    ("Tire Flip",                       "tire",       "conditioning", "carry",    1),
    ("Battle Ropes",                    "ropes",      "conditioning", "metcon",   0),
    ("Assault Bike Sprint",             "machine",    "conditioning", "metcon",   1),
    ("Rowing Erg Sprint",               "machine",    "conditioning", "metcon",   1),
    ("Bear Crawl",                      "bodyweight", "conditioning", "metcon",   1),
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
    # timeout: wait up to 10s for a lock instead of erroring out immediately.
    conn = sqlite3.connect(DB_PATH, timeout=10.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    # WAL lets reads (news polling, page loads) and writes happen concurrently
    # without "database is locked" errors — the cause of intermittent add-exercise
    # failures. busy_timeout backs up the connect timeout at the SQLite level.
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA busy_timeout = 10000")
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

        CREATE TABLE IF NOT EXISTS daily_checkins (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            date        TEXT NOT NULL UNIQUE,
            p1          TEXT,
            p2          TEXT,
            p3          TEXT,
            reflection  TEXT,
            created_at  TEXT,
            updated_at  TEXT
        );

        CREATE TABLE IF NOT EXISTS finance_log (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            date        TEXT NOT NULL,
            amount      REAL NOT NULL,
            category    TEXT NOT NULL DEFAULT 'other',
            note        TEXT,
            logged_at   TEXT
        );

        CREATE TABLE IF NOT EXISTS sleep_log (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            date        TEXT NOT NULL UNIQUE,
            hours       REAL NOT NULL,
            quality     INTEGER,
            note        TEXT,
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
    sync_exercises(conn)   # idempotent — runs every boot
    seed_templates(conn)   # one-time — only on a fresh DB
    conn.close()


def sync_exercises(conn):
    """Idempotent library sync. Runs on EVERY boot so new movements added to
    EXERCISE_SEED reach the live DB. INSERT OR IGNORE means existing rows and
    any user-created custom exercises are left untouched."""
    conn.executemany(
        "INSERT OR IGNORE INTO exercises(name, equipment, muscle_group, movement_pattern, is_compound) VALUES (?,?,?,?,?)",
        EXERCISE_SEED,
    )
    conn.commit()


def seed_templates(conn):
    if conn.execute("SELECT COUNT(*) FROM workout_templates").fetchone()[0] > 0:
        return  # already seeded — don't clobber user edits

    now = datetime.now().isoformat()

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
