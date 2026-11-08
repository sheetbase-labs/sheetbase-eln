import json
import pathlib

import pytest

from sheetbase_plugin.package import check_package, pack, read_folder, unpack

CASES = [
    case
    for name in ("package_cases.json", "point_cases.json")
    for case in json.loads((pathlib.Path(__file__).parent / name).read_text())
]
EXAMPLES = pathlib.Path(__file__).parent.parent / "examples"


def files_of(case):
    return {**case["files"], "plugin.json": json.dumps(case["manifest"])}


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_shared_cases(case):
    errors = check_package(files_of(case))
    assert (errors == []) is case["valid"], errors


@pytest.mark.parametrize("folder", sorted(p.name for p in EXAMPLES.iterdir() if p.is_dir()))
def test_examples_are_valid(folder):
    assert check_package(read_folder(EXAMPLES / folder)) == []


def test_pack_is_stable_and_round_trips():
    files = read_folder(EXAMPLES / "cell-count")
    first, second = pack(files), pack(files)
    assert first == second
    assert unpack(first) == files


def test_invalid_json_is_named():
    errors = check_package({"plugin.json": "{nope"})
    assert any("not valid JSON" in e for e in errors)
