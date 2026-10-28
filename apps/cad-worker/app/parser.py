"""DXF parsing for BuildView AI.

Reads a DXF file with ezdxf and returns a plain-JSON description of the supported geometry
(LINE, LWPOLYLINE, POLYLINE, ARC, CIRCLE, INSERT/BLOCK). Anything else is *counted and reported*,
never silently dropped. Nothing in the drawing is ever executed: ezdxf only parses data.

The parser does NOT interpret architecture (walls/doors/rooms) and does NOT guess scale: it reports
the drawing's declared units (or that they are missing) and leaves recognition to the geometry
engine, after the architect has confirmed units.
"""

from __future__ import annotations

import math
import os
import tempfile
from typing import Any

import ezdxf
from ezdxf import bbox as ezbbox
from ezdxf.lldxf.const import DXFError

# $INSUNITS code -> (name, metres per unit). Codes not listed are reported by name with scale None.
INSUNITS: dict[int, tuple[str, float | None]] = {
    0: ("unitless", None),
    1: ("inches", 0.0254),
    2: ("feet", 0.3048),
    3: ("miles", 1609.344),
    4: ("millimetres", 0.001),
    5: ("centimetres", 0.01),
    6: ("metres", 1.0),
    7: ("kilometres", 1000.0),
    10: ("yards", 0.9144),
    14: ("decimetres", 0.1),
}

SUPPORTED = {"LINE", "LWPOLYLINE", "POLYLINE", "ARC", "CIRCLE", "INSERT"}
MAX_BLOCK_DEPTH = 3


class DxfParseError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def _xy(v: Any) -> list[float]:
    return [round(float(v[0]), 6), round(float(v[1]), 6)]


def parse_dxf(data: bytes, max_entities: int = 100_000) -> dict[str, Any]:
    if len(data) == 0:
        raise DxfParseError("empty_file", "The file is empty.")
    with tempfile.TemporaryDirectory(prefix="bv-dxf-") as tmp:
        path = os.path.join(tmp, "input.dxf")
        with open(path, "wb") as fh:
            fh.write(data)
        try:
            doc = ezdxf.readfile(path)
        except (DXFError, UnicodeDecodeError, ValueError, IndexError, KeyError) as exc:
            raise DxfParseError("malformed_dxf", f"The file is not a valid DXF drawing ({type(exc).__name__}).") from exc
        except OSError as exc:
            raise DxfParseError("malformed_dxf", f"The file could not be read as DXF ({type(exc).__name__}).") from exc

    insunits = int(doc.header.get("$INSUNITS", 0) or 0)
    name, to_metres = INSUNITS.get(insunits, (f"code {insunits}", None))
    warnings: list[str] = []
    if insunits == 0:
        warnings.append("The drawing does not declare its units ($INSUNITS = 0). The architect must confirm them.")
    elif to_metres is None:
        warnings.append(f"Drawing units '{name}' are not supported for automatic scaling; confirm units manually.")

    entities: list[dict[str, Any]] = []
    inserts: list[dict[str, Any]] = []
    layer_stats: dict[str, dict[str, int]] = {layer.dxf.name: {} for layer in doc.layers}
    unsupported: dict[str, dict[str, Any]] = {}
    state = {"truncated": False, "points": []}

    def count(layer: str, kind: str) -> None:
        layer_stats.setdefault(layer, {})
        layer_stats[layer][kind] = layer_stats[layer].get(kind, 0) + 1

    def note_unsupported(kind: str, handle: str) -> None:
        rec = unsupported.setdefault(kind, {"type": kind, "count": 0, "sampleHandles": []})
        rec["count"] += 1
        if len(rec["sampleHandles"]) < 8:
            rec["sampleHandles"].append(handle)

    def add(entity: dict[str, Any], pts: list[list[float]]) -> bool:
        if len(entities) >= max_entities:
            state["truncated"] = True
            return False
        entities.append(entity)
        state["points"].extend(pts)
        count(entity["layer"], entity["type"])
        return True

    def walk(source: Any, layer_override: str | None, handle_prefix: str, depth: int) -> None:
        for e in source:
            kind = e.dxftype()
            handle = f"{handle_prefix}{e.dxf.handle}"
            layer = e.dxf.layer
            if layer_override and layer == "0":
                layer = layer_override  # floating layer: inherits the INSERT's layer
            if state["truncated"]:
                return
            if kind == "LINE":
                a, b = _xy(e.dxf.start), _xy(e.dxf.end)
                add({"type": "LINE", "handle": handle, "layer": layer, "a": a, "b": b}, [a, b])
            elif kind == "LWPOLYLINE":
                pts = [[round(x, 6), round(y, 6), round(b, 9)] for x, y, b in e.get_points("xyb")]
                add({"type": "POLYLINE", "handle": handle, "layer": layer, "points": pts, "closed": bool(e.closed)}, [p[:2] for p in pts])
            elif kind == "POLYLINE":
                if e.is_2d_polyline:
                    pts = [[round(v.dxf.location.x, 6), round(v.dxf.location.y, 6), round(float(v.dxf.get("bulge", 0.0)), 9)] for v in e.vertices]
                    add({"type": "POLYLINE", "handle": handle, "layer": layer, "points": pts, "closed": bool(e.is_closed)}, [p[:2] for p in pts])
                else:
                    pts = [[round(p.x, 6), round(p.y, 6), 0.0] for p in e.points()]
                    warnings.append(f"3D/mesh POLYLINE {handle} was flattened to plan view (Z ignored).")
                    add({"type": "POLYLINE", "handle": handle, "layer": layer, "points": pts, "closed": bool(e.is_closed)}, [p[:2] for p in pts])
            elif kind == "ARC":
                if e.dxf.extrusion.z < 0:
                    note_unsupported("ARC (mirrored extrusion)", handle)
                    continue
                c = _xy(e.dxf.center)
                r = float(e.dxf.radius)
                add(
                    {"type": "ARC", "handle": handle, "layer": layer, "center": c, "radius": round(r, 6), "startDeg": round(float(e.dxf.start_angle), 6), "endDeg": round(float(e.dxf.end_angle), 6)},
                    [[c[0] - r, c[1] - r], [c[0] + r, c[1] + r]],
                )
            elif kind == "CIRCLE":
                c = _xy(e.dxf.center)
                r = float(e.dxf.radius)
                add({"type": "CIRCLE", "handle": handle, "layer": layer, "center": c, "radius": round(r, 6)}, [[c[0] - r, c[1] - r], [c[0] + r, c[1] + r]])
            elif kind == "INSERT":
                if depth >= MAX_BLOCK_DEPTH:
                    warnings.append(f"INSERT {handle} nests blocks deeper than {MAX_BLOCK_DEPTH} levels; inner blocks were skipped.")
                    note_unsupported("INSERT (too deeply nested)", handle)
                    continue
                try:
                    virtual = list(e.virtual_entities())
                except Exception as exc:  # malformed block definition; report, keep going
                    warnings.append(f"INSERT {handle} ('{e.dxf.name}') could not be expanded ({type(exc).__name__}).")
                    note_unsupported("INSERT (unexpandable)", handle)
                    continue
                box = ezbbox.extents(virtual, fast=True) if virtual else None
                bb = [round(box.extmin.x, 6), round(box.extmin.y, 6), round(box.extmax.x, 6), round(box.extmax.y, 6)] if box and box.has_data else None
                rot = round(float(e.dxf.get("rotation", 0.0)), 6)
                inserts.append(
                    {
                        "handle": handle,
                        "name": e.dxf.name,
                        "layer": layer,
                        "at": _xy(e.dxf.insert),
                        "rotationDeg": rot,
                        "scale": [round(float(e.dxf.get("xscale", 1.0)), 9), round(float(e.dxf.get("yscale", 1.0)), 9)],
                        "bbox": bb,
                    }
                )
                count(layer, "INSERT")
                walk(virtual, layer, f"{handle}/", depth + 1)
            else:
                note_unsupported(kind, handle)
                count(layer, kind)

    walk(doc.modelspace(), None, "", 0)

    pts = state["points"]
    extents = None
    if pts:
        extents = {"min": [min(p[0] for p in pts), min(p[1] for p in pts)], "max": [max(p[0] for p in pts), max(p[1] for p in pts)]}
        if not all(math.isfinite(v) for v in extents["min"] + extents["max"]):
            raise DxfParseError("invalid_geometry", "The drawing contains non-finite coordinates.")

    return {
        "format": "dxf",
        "dxfVersion": doc.dxfversion,
        "units": {"insunits": insunits, "name": name, "toMetres": to_metres},
        "extents": extents,
        "layers": [{"name": n, "entityCount": sum(t.values()), "types": t} for n, t in sorted(layer_stats.items())],
        "entities": entities,
        "inserts": inserts,
        "unsupported": sorted(unsupported.values(), key=lambda u: u["type"]),
        "warnings": warnings,
        "truncated": state["truncated"],
    }
