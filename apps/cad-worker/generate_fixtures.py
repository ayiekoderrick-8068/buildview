"""Generates the reference DXF fixtures and their golden parse results.

    cd apps/cad-worker && .venv/bin/python generate_fixtures.py

Outputs to tests/fixtures/dxf/*.dxf and tests/fixtures/parsed/*.json (repo root). The parsed JSON is the
exact output of app.parser.parse_dxf, committed so TypeScript recognition tests run against real
worker output. Fixtures are deterministic: re-running must produce identical files.
"""

from __future__ import annotations

import json
import pathlib

import ezdxf
from ezdxf import units as ezunits

from app.parser import parse_dxf

ROOT = pathlib.Path(__file__).resolve().parents[2]
DXF_DIR = ROOT / "tests" / "fixtures" / "dxf"
PARSED_DIR = ROOT / "tests" / "fixtures" / "parsed"
HANDLE_START = "100"


def new_doc(unit: int | None) -> ezdxf.document.Drawing:
    doc = ezdxf.new("R2018")
    doc.header["$HANDSEED"] = HANDLE_START
    if unit is None:
        doc.header["$INSUNITS"] = 0
    else:
        doc.units = unit
    for name in ("A-WALL", "A-DOOR", "A-GLAZ", "A-ANNO", "A-FURN", "A-ROOM"):
        doc.layers.add(name)
    return doc


def door_block(doc, name="DOOR_900", w=900.0):
    """Hinge at the origin, leaf shown open (90 deg), swing arc. Insert point lies on the wall centreline."""
    blk = doc.blocks.new(name)
    blk.add_line((0, 0), (0, w))
    blk.add_arc((0, 0), w, 0, 90)
    return blk


def window_block(doc, name="WINDOW_1500", w=1500.0, t=200.0):
    blk = doc.blocks.new(name)
    blk.add_lwpolyline([(0, -t / 2), (w, -t / 2), (w, t / 2), (0, t / 2)], close=True)
    blk.add_line((0, 0), (w, 0))
    return blk


def house(unit: int | None, k: float = 1.0, extras: bool = True):
    """Single-storey house, centreline walls, mm * k. 9 m x 7 m: living room (west) + two rooms (east)."""
    doc = new_doc(unit)
    msp = doc.modelspace()
    s = lambda v: v * k  # noqa: E731
    msp.add_lwpolyline([(s(0), s(0)), (s(9000), s(0)), (s(9000), s(7000)), (s(0), s(7000))], close=True, dxfattribs={"layer": "A-WALL"})
    msp.add_line((s(5000), s(0)), (s(5000), s(7000)), dxfattribs={"layer": "A-WALL"})
    msp.add_line((s(5000), s(3500)), (s(9000), s(3500)), dxfattribs={"layer": "A-WALL"})
    door_block(doc)
    window_block(doc)
    # exterior door in the south wall, hinge at x=2000
    msp.add_blockref("DOOR_900", (s(2000), s(0)), dxfattribs={"layer": "A-DOOR", "xscale": k, "yscale": k, "zscale": k})
    # interior door in the partition x=5000 at y=5000, rotated so it runs along the wall
    msp.add_blockref("DOOR_900", (s(5000), s(5000)), dxfattribs={"layer": "A-DOOR", "rotation": 90, "xscale": k, "yscale": k, "zscale": k})
    # windows: north wall x 1750..3250 and east wall y 4500..6000
    msp.add_blockref("WINDOW_1500", (s(1750), s(7000)), dxfattribs={"layer": "A-GLAZ", "xscale": k, "yscale": k, "zscale": k})
    msp.add_blockref("WINDOW_1500", (s(9000), s(4500)), dxfattribs={"layer": "A-GLAZ", "rotation": 90, "xscale": k, "yscale": k, "zscale": k})
    if extras:
        msp.add_text("LIVING", dxfattribs={"layer": "A-ANNO", "height": 200 * k, "insert": (s(2000), s(3000))})
        msp.add_spline([(s(1000), s(1000)), (s(1500), s(1800)), (s(2200), s(1200))], dxfattribs={"layer": "A-FURN"})
        msp.add_circle((s(7000), s(1750)), s(300), dxfattribs={"layer": "A-FURN"})
    return doc


def double_line():
    """6 m x 4 m room with a 3 m partition, each wall drawn as two parallel lines 200 mm apart."""
    doc = new_doc(ezunits.MM)
    msp = doc.modelspace()
    a = {"layer": "A-WALL"}
    o, i = 100.0, 100.0  # outer / inner offset of the 200 mm walls around centreline rectangle 0..6000 x 0..4000
    for p, q in [((-o, -o), (6000 + o, -o)), ((6000 + o, -o), (6000 + o, 4000 + o)), ((6000 + o, 4000 + o), (-o, 4000 + o)), ((-o, 4000 + o), (-o, -o))]:
        msp.add_line(p, q, dxfattribs=a)
    for p, q in [((i, i), (6000 - i, i)), ((6000 - i, i), (6000 - i, 4000 - i)), ((6000 - i, 4000 - i), (i, 4000 - i)), ((i, 4000 - i), (i, i))]:
        msp.add_line(p, q, dxfattribs=a)
    return doc


def gaps_and_duplicates():
    """Centreline walls with: a 30 mm corner gap (auto-closable), a 300 mm gap (critical), a duplicated line, a free-standing stub."""
    doc = new_doc(ezunits.MM)
    msp = doc.modelspace()
    a = {"layer": "A-WALL"}
    msp.add_line((0, 0), (5000, 0), dxfattribs=a)
    msp.add_line((5030, 0), (5030, 4000), dxfattribs=a)  # starts 30 mm off the corner (and is 30 mm east)
    msp.add_line((5030, 4000), (0, 4000), dxfattribs=a)
    msp.add_line((0, 3700), (0, 0), dxfattribs=a)  # leaves a 300 mm gap at the north-west corner
    msp.add_line((0, 0), (5000, 0), dxfattribs=a)  # exact duplicate
    msp.add_line((2500, 4000), (2500, 4600), dxfattribs=a)  # stub poking out
    return doc


def nested_block():
    doc = new_doc(ezunits.MM)
    msp = doc.modelspace()
    msp.add_lwpolyline([(0, 0), (4000, 0), (4000, 3000), (0, 3000)], close=True, dxfattribs={"layer": "A-WALL"})
    door_block(doc)
    set_ = doc.blocks.new("DOORSET")
    set_.add_blockref("DOOR_900", (0, 0))
    set_.add_line((-50, 0), (950, 0))
    msp.add_blockref("DOORSET", (1000, 0), dxfattribs={"layer": "A-DOOR"})
    return doc


def arcs_and_bulges():
    doc = new_doc(ezunits.MM)
    msp = doc.modelspace()
    msp.add_lwpolyline([(0, 0, 0, 0, 0), (3000, 0, 0, 0, 0.5), (3000, 3000, 0, 0, 0), (0, 3000, 0, 0, 0)], format="xyseb", close=True, dxfattribs={"layer": "A-WALL"})
    msp.add_arc((6000, 1500), 1500, 270, 90, dxfattribs={"layer": "A-WALL"})
    return doc


FIXTURES = {
    "house-mm": lambda: house(ezunits.MM),
    "house-feet": lambda: house(ezunits.FT, k=1 / 304.8),
    "house-missing-units": lambda: house(None),
    "house-double-line": double_line,
    "gaps-duplicates": gaps_and_duplicates,
    "nested-block": nested_block,
    "arcs-bulges": arcs_and_bulges,
}


def main() -> None:
    DXF_DIR.mkdir(parents=True, exist_ok=True)
    PARSED_DIR.mkdir(parents=True, exist_ok=True)
    for name, make in FIXTURES.items():
        path = DXF_DIR / f"{name}.dxf"
        make().saveas(path)
        result = parse_dxf(path.read_bytes())
        (PARSED_DIR / f"{name}.json").write_text(json.dumps(result, indent=1, sort_keys=True) + "\n")
        print(f"{name}: {len(result['entities'])} entities, {len(result['inserts'])} inserts, units={result['units']['name']}")
    (DXF_DIR / "malformed.dxf").write_bytes(b"0\nSECTION\n2\nHEADER\nthis is not a valid drawing\x00\xff\xfe garbage\n")
    (DXF_DIR / "fake.dwg").write_bytes(b"AC1032\x00\x00\x00\x00\x00 not a real dwg, signature only")
    print("malformed.dxf and fake.dwg written")


if __name__ == "__main__":
    main()
