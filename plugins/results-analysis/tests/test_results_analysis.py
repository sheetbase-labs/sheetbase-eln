import base64
import os
import sys

import numpy as np
import pytest

HERE = os.path.dirname(__file__)
sys.path.insert(0, os.path.join(HERE, "..", "python"))
sys.path.insert(0, os.path.join(HERE, "..", "..", "..", "sdks", "plugin-python", "src"))

import analysis_ops  # noqa: E402
import results_analysis as ra  # noqa: E402
from sheetbase_plugin import PluginError  # noqa: E402


def curve_rows(group="A", ec50=1.0, noise=0.0):
    doses = [0.01, 0.03, 0.1, 0.3, 1, 3, 10, 30, 100]
    rng = np.random.default_rng(1)
    return [
        {"group": group, "dose": d, "response": 5 + 95 / (1 + (ec50 / d) ** 1.2) + rng.normal(0, noise)}
        for d in doses
        for _ in range(2)
    ]


def figures(rows):
    return [r for r in rows if r["kind"] == "figure"]


def test_four_pl_recovers_parameters():
    out = ra.run(curve_rows(ec50=2.0), {"kind": "dose_response", "x": "dose", "y": "response", "group": "group"})
    result = out[0]
    assert result["status"] == "fitted"
    assert result["ec50"] == pytest.approx(2.0, rel=0.02)
    assert result["hill"] == pytest.approx(1.2, rel=0.05)
    assert result["bottom"] == pytest.approx(5, abs=0.5)
    assert result["top"] == pytest.approx(100, abs=1)
    assert result["r2"] > 0.999


def test_decreasing_curve_and_two_groups():
    rows = curve_rows("A", 1.0) + [dict(r, group="B", response=100 - r["response"] + 5) for r in curve_rows("B", 3.0)]
    out = ra.run(rows, {"kind": "dose_response", "x": "dose", "y": "response", "group": "group"})
    results = [r for r in out if r["kind"] == "result"]
    assert [r["group"] for r in results] == ["A", "B"]
    assert all(r["status"] == "fitted" for r in results)
    assert results[1]["hill"] < 0


def test_too_few_doses_is_reported_not_raised():
    rows = [{"dose": d, "response": d} for d in (1, 2, 3)]
    out = ra.run(rows, {"kind": "dose_response", "x": "dose", "y": "response"})
    assert out[0]["status"].startswith("not fitted")


def test_figure_is_a_deterministic_svg():
    settings = {"kind": "dose_response", "x": "dose", "y": "response"}
    first = figures(ra.run(curve_rows(noise=2), settings))[0]["figure"]
    second = figures(ra.run(curve_rows(noise=2), settings))[0]["figure"]
    assert first == second
    assert first.startswith("data:image/svg+xml;base64,")
    assert b"<svg" in base64.b64decode(first.split(",", 1)[1])


def test_missing_column_names_the_columns():
    with pytest.raises(ValueError, match="There is no column called nope"):
        ra.run(curve_rows(), {"kind": "dose_response", "x": "nope", "y": "response"})


def test_standard_curve_linear_reads_unknowns():
    rows = [{"conc": c, "signal": 2 * c + 1, "name": f"S{c}"} for c in (0, 1, 2, 4, 8)]
    rows += [{"conc": None, "signal": 9, "name": "Sample A"}, {"conc": None, "signal": 100, "name": "Sample B"}]
    out = ra.run(rows, {"kind": "standard_curve", "x": "conc", "y": "signal", "label": "name"})
    assert out[0]["kind"] == "curve" and out[0]["r2"] == pytest.approx(1.0)
    samples = {r["name"]: r for r in out if r["kind"] == "sample"}
    assert samples["Sample A"]["concentration"] == pytest.approx(4.0)
    assert samples["Sample A"]["in_range"] == "yes"
    assert samples["Sample B"]["in_range"].startswith("no")


def test_standard_curve_needs_three_standards():
    with pytest.raises(ValueError, match="at least three"):
        ra.run([{"c": 1, "s": 1}, {"c": 2, "s": 2}], {"kind": "standard_curve", "x": "c", "y": "s"})


def test_compare_two_groups_welch():
    rows = [{"arm": "ctl", "v": v} for v in (1.0, 1.2, 0.9, 1.1)] + [{"arm": "drug", "v": v} for v in (2.0, 2.2, 1.9, 2.1)]
    out = ra.run(rows, {"kind": "compare_groups", "group": "arm", "y": "v"})
    test = [r for r in out if r["kind"] == "test"][0]
    assert test["test"] == "Welch t-test" and test["p_value"] < 0.001
    assert len(figures(out)) == 1


def test_compare_three_groups_anova_and_tukey():
    rows = []
    for arm, base in (("a", 1), ("b", 2), ("c", 3)):
        rows += [{"arm": arm, "v": base + d} for d in (-0.1, 0, 0.1, 0.05)]
    out = ra.run(rows, {"kind": "compare_groups", "group": "arm", "y": "v"})
    tests = [r["test"] for r in out if r["kind"] == "test"]
    assert tests == ["One-way ANOVA", "Tukey HSD", "Tukey HSD", "Tukey HSD"]


def test_transform_reads_the_settings_in_the_file():
    ra.PARAMS.clear()
    ra.PARAMS.update({"kind": "compare_groups", "group": "arm", "y": "v", "input": "data"})
    rows = [{"arm": "a", "v": 1}, {"arm": "a", "v": 2}, {"arm": "b", "v": 5}, {"arm": "b", "v": 6}]
    assert ra.transform({"data": rows}, {})[0]["kind"] == "group"


def test_axes_use_the_labels_given():
    import base64

    settings = {
        "kind": "dose_response",
        "x": "dose",
        "y": "response",
        "unit": "nM",
        "labels": {"x": "Concentration", "y": "Inhibition (%)"},
    }
    figure = figures(ra.run(curve_rows(), settings))[0]["figure"]
    svg = base64.b64decode(figure.split(",", 1)[1]).decode()
    assert "Concentration (nM)" in svg and "Inhibition (%)" in svg
    assert ">response<" not in svg


def test_standard_curve_four_pl_reads_unknowns():
    doses = [0.1, 0.3, 1, 3, 10, 30, 100, 300]
    rows = [{"c": d, "s": 5 + 95 / (1 + (8 / d) ** 1.1)} for d in doses]
    rows += [{"c": None, "s": 5 + 95 / (1 + (8 / 20) ** 1.1)}]
    out = ra.run(rows, {"kind": "standard_curve", "x": "c", "y": "s", "model": "4pl"})
    sample = [r for r in out if r["kind"] == "sample"][0]
    assert sample["concentration"] == pytest.approx(20, rel=0.02)
    assert sample["in_range"] == "yes"


def test_operation_returns_table_plots_and_a_summary():
    out = analysis_ops.analyse(
        {"kind": "compare_groups", "group": "arm", "y": "v", "rows": [{"arm": "a", "v": 1}, {"arm": "a", "v": 2}, {"arm": "b", "v": 8}, {"arm": "b", "v": 9}]}
    )
    assert [r["kind"] for r in out["results"]] == ["group", "group", "test"]
    assert out["figures"][0]["image"].startswith("data:image/svg+xml;base64,")
    assert "Welch t-test a vs b" in out["summary"]


def test_operation_turns_a_bad_request_into_a_plain_message():
    with pytest.raises(PluginError, match="There is no column called nope"):
        analysis_ops.analyse({"kind": "compare_groups", "group": "nope", "y": "v", "rows": [{"v": 1}]})
    with pytest.raises(PluginError, match="list of objects"):
        analysis_ops.analyse({"kind": "compare_groups", "rows": "x"})
