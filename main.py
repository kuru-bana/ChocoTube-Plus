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
    client = await get_client()
    resp = await client.get(f"{INVIDIOUS_BASE}/{category}.json")
    resp.raise_for_status()
    data = resp.json()
    instances = data.get("working_instances", [])
    if instances:
        category_cache[category] = {"instances": instances, "time": now}
    return instances


async def _try_instance(base: str, invidious_path: str) -> dict:
    client = await get_client()
    resp = await client.get(base + invidious_path)
    resp.raise_for_status()
    return {"data": resp.json(), "used_instance": base}


async def proxy_parallel(category: str, invidious_path: str, exclude_list: list = None) -> dict:
    instances = await get_instances(category)
    if exclude_list:
        instances = [b for b in instances if not any(ex in b or b in ex for ex in exclude_list)]
    if not instances:
        raise Exception(f'No working instances for category "{category}" after exclusions')

    tasks = [asyncio.create_task(_try_instance(base, invidious_path)) for base in instances]
    errors = []
    pending = set(tasks)
    winner = None
    try:
        while pending:
            done, pending = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED)
            for task in done:
                exc = task.exception()
                if exc is None and winner is None:
                    winner = task.result()
                elif exc is not None:
                    errors.append(str(exc))
            if winner is not None:
                break
    finally:
        for t in pending:
            t.cancel()
        if pending:
            await asyncio.gather(*pending, return_exceptions=True)

    if winner is not None:
        return winner
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

@app.get("/proxy/main/{path:path}")
async def proxy_main(path: str, request: Request):
    try:
        qs = request.url.query
        app_path = "/" + path + ("?" + qs if qs else "")
        category, invidious_path = map_path(app_path)
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
        result = await proxy_parallel(category, invidious_path, exclude_list)
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
