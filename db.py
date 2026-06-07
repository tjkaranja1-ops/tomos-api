"""TomOS API — SQLite layer.

Stores extracted action items (with completion state that persists across
briefings) and a history of briefing pulls. The vault's Reminders.md remains
the human-readable copy; this DB is the app's interactive state.
"""

import os
import sqlite3
from pathlib import Path

# On Railway, TOMOS_DATA_DIR points at a mounted volume so the DB (and the
# refreshed Google token) survive restarts and redeploys. Locally it defaults
# to this folder.
DATA_DIR = Path(os.environ.get("TOMOS_DATA_DIR", Path(__file__).parent))
DB_PATH = DATA_DIR / "tomos.db"


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = get_conn()
    conn.executescript(
        """
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
        """
    )
    conn.commit()
    conn.close()


if __name__ == "__main__":
    init_db()
    print(f"Initialized {DB_PATH}")
