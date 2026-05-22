import asyncio
import re
import time
from contextlib import asynccontextmanager
from urllib.parse import quote, urlencode

import httpx
from fastapi import FastAPI, Query, Request
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

INVIDIOUS_BASE = "https://raw.githubusercontent.com/kuru-bana/yt-data/main/invidious"
INNERTUBE_BASE = "https://choco-youtube-js.onrender.com"
CACHE_TTL = 5 * 60

category_cache: dict = {}
http_client: httpx.AsyncClient = None


async def get_client() -> httpx.AsyncClient:
    global http_client
    if http_client is None or http_client.is_closed:
        http_client = httpx.AsyncClient(timeout=10, follow_redirects=True)
    return http_client


@asynccontextmanager
async def lifespan(app: FastAPI):
    global http_client
    http_client = httpx.AsyncClient(timeout=10, follow_redirects=True)
    yield
    await http_client.aclose()


app = FastAPI(lifespan=lifespan)
templates = Jinja2Templates(directory="templates")


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


async def _try_instance(base: str, invidious_path: str) -> dict:
    client = await get_client()
    resp = await client.get(base + invidious_path)
    resp.raise_for_status()
    return {"data": resp.json(), "used_instance": base}


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


def _extract_innertube_videos(data: dict) -> list:
    """Parse innertube channel tab response into [{videoId, title}] list."""
    result = []
    contents = data.get("current_tab", {}).get("content", {}).get("contents", [])
    for item in contents:
        if not isinstance(item, dict):
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
    return result


async def fetch_innertube_videos(channel_id: str, tab: str) -> list:
    """Fetch videos from innertube API for the given channel tab."""
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
        return []


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

    tasks = [asyncio.create_task(_try_instance(base, invidious_path)) for base in instances]
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
                    errors.append(str(exc))
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
        # Run Invidious and innertube concurrently so innertube cold-start doesn't block
        invidious_task = asyncio.create_task(
            proxy_parallel(category, invidious_path, prefer_valid_videos=True)
        )
        innertube_task = asyncio.create_task(fetch_innertube_videos(channel_id, tab))
        results = await asyncio.gather(invidious_task, innertube_task, return_exceptions=True)
        inv_result, innertube_items = results[0], results[1]

        if isinstance(innertube_items, Exception):
            innertube_items = []

        if isinstance(inv_result, Exception):
            if innertube_items:
                fallback = _innertube_to_invidious(innertube_items, channel_id)
                return JSONResponse(fallback if tab == "latest" else {"videos": fallback, "continuation": None})
            return JSONResponse({"error": str(inv_result)}, status_code=502)

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
    return {"ver": "1.10"}


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
    self_url = str(request.base_url).rstrip("/")
    asyncio.create_task(_ping_keepalive(self_url))
    return templates.TemplateResponse(request, "index.html")

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


# ── Static files & catch-all ─────────────────────────────────────────────────

app.mount("/static", StaticFiles(directory="templates/static"), name="static")
