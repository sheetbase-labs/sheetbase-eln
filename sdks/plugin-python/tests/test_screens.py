"""The screen checker agrees with the app's: both run tests/screen_cases.json."""
import json
import pathlib

import pytest

from sheetbase_plugin import ui

CASES = json.loads((pathlib.Path(__file__).parent / "screen_cases.json").read_text())


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_shared_cases(case):
    problems = ui.validate_screen(case["result"])
    assert (problems == []) == case["ok"], problems


def test_builders_make_valid_screens():
    result = ui.screen(
        ui.stack(
            ui.heading("Hi"),
            ui.row(ui.badge("a", tone="info"), ui.stat("N", 3)),
            ui.form(ui.number_input("n", "N", required=True), submit=ui.submit("Go", "go")),
            ui.table([{"key": "a", "label": "A"}], [{"a": 1}]),
        ),
        state={"n": 1},
        notice=ui.notice("Done.", tone="success"),
    )
    assert ui.validate_screen(result) == []


def test_an_input_called_kind_does_not_clash():
    assert ui.validate_screen(ui.screen(ui.input("n", "N", kind="number"))) == []
