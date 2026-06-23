"""TomOS — news headlines from reputable RSS feeds.

Runs fine in the cloud (Railway has full outbound internet). Fetches a handful
of trusted outlets in parallel, dedupes, keeps the last 24h, ranks by recency.
Cached in-memory for 20 min so the app loads fast and we don't hammer sources.
"""

import re
import time
import calendar
import urllib.request
import concurrent.futures

import feedparser

# (display name, RSS url, domain) — domain drives the source logo on the client.
SOURCES = [
    ("BBC", "https://feeds.bbci.co.uk/news/world/rss.xml", "bbc.co.uk"),
    ("NPR", "https://feeds.npr.org/1001/rss.xml", "npr.org"),
    ("The Guardian", "https://www.theguardian.com/world/rss", "theguardian.com"),
    ("Al Jazeera", "https://www.aljazeera.com/xml/rss/all.xml", "aljazeera.com"),
]

_TTL = 20 * 60  # seconds
_CACHE = {"ts": 0.0, "data": []}


def _extract_image(e):
    """Best-effort thumbnail for an entry. Outlets expose images a few ways;
    try the structured fields first, then fall back to an <img> in the HTML."""
    for key in ("media_thumbnail", "media_content"):
        for m in e.get(key) or []:
            url = m.get("url")
            if not url:
                continue
            # media_thumbnail is always an image; media_content may not be.
            if key == "media_thumbnail" or str(m.get("type", "image")).startswith("image"):
                return url
    for link in e.get("links", []):
        if link.get("rel") == "enclosure" and str(link.get("type", "")).startswith("image"):
            return link.get("href")
    html = e.get("summary", "") or ""
    if not html and e.get("content"):
        html = e["content"][0].get("value", "")
    m = re.search(r'<img[^>]+src="([^"]+)"', html)
    return m.group(1) if m else None


def _fetch_one(src):
    name, url, domain = src
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
                "domain": domain,
                "image": _extract_image(e),
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
