import json
import pathlib

from sheetbase_plugin import cli

EXAMPLE = str(pathlib.Path(__file__).parent.parent / "examples" / "cell-count")


def test_validate_and_test_the_example(capsys):
    assert cli.main(["validate", EXAMPLE]) == 0
    assert cli.main(["test", EXAMPLE]) == 0
    out = capsys.readouterr().out
    assert "2 passed, 0 failed" in out


def test_run_prints_the_answer(capsys):
    code = cli.main(["run", "viability", "--folder", EXAMPLE, "--input", '{"live": 9, "dead": 1}'])
    assert code == 0
    assert json.loads(capsys.readouterr().out) == {"total": 10, "viability": 90.0}


def test_run_names_a_refusal_and_a_wrong_input(capsys):
    assert cli.main(["run", "viability", "--folder", EXAMPLE, "--input", '{"live": 0, "dead": 0}']) == 1
    assert "Count at least one cell." in capsys.readouterr().out
    assert cli.main(["run", "viability", "--folder", EXAMPLE, "--input", '{"live": "x", "dead": 0}']) == 1
    assert "should be a integer" in capsys.readouterr().out


def test_init_makes_a_plugin_that_passes(tmp_path, capsys):
    target = str(tmp_path / "hello")
    assert cli.main(["init", target]) == 0
    assert cli.main(["test", target]) == 0
    assert cli.main(["init", target]) == 1  # not empty now


def test_pack_then_inspect(tmp_path, capsys):
    out = str(tmp_path / "x.sbplugin")
    assert cli.main(["pack", EXAMPLE, "-o", out]) == 0
    assert cli.main(["inspect", out]) == 0
    assert "acme.cell-count" in capsys.readouterr().out


def test_dev_runs_once_and_reports_a_broken_plugin(tmp_path, capsys):
    target = str(tmp_path / "p")
    cli.main(["init", target])
    (tmp_path / "p" / "python" / "ops.py").write_text("def other(i):\n    return {}\n")
    assert cli.main(["dev", target, "--once"]) == 0
    assert "does not define" in capsys.readouterr().out
