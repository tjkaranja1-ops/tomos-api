"""TomOS — news headlines from reputable RSS feeds.

Runs fine in the cloud (Railway has full outbound internet). Fetches a handful
of trusted outlets in parallel, dedupes, keeps the last 24h, ranks by recency.
Cached in-memory for 20 min so the app loads fast and we don't hammer sources.
"""

import time
import calendar
import urllib.request
import concurrent.futures

import feedparser

SOURCES = [
    ("BBC", "https://feeds.bbci.co.uk/news/world/rss.xml"),
    ("NPR", "https://feeds.npr.org/1001/rss.xml"),
    ("The Guardian", "https://www.theguardian.com/world/rss"),
    ("Al Jazeera", "https://www.aljazeera.com/xml/rss/all.xml"),
]

_TTL = 20 * 60  # seconds
_CACHE = {"ts": 0.0, "data": []}


def _fetch_one(src):
    name, url = src
    items = []
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "TomOS/1.0 (+headlines)"})
        with urllib.request.urlopen(req, timeout=8) as r:
            raw = r.read()
        feed = feedparser.parse(raw)
        for e in feed.entries:
            pp = e.get("published_parsed") or e.get("updated_parsed")
            items.append({
                "title": (e.get("title") or "").strip(),
                "url": e.get("link") or "",
                "source": name,
                "published_ts": calendar.timegm(pp) if pp else None,
            })
    except Exception:
        pass  # one bad feed shouldn't sink the section
    return items


def _norm(t):
    return "".join(ch for ch in t.lower() if ch.isalnum())


def get_news(max_items=15, hours=24, force=False):
    now = time.time()
    if not force and _CACHE["data"] and now - _CACHE["ts"] < _TTL:
        return _CACHE["data"]

    collected = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(SOURCES)) as ex:
        for items in ex.map(_fetch_one, SOURCES):
            collected.extend(items)

    cutoff = now - hours * 3600
    seen, fresh = set(), []
    for it in collected:
        if not it["title"] or not it["url"] or it["published_ts"] is None:
            continue
        if it["published_ts"] < cutoff:
            continue
        key = _norm(it["title"])
        if key in seen:
            continue
        seen.add(key)
        fresh.append(it)

    fresh.sort(key=lambda x: x["published_ts"], reverse=True)
    result = fresh[:max_items]
    for it in result:
        it["published"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(it["published_ts"]))

    # Only overwrite cache if we actually got something (survive a transient outage).
    if result:
        _CACHE["ts"] = now
        _CACHE["data"] = result
    return result or _CACHE["data"]


if __name__ == "__main__":
    for a in get_news(force=True):
        print(f"[{a['source']:>12}] {a['published']}  {a['title']}")
