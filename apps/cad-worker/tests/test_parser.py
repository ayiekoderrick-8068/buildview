import json
import pathlib

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.parser import DxfParseError, parse_dxf
from app.sandbox import parse_sandboxed

FIX = pathlib.Path(__file__).resolve().parents[3] / "tests" / "fixtures"
DXF = FIX / "dxf"


def load(name: str) -> bytes:
    return (DXF / f"{name}.dxf").read_bytes()


def test_valid_house_units_layers_and_entities():
    r = parse_dxf(load("house-mm"))
    assert r["units"] == {"insunits": 4, "name": "millimetres", "toMetres": 0.001}
    layers = {layer["name"]: layer for layer in r["layers"]}
    assert layers["A-WALL"]["types"]["POLYLINE"] == 1 and layers["A-WALL"]["types"]["LINE"] == 2
    assert {"A-WALL", "A-DOOR", "A-GLAZ", "A-ANNO", "A-FURN"} <= set(layers)
    assert r["extents"]["min"] == [0.0, 0.0] or r["extents"]["min"][0] <= 0
    assert r["truncated"] is False


def test_unsupported_entities_are_reported_not_dropped():
    r = parse_dxf(load("house-mm"))
    types = {u["type"]: u for u in r["unsupported"]}
    assert types["TEXT"]["count"] == 1 and types["SPLINE"]["count"] == 1
    assert types["TEXT"]["sampleHandles"]


def test_inserts_have_geometry_bounds_and_transform():
    r = parse_dxf(load("house-mm"))
    doors = [i for i in r["inserts"] if i["name"] == "DOOR_900"]
    assert len(doors) == 2
    south = next(d for d in doors if d["at"] == [2000.0, 0.0])
    assert south["bbox"] == pytest.approx([2000.0, 0.0, 2900.0, 900.0], abs=1e-3)
    interior = next(d for d in doors if d["rotationDeg"] == 90.0)
    # rotated 90 degrees: swing now extends to -x of the insertion point
    assert interior["bbox"] == pytest.approx([4100.0, 5000.0, 5000.0, 5900.0], abs=1e-3)
    window = next(i for i in r["inserts"] if i["name"] == "WINDOW_1500" and i["rotationDeg"] == 0.0)
    assert window["bbox"] == pytest.approx([1750.0, 6900.0, 3250.0, 7100.0], abs=1e-3)


def test_missing_units_are_flagged_not_guessed():
    r = parse_dxf(load("house-missing-units"))
    assert r["units"]["insunits"] == 0 and r["units"]["toMetres"] is None
    assert any("does not declare its units" in w for w in r["warnings"])


def test_feet_units():
    r = parse_dxf(load("house-feet"))
    assert r["units"]["name"] == "feet" and r["units"]["toMetres"] == 0.3048
    # east wall at 9000 mm plus the rotated window block's 100 mm half-thickness
    assert r["extents"]["max"][0] == pytest.approx(9100 / 304.8, rel=1e-3)
    assert r["extents"]["max"][1] == pytest.approx(7100 / 304.8, rel=1e-3)  # arcs contribute exact bounds, not their full circle


def test_nested_blocks_are_expanded_with_transforms():
    r = parse_dxf(load("nested-block"))
    names = sorted(i["name"] for i in r["inserts"])
    assert names == ["DOORSET", "DOOR_900"]
    outer = next(i for i in r["inserts"] if i["name"] == "DOORSET")
    assert outer["bbox"][0] <= 950.0 and outer["bbox"][2] >= 1900.0  # door swing + frame line in world coords


def test_bulge_and_arc_are_preserved():
    r = parse_dxf(load("arcs-bulges"))
    poly = next(e for e in r["entities"] if e["type"] == "POLYLINE")
    assert any(abs(p[2]) > 0 for p in poly["points"])
    assert any(e["type"] == "ARC" for e in r["entities"])


def test_duplicates_are_kept_for_the_recognition_stage_to_report():
    r = parse_dxf(load("gaps-duplicates"))
    assert len(r["entities"]) == 6


def test_malformed_dxf_fails_safely():
    with pytest.raises(DxfParseError) as e:
        parse_dxf((DXF / "malformed.dxf").read_bytes())
    assert e.value.code == "malformed_dxf"
    with pytest.raises(DxfParseError):
        parse_dxf(b"")
    with pytest.raises(DxfParseError):
        parse_dxf(bytes(range(256)) * 20)


def test_entity_limit_marks_truncated():
    r = parse_dxf(load("house-mm"), max_entities=3)
    assert r["truncated"] is True and len(r["entities"]) == 3


def test_sandbox_returns_same_result_and_reports_errors():
    assert parse_sandboxed(load("house-mm")) == parse_dxf(load("house-mm"))
    with pytest.raises(DxfParseError) as e:
        parse_sandboxed(b"garbage")
    assert e.value.code == "malformed_dxf"


def test_golden_files_match_current_parser():
    for f in (FIX / "parsed").glob("*.json"):
        assert json.loads(f.read_text()) == json.loads(json.dumps(parse_dxf((DXF / f"{f.stem}.dxf").read_bytes()))), f.name


client = TestClient(app)


def test_http_parse_and_health():
    h = client.get("/health").json()
    assert h["status"] == "ok" and h["dwg"]["available"] is False
    res = client.post("/parse?format=dxf", content=load("house-mm"))
    assert res.status_code == 200 and res.json()["ok"] is True
    bad = client.post("/parse?format=dxf", content=b"nonsense")
    assert bad.status_code == 422 and bad.json()["code"] == "malformed_dxf"


def test_dwg_is_refused_honestly():
    res = client.post("/parse?format=dwg", content=(DXF / "fake.dwg").read_bytes())
    assert res.status_code == 422
    assert res.json()["code"] == "dwg_unavailable"
    assert "converter" in res.json()["message"].lower()
