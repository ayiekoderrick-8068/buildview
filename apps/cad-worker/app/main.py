"""BuildView CAD worker (FastAPI). Internal service: the Node API is its only intended client.

POST /parse?format=dxf|dwg   body = raw file bytes
GET  /health
"""

from __future__ import annotations

import asyncio
import os
import shutil

import ezdxf
from fastapi import FastAPI, Query, Request
from fastapi.responses import JSONResponse

from .parser import DxfParseError
from .sandbox import parse_sandboxed

MAX_BYTES = int(os.environ.get("CAD_MAX_BYTES", 25 * 1024 * 1024))
MAX_CONCURRENT = int(os.environ.get("CAD_MAX_CONCURRENT", 2))
_slots = asyncio.Semaphore(MAX_CONCURRENT)

# DWG is a proprietary format. ezdxf cannot read it. A licensed converter (e.g. the Open Design
# Alliance File Converter) must be installed and its path configured. None is bundled or assumed.
DWG_CONVERTER = os.environ.get("DWG_CONVERTER")

app = FastAPI(title="BuildView CAD worker", docs_url=None, redoc_url=None)


def dwg_status() -> dict[str, object]:
    if DWG_CONVERTER and shutil.which(DWG_CONVERTER):
        return {"available": True, "reason": None}
    return {"available": False, "reason": "No licensed DWG-to-DXF converter is configured (set DWG_CONVERTER). Export the drawing as DXF instead."}


@app.get("/health")
def health() -> dict[str, object]:
    return {"status": "ok", "ezdxf": ezdxf.__version__, "dwg": dwg_status(), "maxBytes": MAX_BYTES}


@app.post("/parse")
async def parse(request: Request, format: str = Query("dxf", pattern="^(dxf|dwg)$")) -> JSONResponse:
    declared = int(request.headers.get("content-length") or 0)
    if declared > MAX_BYTES:
        return JSONResponse({"ok": False, "code": "too_large", "message": f"File exceeds {MAX_BYTES} bytes."}, status_code=413)
    body = await request.body()
    if len(body) > MAX_BYTES:
        return JSONResponse({"ok": False, "code": "too_large", "message": f"File exceeds {MAX_BYTES} bytes."}, status_code=413)
    if format == "dwg":
        status = dwg_status()
        return JSONResponse({"ok": False, "code": "dwg_unavailable", "message": str(status["reason"])}, status_code=422)
    async with _slots:
        loop = asyncio.get_running_loop()
        try:
            result = await loop.run_in_executor(None, lambda: parse_sandboxed(body))
        except DxfParseError as exc:
            return JSONResponse({"ok": False, "code": exc.code, "message": exc.message}, status_code=422)
    return JSONResponse({"ok": True, "result": result})
