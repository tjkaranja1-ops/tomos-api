"""TomOS — Gmail + Calendar + Claude pull logic (single source of truth).

Both the cloud API (main.py) and the laptop's 8am briefing (daily_briefing.py)
import from here, so screening logic never forks.

Portable by design:
  - Locally: reads credentials.json / token.json from disk.
  - On Railway: reads them from env vars (GOOGLE_CREDENTIALS_JSON /
    GOOGLE_TOKEN_JSON) and persists the refreshed token to TOMOS_DATA_DIR
    (a mounted volume), so auth survives restarts with no laptop involved.
  - ANTHROPIC_API_KEY is read from the environment by the anthropic client.
"""

import os
import sys
import json
import re
import datetime
from pathlib import Path

from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
import anthropic

SCOPES = [
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/gmail.readonly",
]

# Where mutable state (the refreshed token) lives. On Railway, point this at a
# mounted volume so it persists; locally it defaults to this folder.
DATA_DIR = Path(os.environ.get("TOMOS_DATA_DIR", Path(__file__).parent))
TOKEN_FILE = DATA_DIR / "token.json"
CREDENTIALS_FILE = Path(__file__).parent / "credentials.json"

DAYS_AHEAD = 7
MAX_EMAILS = 25
CLAUDE_MODEL = "claude-sonnet-4-6"


# ── Auth ──────────────────────────────────────────────────────────────────────

def get_creds():
    creds = None

    # Load existing token: prefer the on-disk/volume copy, fall back to env seed.
    if TOKEN_FILE.exists():
        creds = Credentials.from_authorized_user_file(str(TOKEN_FILE), SCOPES)
    elif os.environ.get("GOOGLE_TOKEN_JSON"):
        creds = Credentials.from_authorized_user_info(
            json.loads(os.environ["GOOGLE_TOKEN_JSON"]), SCOPES
        )

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            # No usable token — run the interactive flow (local only).
            if CREDENTIALS_FILE.exists():
                flow = InstalledAppFlow.from_client_secrets_file(str(CREDENTIALS_FILE), SCOPES)
            elif os.environ.get("GOOGLE_CREDENTIALS_JSON"):
                flow = InstalledAppFlow.from_client_config(
                    json.loads(os.environ["GOOGLE_CREDENTIALS_JSON"]), SCOPES
                )
            else:
                sys.exit(
                    "ERROR: no Google credentials found (need credentials.json or "
                    "GOOGLE_CREDENTIALS_JSON)."
                )
            creds = flow.run_local_server(port=0)
        # Persist refreshed/new token so the next run is silent.
        TOKEN_FILE.parent.mkdir(parents=True, exist_ok=True)
        TOKEN_FILE.write_text(creds.to_json(), encoding="utf-8")

    return creds


def services():
    """Authorized (calendar, gmail) clients."""
    creds = get_creds()
    cal = build("calendar", "v3", credentials=creds)
    gmail = build("gmail", "v1", credentials=creds)
    return cal, gmail


# ── Calendar ──────────────────────────────────────────────────────────────────

def get_events(cal):
    now = datetime.datetime.utcnow().isoformat() + "Z"
    end = (datetime.datetime.utcnow() + datetime.timedelta(days=DAYS_AHEAD)).isoformat() + "Z"
    result = cal.events().list(
        calendarId="primary",
        timeMin=now,
        timeMax=end,
        maxResults=20,
        singleEvents=True,
        orderBy="startTime",
    ).execute()
    return result.get("items", [])


# ── Gmail ─────────────────────────────────────────────────────────────────────

def get_emails(gmail, hours_back=24):
    after_ts = int(
        (datetime.datetime.utcnow() - datetime.timedelta(hours=hours_back)).timestamp()
    )
    results = gmail.users().messages().list(
        userId="me",
        q=f"(is:unread OR is:important) after:{after_ts}",
        maxResults=MAX_EMAILS,
    ).execute()

    emails = []
    for msg in results.get("messages", []):
        full = gmail.users().messages().get(
            userId="me",
            id=msg["id"],
            format="metadata",
            metadataHeaders=["From", "Subject"],
        ).execute()
        headers = {h["name"]: h["value"] for h in full["payload"]["headers"]}
        labels = full.get("labelIds", [])
        emails.append({
            "from": headers.get("From", ""),
            "subject": headers.get("Subject", "(No subject)"),
            "snippet": full.get("snippet", "")[:200],
            "unread": "UNREAD" in labels,
            "important": "IMPORTANT" in labels,
        })
    return emails


# ── Claude analysis ───────────────────────────────────────────────────────────

def analyze(emails, events):
    if not emails:
        return [], []

    client = anthropic.Anthropic()

    email_block = "\n".join(
        f"{i+1}. From: {e['from']}\n   Subject: {e['subject']}\n   Preview: {e['snippet']}"
        for i, e in enumerate(emails)
    )
    cal_block = "\n".join(
        f"- {ev.get('summary','?')} on {ev['start'].get('dateTime', ev['start'].get('date',''))}"
        for ev in events[:10]
    )

    resp = client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=1024,
        system=(
            "You are Tom's personal assistant. Tom is a college student and athlete. "
            "Be direct, no fluff."
        ),
        messages=[{
            "role": "user",
            "content": (
                "Review these emails. Flag ones with deadlines, required replies, "
                "scheduling conflicts, or anything time-sensitive. Cross-reference "
                "with the calendar.\n\n"
                f"CALENDAR (next 7 days):\n{cal_block}\n\n"
                f"EMAILS:\n{email_block}\n\n"
                "Return only valid JSON — no markdown fences:\n"
                '{"priority": [{"num": 1, "reason": "one line"}], '
                '"actions": ["do X today", "reply to Y by Friday"]}'
            ),
        }],
    )

    try:
        text = resp.content[0].text
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if match:
            data = json.loads(match.group())
            p_map = {item["num"] - 1: item["reason"] for item in data.get("priority", [])}
            flagged = [
                {**emails[i], "reason": reason}
                for i, reason in p_map.items()
                if i < len(emails)
            ]
            return flagged, data.get("actions", [])
    except Exception as e:
        print(f"Claude parse error: {e}", file=sys.stderr)

    return [e for e in emails if e["unread"]], []
