from fastapi import APIRouter, Request
from fastapi.responses import FileResponse

from core import templates

router = APIRouter()


@router.get("/tool")
async def tool_index(request: Request):
    return templates.TemplateResponse(request, "tool/home.html", {"active": "tool"})


@router.get("/tool/youtube")
async def tool_youtube(request: Request):
    return templates.TemplateResponse(request, "tool/youtube/index.html", {"active": "tool"})


@router.get("/tool/youtube/sia")
async def tool_youtube_sia():
    return FileResponse("templates/tool/youtube/sia-tube.html", media_type="text/html")


@router.get("/tool/youtube/xerox")
async def tool_youtube_xerox():
    return FileResponse("templates/tool/youtube/xerox.html", media_type="text/html")


@router.get("/tool/youtube/wista")
async def tool_youtube_wista():
    return FileResponse("templates/tool/youtube/wista.html", media_type="text/html")
