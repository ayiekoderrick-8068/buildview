"""Runs parsing in a separate, resource-limited process so a hostile or huge drawing cannot hang or
exhaust the worker. The child gets a CPU-time and address-space limit and is killed on timeout."""

from __future__ import annotations

import multiprocessing as mp
import resource
from typing import Any

from .parser import DxfParseError, parse_dxf


def _child(conn: Any, data: bytes, mem_mb: int, cpu_s: int, max_entities: int) -> None:
    try:
        resource.setrlimit(resource.RLIMIT_AS, (mem_mb * 1024 * 1024, mem_mb * 1024 * 1024))
        resource.setrlimit(resource.RLIMIT_CPU, (cpu_s, cpu_s + 1))
        try:
            conn.send(("ok", parse_dxf(data, max_entities)))
        except DxfParseError as exc:
            conn.send(("error", {"code": exc.code, "message": exc.message}))
        except MemoryError:
            conn.send(("error", {"code": "resource_limit", "message": "The drawing is too complex to process within the memory limit."}))
        except Exception as exc:  # parser bug or unexpected structure: fail closed
            conn.send(("error", {"code": "parse_failed", "message": f"Unexpected error while parsing ({type(exc).__name__})."}))
    finally:
        conn.close()


def parse_sandboxed(data: bytes, *, timeout_s: int = 30, mem_mb: int = 2048, max_entities: int = 100_000) -> dict[str, Any]:
    ctx = mp.get_context("spawn")  # fork() from a multi-threaded server can deadlock
    parent, child = ctx.Pipe(duplex=False)
    proc = ctx.Process(target=_child, args=(child, data, mem_mb, timeout_s, max_entities), daemon=True)
    proc.start()
    child.close()
    try:
        if parent.poll(timeout_s):
            kind, payload = parent.recv()
        else:
            proc.kill()
            raise DxfParseError("timeout", f"Processing exceeded {timeout_s} s and was stopped.")
    except EOFError:
        raise DxfParseError("resource_limit", "The processing worker was terminated (resource limit).") from None
    finally:
        proc.join(2)
        if proc.is_alive():
            proc.kill()
    if kind == "error":
        raise DxfParseError(payload["code"], payload["message"])
    return payload
