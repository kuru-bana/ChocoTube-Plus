import asyncio
import os
import re
import subprocess
import time
from contextlib import asynccontextmanager
from urllib.parse import quote, urlencode

from youtube_transcript_api import YouTubeTranscriptApi as _YTA_Class
_YTA = _YTA_Class()

import httpx
from fastapi import FastAPI, Query, Request
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.middleware.gzip import GZipMiddleware

INVIDIOUS_BASE = "https://raw.githubusercontent.com/kuru-bana/yt-data/main/invidious"
INNERTUBE_BASE = "https://choco-youtube-js.onrender.com"
CACHE_TTL = 5 * 60

category_cache: dict = {}
http_client: httpx.AsyncClient = None
    

_CLIENT_TIMEOUT = httpx.Timeout(connect=5.0, read=18.0, write=5.0, pool=5.0)
_CLIENT_LIMITS = httpx.Limits(max_keepalive_connections=20, keepalive_expiry=30.0)


async def get_client() -> httpx.AsyncClient:
    global http_client
    if http_client is None or http_client.is_closed:
        http_client = httpx.AsyncClient(
            timeout=_CLIENT_TIMEOUT,
            limits=_CLIENT_LIMITS,
            follow_redirects=True,
        )
    return http_client


KEEPALIVE_TARGETS = [
    f"{INNERTUBE_BASE}/version",
]
_keepalive_self_url: str = ""


async def _periodic_keepalive():
    """Ping self and dependent services every 10 minutes to prevent cold starts."""
    await asyncio.sleep(60)  # wait a bit after startup before first ping
    while True:
        targets = list(KEEPALIVE_TARGETS)
        if _keepalive_self_url:
            targets.append(f"{_keepalive_self_url}/whats")
        for t in targets:
            try:
                client = await get_client()
                await client.get(t, timeout=10)
            except Exception:
                pass
        await asyncio.sleep(10 * 60)  # ping every 10 minutes


@asynccontextmanager
async def lifespan(app: FastAPI):
    global http_client
    http_client = httpx.AsyncClient(
        timeout=_CLIENT_TIMEOUT,
        limits=_CLIENT_LIMITS,
        follow_redirects=True,
    )
    task = asyncio.create_task(_periodic_keepalive())
    yield
    task.cancel()
    await asyncio.gather(task, return_exceptions=True)
    await http_client.aclose()


app = FastAPI(lifespan=lifespan)
templates = Jinja2Templates(directory="templates")

def _get_static_ver() -> str:
    import hashlib, pathlib
    h = hashlib.md5()
    static_root = pathlib.Path("templates/static")
    try:
        for f in sorted(static_root.rglob("*.js")) + sorted(static_root.rglob("*.css")):
            h.update(f.read_bytes())
        return h.hexdigest()[:8]
    except Exception:
        pass
    return str(int(time.time()))

_STATIC_VER = _get_static_ver()
templates.env.globals["static_ver"] = _STATIC_VER


async def get_instances(category: str) -> list:
    now = time.time()
    cached = category_cache.get(category)
    if cached and now - cached["time"] < CACHE_TTL:
        return cached["instances"]
    try:
        client = await get_client()
        resp = await client.get(f"{INVIDIOUS_BASE}/{category}.json", timeout=10)
        resp.raise_for_status()
        data = resp.json()
        instances = data.get("working_instances", [])
    except Exception:
        # Fetch failed — return stale cache rather than caching an error
        if cached:
            return cached["instances"]
        raise
    if not instances:
        # Empty list — don't cache it, return stale cache if available
        if cached:
            return cached["instances"]
        return []
    category_cache[category] = {"instances": instances, "time": now}
    return instances


_RETRYABLE = (httpx.RemoteProtocolError, httpx.LocalProtocolError, httpx.ConnectError)


async def _try_instance(base: str, invidious_path: str) -> dict:
    client = await get_client()
    for attempt in range(2):
        try:
            resp = await client.get(base + invidious_path)
            resp.raise_for_status()
            return {"data": resp.json(), "used_instance": base}
        except _RETRYABLE:
            if attempt == 0:
                continue
            raise


def _has_valid_videos(data) -> bool:
    """Return True if response contains at least one non-parse-error video item."""
    items = data if isinstance(data, list) else data.get("videos", [])
    return any(not item.get("errorMessage") and (item.get("videoId") or item.get("title")) for item in items)


def _has_valid_stream(data) -> bool:
    """Return True if response has at least one format stream with a playable URL."""
    if not isinstance(data, dict):
        return False
    streams = data.get("formatStreams") or data.get("adaptiveFormats") or []
    return any(isinstance(s, dict) and s.get("url") for s in streams)


_innertube_cont_cache: dict = {}
_INNERTUBE_CONT_TTL = 600


def _innertube_cont_set(channel_id: str, tab: str, inv_cont: str, innertube_key: str):
    key = (channel_id, tab, inv_cont)
    _innertube_cont_cache[key] = {"key": innertube_key, "time": time.time()}
    now = time.time()
    stale = [k for k, v in _innertube_cont_cache.items() if now - v["time"] > _INNERTUBE_CONT_TTL]
    for k in stale:
        del _innertube_cont_cache[k]


def _innertube_cont_get(channel_id: str, tab: str, inv_cont: str) -> str | None:
    key = (channel_id, tab, inv_cont)
    entry = _innertube_cont_cache.get(key)
    if not entry:
        return None
    if time.time() - entry["time"] > _INNERTUBE_CONT_TTL:
        del _innertube_cont_cache[key]
        return None
    return entry["key"]


def _extract_innertube_videos(data: dict) -> tuple:
    """Parse innertube channel tab response. Returns (videos, raw_cont_token)."""
    result = []
    raw_cont_token = data.get("_rawContToken") or None

    contents = data.get("current_tab", {}).get("content", {}).get("contents", [])
    for item in contents:
        if not isinstance(item, dict):
            continue
        if item.get("type") == "ContinuationItem":
            if not raw_cont_token:
                raw_cont_token = item.get("endpoint", {}).get("payload", {}).get("token")
            continue
        lv = item.get("content", {})
        if not isinstance(lv, dict) or lv.get("content_type") != "VIDEO":
            continue
        video_id = lv.get("content_id")
        if not video_id:
            continue
        title_obj = lv.get("metadata", {}).get("title", {})
        title = title_obj.get("text", "") if isinstance(title_obj, dict) else str(title_obj)
        result.append({"videoId": video_id, "title": title})

    if not result:
        for item in (data.get("videos") or data.get("items") or []):
            if not isinstance(item, dict):
                continue
            video_id = item.get("videoId") or item.get("id")
            if not video_id:
                continue
            title_obj = item.get("title", {})
            title = title_obj.get("text", "") if isinstance(title_obj, dict) else str(title_obj)
            result.append({"videoId": video_id, "title": title})

    return result, raw_cont_token


async def fetch_innertube_videos(channel_id: str, tab: str) -> tuple:
    """Fetch first page of videos from innertube API. Returns (videos, raw_cont_token)."""
    tab_map = {"videos": "videos", "shorts": "shorts", "streams": "live", "latest": "videos"}
    innertube_tab = tab_map.get(tab, "videos")
    try:
        client = await get_client()
        resp = await client.get(
            f"{INNERTUBE_BASE}/channel/{channel_id}/{innertube_tab}",
            timeout=httpx.Timeout(30.0),
        )
        resp.raise_for_status()
        return _extract_innertube_videos(resp.json())
    except Exception:
        return [], None


async def fetch_innertube_continuation(raw_token: str) -> tuple:
    """Fetch next page using raw ContinuationItem token. Returns (videos, raw_cont_token)."""
    try:
        client = await get_client()
        resp = await client.get(
            f"{INNERTUBE_BASE}/channel/continue-raw",
            params={"token": raw_token},
            timeout=httpx.Timeout(30.0),
        )
        resp.raise_for_status()
        return _extract_innertube_videos(resp.json())
    except Exception:
        return [], None


def _innertube_to_invidious(innertube_items: list, channel_id: str = "") -> list:
    """Convert innertube video items to Invidious-compatible format."""
    return [
        {
            "videoId": item["videoId"],
            "title": item["title"],
            "author": "",
            "authorId": channel_id,
            "lengthSeconds": 0,
            "viewCount": 0,
            "publishedText": "",
            "authorThumbnails": [],
        }
        for item in innertube_items
    ]


def _apply_enrichment(data, innertube_items: list, channel_id: str):
    """
    Apply innertube enrichment to Invidious channel tab data (no network calls).
    - Full fallback: if Invidious returned no valid items, replace entirely with innertube data.
    - Partial enrichment: match items by title and fill in missing videoIds.
    """
    if not innertube_items:
        return data

    is_list = isinstance(data, list)
    items = data if is_list else data.get("videos", [])

    valid_items = [v for v in items if not v.get("errorMessage")]
    items_needing_id = [v for v in valid_items if not v.get("videoId") and v.get("title")]

    if not items_needing_id and valid_items:
        return data

    if not valid_items:
        fallback = _innertube_to_invidious(innertube_items, channel_id)
        return fallback if is_list else {"videos": fallback, "continuation": None}

    title_map: dict = {}
    for iv in innertube_items:
        t = iv.get("title", "").strip()
        vid = iv.get("videoId")
        if t and vid:
            title_map[t] = vid
            for length in (80, 60, 40, 20):
                if len(t) >= length:
                    title_map[t[:length]] = vid

    for item in items_needing_id:
        title = item.get("title", "").strip()
        vid = title_map.get(title)
        if not vid:
            for length in (80, 60, 40, 20):
                vid = title_map.get(title[:length])
                if vid:
                    break
        if not vid:
            for k, v in title_map.items():
                min_len = min(len(k), len(title), 25)
                if min_len >= 15 and k[:min_len] == title[:min_len]:
                    vid = v
                    break
        if vid:
            item["videoId"] = vid

    return data


async def proxy_parallel(category: str, invidious_path: str, exclude_list: list = None, prefer_valid_videos: bool = False, prefer_valid_stream: bool = False) -> dict:
    instances = await get_instances(category)
    if exclude_list:
        instances = [b for b in instances if not any(ex in b or b in ex for ex in exclude_list)]
    if not instances:
        raise Exception(f'No working instances for category "{category}" after exclusions')

    task_to_base = {
        asyncio.create_task(_try_instance(base, invidious_path)): base
        for base in instances
    }
    tasks = list(task_to_base)
    errors = []
    pending = set(tasks)
    winner = None
    fallback = None
    try:
        while pending:
            done, pending = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED)
            for task in done:
                exc = task.exception()
                if exc is None:
                    result = task.result()
                    if prefer_valid_videos:
                        if _has_valid_videos(result["data"]):
                            if winner is None:
                                winner = result
                        else:
                            if fallback is None:
                                fallback = result
                    elif prefer_valid_stream:
                        if _has_valid_stream(result["data"]):
                            if winner is None:
                                winner = result
                        else:
                            if fallback is None:
                                fallback = result
                    elif winner is None:
                        winner = result
                else:
                    msg = str(exc) or type(exc).__name__
                    errors.append(f"{task_to_base.get(task, '?')}:{msg}")
            if winner is not None:
                break
    finally:
        for t in pending:
            t.cancel()
        if pending:
            await asyncio.gather(*pending, return_exceptions=True)

    best = winner or fallback
    if best is not None:
        return best
    # All instances failed — evict the cache so the next request fetches a fresh list
    category_cache.pop(category, None)
    raise Exception("All instances failed: " + ", ".join(errors))


def map_path(app_path: str) -> tuple:
    """Map an app API path to (category, invidious_path)."""

    # /api/trending/music|gaming|news|movies
    m = re.match(r"^/api/trending/(music|gaming|news|movies)([?].*)?$", app_path, re.IGNORECASE)
    if m:
        type_name = m.group(1).lower()
        qs_part = m.group(2) or ""
        type_map = {"music": "Music", "gaming": "Gaming", "news": "News", "movies": "Movies"}
        if qs_part:
            invidious_path = f"/api/v1/trending{qs_part}&type={type_map[type_name]}"
        else:
            invidious_path = f"/api/v1/trending?type={type_map[type_name]}"
        return f"trending_{type_name}", invidious_path

    # /api/stream/:id → video category → /api/v1/videos/:id
    m = re.match(r"^/api/stream/([^?]+)(.*)", app_path)
    if m:
        return "video", f"/api/v1/videos/{m.group(1)}{m.group(2)}"

    # /api/search/suggestions
    if app_path.startswith("/api/search/suggestions"):
        return "search_suggestions", "/api/v1/search/suggestions" + app_path[len("/api/search/suggestions"):]

    # /api/channels/:id/<sub>
    m = re.match(r"^/api/channels/([^/?]+)/(videos|shorts|streams|latest|playlists|comments|search)(.*)", app_path)
    if m:
        sub = m.group(2)
        return f"channel_{sub}", f"/api/v1/channels/{m.group(1)}/{sub}{m.group(3)}"

    # Simple prefix → category (more specific first)
    prefix_map = [
        ("/api/trending",    "trending"),
        ("/api/search",      "search"),
        ("/api/channels",    "channel"),
        ("/api/videos",      "video"),
        ("/api/playlists",   "playlist"),
        ("/api/mixes",       "mix"),
        ("/api/hashtag",     "hashtag"),
        ("/api/comments",    "comments"),
        ("/api/transcripts", "transcripts"),
        ("/api/captions",    "captions"),
        ("/api/annotations", "annotations"),
        ("/api/clip",        "clip"),
        ("/api/resolveurl",  "resolveurl"),
        ("/api/popular",     "popular"),
        ("/api/stats",       "stats"),
    ]
    for prefix, category in prefix_map:
        if app_path.startswith(prefix):
            return category, "/api/v1" + app_path[4:]

    # Fallback
    return "video", "/api/v1" + app_path[4:]


# ── Proxy routes ──────────────────────────────────────────────────────────────

CHANNEL_VIDEO_CATEGORIES = {"channel_videos", "channel_shorts", "channel_streams", "channel_latest"}
_CH_TAB_RE = re.compile(r"^/api/channels/([^/?]+)/(videos|shorts|streams|latest)")

@app.get("/proxy/main/{path:path}")
async def proxy_main(path: str, request: Request):
    qs = request.url.query
    app_path = "/" + path + ("?" + qs if qs else "")
    category, invidious_path = map_path(app_path)
    prefer_valid = category in CHANNEL_VIDEO_CATEGORIES

    ch_match = _CH_TAB_RE.match(app_path) if category in CHANNEL_VIDEO_CATEGORIES else None
    channel_id = ch_match.group(1) if ch_match else None
    tab = ch_match.group(2) if ch_match else None

    if ch_match:
        inv_cont_in = request.query_params.get("continuation")
        innertube_cont_key = _innertube_cont_get(channel_id, tab, inv_cont_in) if inv_cont_in else None

        invidious_task = asyncio.create_task(
            proxy_parallel(category, invidious_path, prefer_valid_videos=True)
        )
        if innertube_cont_key:
            innertube_task = asyncio.create_task(fetch_innertube_continuation(innertube_cont_key))
        else:
            innertube_task = asyncio.create_task(fetch_innertube_videos(channel_id, tab))

        # Cap innertube at 8s so a cold-start on Render never blocks the response
        innertube_result = ([], None)
        try:
            innertube_result = await asyncio.wait_for(innertube_task, timeout=8.0)
        except (asyncio.TimeoutError, Exception):
            innertube_result = ([], None)

        try:
            inv_result = await invidious_task
        except Exception as e:
            inv_result = e

        innertube_items, new_innertube_cont_key = innertube_result if isinstance(innertube_result, tuple) else (innertube_result, None)

        if isinstance(inv_result, Exception):
            if innertube_items:
                fallback = _innertube_to_invidious(innertube_items, channel_id)
                return JSONResponse(fallback if tab == "latest" else {"videos": fallback, "continuation": None})
            return JSONResponse({"error": str(inv_result)}, status_code=502)

        if new_innertube_cont_key:
            inv_data = inv_result["data"]
            inv_cont_out = inv_data.get("continuation") if isinstance(inv_data, dict) else None
            if inv_cont_out:
                _innertube_cont_set(channel_id, tab, inv_cont_out, new_innertube_cont_key)

        data = _apply_enrichment(inv_result["data"], innertube_items, channel_id)
        return JSONResponse(data)

    try:
        result = await proxy_parallel(category, invidious_path)
        return JSONResponse(result["data"])
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=502)


@app.get("/proxy/stream/{path:path}")
async def proxy_stream(path: str, request: Request):
    try:
        params = dict(request.query_params)
        exclude_list = [s.strip() for s in params.pop("exclude", "").split(",") if s.strip()]
        qs = urlencode(params) if params else ""
        app_path = "/" + path + ("?" + qs if qs else "")
        category, invidious_path = map_path(app_path)
        result = await proxy_parallel(category, invidious_path, exclude_list, prefer_valid_stream=True)
        headers = {}
        if result.get("used_instance"):
            headers["X-Instance-Used"] = result["used_instance"]
        return JSONResponse(result["data"], headers=headers)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=502)


def _parse_innertube_search_shorts(data: dict) -> tuple:
    """InnerTube検索レスポンス（youtubei.js形式）からショート動画を抽出してInvidious互換形式に変換。
    Returns: (shorts_list, cont_key_or_None)
    """
    shorts = []
    cont_key = data.get("_contKey")
    results = data.get("results") or data.get("items") or []
    for item in results:
        if not isinstance(item, dict):
            continue
        t = item.get("type", "")
        is_reel = (t == "Reel")
        dur_secs = 0
        if t == "Video":
            dur = item.get("duration", {})
            if isinstance(dur, dict):
                dur_secs = dur.get("seconds", 0) or 0
            elif isinstance(dur, (int, float)):
                dur_secs = int(dur)
        is_short_video = (t == "Video" and 0 < dur_secs <= 90)
        if not (is_reel or is_short_video):
            continue

        video_id = item.get("id") or item.get("videoId") or ""
        if not video_id:
            continue

        title_raw = item.get("title", "")
        if isinstance(title_raw, dict):
            runs = title_raw.get("runs", [{}])
            title = title_raw.get("text", "") or (runs[0].get("text", "") if runs else "")
        else:
            title = str(title_raw)

        author_raw = item.get("author", {})
        if isinstance(author_raw, dict):
            author = author_raw.get("name", "") or str(author_raw.get("text", ""))
            ep = author_raw.get("endpoint", {}) or {}
            author_id = author_raw.get("id", "") or ep.get("payload", {}).get("browseId", "")
        else:
            author = str(author_raw) if author_raw else ""
            author_id = ""

        thumbs_raw = item.get("thumbnails", []) or []
        thumbnails = [
            {"url": th["url"], "width": th.get("width", 0), "height": th.get("height", 0)}
            for th in thumbs_raw if isinstance(th, dict) and th.get("url")
        ]

        vc_raw = item.get("view_count") or item.get("short_view_count") or {}
        if isinstance(vc_raw, dict):
            vc_text = vc_raw.get("text", "0")
        else:
            vc_text = str(vc_raw) if vc_raw else "0"

        shorts.append({
            "videoId": video_id,
            "title": title,
            "lengthSeconds": dur_secs if is_short_video else 30,
            "isShort": True,
            "author": author,
            "authorId": author_id,
            "authorThumbnails": [],
            "videoThumbnails": thumbnails,
            "viewCountText": vc_text,
        })
    return shorts, cont_key


@app.get("/api/innertube-shorts-search")
async def innertube_shorts_search(q: str = Query(...)):
    try:
        client = await get_client()
        resp = await client.get(
            f"{INNERTUBE_BASE}/search",
            params={"q": q, "type": "all"},
            timeout=httpx.Timeout(12.0),
        )
        resp.raise_for_status()
        shorts, cont_key = _parse_innertube_search_shorts(resp.json())
        return JSONResponse({"items": shorts, "contKey": cont_key})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=502)


@app.get("/api/innertube-shorts-search-cont")
async def innertube_shorts_search_cont(contKey: str = Query(...)):
    try:
        client = await get_client()
        resp = await client.get(
            f"{INNERTUBE_BASE}/search/continue",
            params={"key": contKey},
            timeout=httpx.Timeout(12.0),
        )
        resp.raise_for_status()
        shorts, cont_key = _parse_innertube_search_shorts(resp.json())
        return JSONResponse({"items": shorts, "contKey": cont_key})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=502)


@app.get("/download")
async def download(url: str = Query(...), filename: str = Query(default="download")):
    try:
        client = await get_client()
        req = client.build_request("GET", url)
        upstream = await client.send(req, stream=True)
        if not upstream.is_success:
            raise Exception(f"HTTP {upstream.status_code}")

        content_type = upstream.headers.get("content-type", "application/octet-stream")
        content_length = upstream.headers.get("content-length")

        response_headers = {
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename, safe='')}",
            "Content-Type": content_type,
        }
        if content_length:
            response_headers["Content-Length"] = content_length

        async def stream_body():
            async for chunk in upstream.aiter_bytes():
                yield chunk
            await upstream.aclose()

        return StreamingResponse(stream_body(), headers=response_headers)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=502)


CHANNEL_HOME_BASE = "https://choco-youtube-js.onrender.com"

@app.get("/api/channel-home/{channel_id}")
async def api_channel_home(channel_id: str):
    try:
        client = await get_client()
        resp = await client.get(f"{CHANNEL_HOME_BASE}/channel/{channel_id}", timeout=15)
        resp.raise_for_status()
        return JSONResponse(resp.json())
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=502)


@app.get("/api/instances")
async def api_instances():
    categories = [
        "video", "search", "trending", "trending_music", "trending_gaming",
        "trending_news", "trending_movies", "channel", "channel_videos",
        "channel_shorts", "channel_streams", "channel_latest", "channel_playlists",
        "channel_comments", "channel_search", "playlist", "mix", "hashtag",
        "comments", "transcripts", "captions", "annotations", "clip",
        "resolveurl", "popular", "stats", "search_suggestions", "search_filters",
    ]
    results = await asyncio.gather(
        *[get_instances(cat) for cat in categories],
        return_exceptions=True,
    )
    all_instances = {}
    for cat, result in zip(categories, results):
        if not isinstance(result, Exception):
            all_instances[cat] = result
    return JSONResponse({"all": all_instances})


# ── HTML page routes ──────────────────────────────────────────────────────────

@app.get("/whats")
async def whats():
    return {"name": "choco-tube-plus"}


@app.get("/version")
async def version():
    return {"ver": "1.22"}


LINKLIST_URL = "https://raw.githubusercontent.com/kuru-bana/Link-list/refs/heads/main/choco-tube-plus.json"


async def _check_one(url: str) -> dict:
    base = url.rstrip("/")
    try:
        client = await get_client()
        r = await client.get(f"{base}/version", timeout=8)
        if r.status_code == 200:
            data = r.json()
            return {"url": base, "ver": data.get("ver", "?"), "online": True}
        return {"url": base, "ver": None, "online": False}
    except Exception:
        return {"url": base, "ver": None, "online": False}


@app.get("/api/linklist-status")
async def linklist_status():
    try:
        client = await get_client()
        r = await client.get(LINKLIST_URL, timeout=10)
        r.raise_for_status()
        urls = r.json()
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=502)

    results = await asyncio.gather(*[_check_one(u) for u in urls])
    return list(results)


@app.get("/links")
async def links_page(request: Request):
    return templates.TemplateResponse(request, "links.html")


async def _ping_keepalive(self_url: str):
    targets = [
        f"https://link-up-r6fn.onrender.com/url={self_url}",
        f"https://link-up-hsda.onrender.com/url={self_url}",
    ]
    for t in targets:
        try:
            client = await get_client()
            await client.get(t, timeout=10)
        except Exception:
            pass


@app.get("/")
async def index_page(request: Request):
    global _keepalive_self_url
    self_url = str(request.base_url).rstrip("/")
    if not _keepalive_self_url:
        _keepalive_self_url = self_url
    asyncio.create_task(_ping_keepalive(self_url))
    return templates.TemplateResponse(request, "index.html")

@app.get("/trending")
async def trending_page(request: Request):
    return templates.TemplateResponse(request, "trending.html", {"active": "trending"})

@app.get("/dl")
async def dl_page(request: Request):
    return templates.TemplateResponse(request, "dl.html", {"active": "dl"})

@app.get("/watch")
async def watch_page(request: Request):
    return templates.TemplateResponse(request, "watch.html")

@app.get("/shorts/{video_id}")
async def shorts_page(request: Request, video_id: str):
    return templates.TemplateResponse(request, "shorts.html")

@app.get("/search")
async def search_page(request: Request):
    return templates.TemplateResponse(request, "search.html")

@app.get("/channel")
async def channel_page(request: Request):
    return templates.TemplateResponse(request, "channel.html")

@app.get("/playlist")
async def playlist_page(request: Request):
    return templates.TemplateResponse(request, "playlist.html")

@app.get("/hashtag")
async def hashtag_page(request: Request):
    return templates.TemplateResponse(request, "hashtag.html")

@app.get("/mix")
async def mix_page(request: Request):
    return templates.TemplateResponse(request, "mix.html")

@app.get("/library")
async def library_page(request: Request):
    return templates.TemplateResponse(request, "library.html", {"active": "library"})

@app.get("/settings")
async def settings_page(request: Request):
    return templates.TemplateResponse(request, "settings.html", {"active": "settings"})


@app.get("/chat")
async def chat_page(request: Request):
    return FileResponse("templates/chat-page.html")


@app.get("/chat-raw")
async def chat_raw():
    return FileResponse("templates/chat.html")


_EDU_PARAMS_URLS = [
    {"label": "choco-1", "url": "https://raw.githubusercontent.com/choco-1515/About-youtube/refs/heads/main/edu/key1.json"},
    {"label": "choco-2", "url": "https://raw.githubusercontent.com/choco-1515/About-youtube/refs/heads/main/edu/key2.json"},
    {"label": "choco-3", "url": "https://raw.githubusercontent.com/choco-1515/About-youtube/refs/heads/main/edu/key3.json"},
]
_EDU_PARAMS_CACHE: dict = {}
_EDU_PARAMS_TTL = 30 * 60


@app.get("/api/edu-params")
async def api_edu_params():
    now = time.time()
    cached = _EDU_PARAMS_CACHE.get("data")
    if cached and now - cached["time"] < _EDU_PARAMS_TTL:
        return JSONResponse(cached["json"])
    try:
        client = await get_client()
        responses = await asyncio.gather(
            *[client.get(e["url"], timeout=8) for e in _EDU_PARAMS_URLS],
            return_exceptions=True,
        )
        result = []
        for i, r in enumerate(responses):
            if isinstance(r, Exception) or not r.is_success:
                result.append({"label": _EDU_PARAMS_URLS[i]["label"], "value": ""})
            else:
                data = r.json()
                result.append({"label": _EDU_PARAMS_URLS[i]["label"], "value": data.get("value", "")})
        _EDU_PARAMS_CACHE["data"] = {"json": result, "time": now}
        return JSONResponse(result)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=502)


CHOCO_CHAT_CACHE: dict = {}
CHOCO_CHAT_TTL = 30 * 60

@app.get("/choco-chat-new")
async def choco_chat_new():
    now = time.time()
    cached = CHOCO_CHAT_CACHE.get("data")
    if cached and now - cached["time"] < CHOCO_CHAT_TTL:
        return JSONResponse(cached["json"])
    try:
        client = await get_client()
        resp = await client.get(
            "https://raw.githubusercontent.com/kuru-bana/choco-chat-tool/refs/heads/main/url.json"
        )
        resp.raise_for_status()
        data = resp.json()
        CHOCO_CHAT_CACHE["data"] = {"json": data, "time": now}
        return JSONResponse(data)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=502)


# ── Transcript endpoints (youtube-transcript-api → Invidious fallback) ────────

@app.get("/api/transcript-langs/{video_id}")
async def transcript_langs(video_id: str):
    """Return available caption tracks. Tries youtube-transcript-api first, falls back to Invidious."""
    # 1. Try youtube-transcript-api
    try:
        loop = asyncio.get_event_loop()
        transcript_list = await loop.run_in_executor(None, lambda: list(_YTA.list(video_id)))
        if transcript_list:
            tracks = []
            for t in transcript_list:
                tracks.append({
                    "label": t.language,
                    "language_code": t.language_code,
                    "source": "yta",
                    "is_generated": getattr(t, "is_generated", False),
                    "is_translatable": getattr(t, "is_translatable", False),
                })
            return JSONResponse(tracks)
    except Exception:
        pass

    # 2. Fallback: Invidious captions
    try:
        result = await proxy_parallel("captions", f"/api/v1/captions/{video_id}")
        data = result.get("data", {})
        captions = []
        if isinstance(data, dict):
            captions = data.get("captions", [])
        elif isinstance(data, list):
            captions = data
        if captions:
            return JSONResponse([{
                "label": c.get("label") or c.get("languageCode") or c.get("language_code") or "?",
                "language_code": c.get("languageCode") or c.get("language_code") or "",
                "source": "invidious",
                "is_generated": c.get("isGenerated", False),
                "is_translatable": False,
            } for c in captions])
    except Exception:
        pass

    return JSONResponse({"error": "no tracks found", "tracks": []}, status_code=502)


@app.get("/api/transcript-data/{video_id}")
async def transcript_data(video_id: str, lang: str = "en", source: str = "auto"):
    """Return transcript lines. Tries youtube-transcript-api first, falls back to Invidious."""
    # 1. Try youtube-transcript-api (unless caller specifies invidious)
    if source != "invidious":
        try:
            loop = asyncio.get_event_loop()
            def _fetch():
                fetched = _YTA.fetch(video_id, languages=[lang])
                return [{"text": s.text, "start": s.start, "duration": s.duration} for s in fetched]
            lines = await loop.run_in_executor(None, _fetch)
            if lines:
                return JSONResponse(lines)
        except Exception:
            pass

    # 2. Fallback / direct: Invidious
    try:
        result = await proxy_parallel("transcripts", f"/api/v1/transcripts/{video_id}?lang={quote(lang)}")
        data = result.get("data", [])
        lines = []
        if isinstance(data, list):
            lines = data
        elif isinstance(data, dict):
            lines = data.get("transcript", data.get("captions", []))
        if lines:
            return JSONResponse(lines)
    except Exception:
        pass

    return JSONResponse({"error": "no transcript found"}, status_code=502)


@app.get("/api/transcript-translate/{video_id}")
async def transcript_translate(video_id: str, lang: str = "en", target: str = "ja"):
    """Translate transcript via youtube-transcript-api's built-in translation."""
    try:
        loop = asyncio.get_event_loop()
        def _fetch():
            tl = _YTA.list(video_id)
            tr = tl.find_transcript([lang])
            translated = tr.translate(target)
            fetched = translated.fetch()
            return [{"text": s.text, "start": s.start, "duration": s.duration} for s in fetched]
        lines = await loop.run_in_executor(None, _fetch)
        return JSONResponse(lines)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=502)


# ── Static files & catch-all ─────────────────────────────────────────────────

class StaticCacheMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        if request.url.path.startswith("/static/"):
            response.headers["Cache-Control"] = "public, max-age=86400"
        return response

app.add_middleware(StaticCacheMiddleware)
app.add_middleware(GZipMiddleware, minimum_size=500)
app.mount("/static", StaticFiles(directory="templates/static"), name="static")
