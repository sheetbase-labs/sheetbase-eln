import sys

import pytest

from sheetbase_plugin import PluginError, host


@pytest.fixture(autouse=True)
def clean():
    yield
    host.install({})
    for name in [n for n in sys.modules if n in ("ops", "util", "util.maths")]:
        del sys.modules[name]


def test_imports_come_from_the_files_only():
    host.install({
        "ops.py": "from util.maths import double\n\ndef run(input):\n    return {'n': double(input['n'])}\n",
        "util/__init__.py": "",
        "util/maths.py": "def double(n):\n    return n * 2\n",
    })
    assert host.call_operation("ops:run", {"n": 4}) == {"n": 8}


def test_a_plain_value_is_wrapped_and_none_is_empty():
    host.install({"ops.py": "def a(i):\n    return 3\n\ndef b(i):\n    return None\n"})
    assert host.call_operation("ops:a", {}) == {"result": 3}
    assert host.call_operation("ops:b", {}) == {}


def test_missing_function_is_a_clear_error():
    host.install({"ops.py": "x = 1\n"})
    with pytest.raises(LookupError):
        host.call_operation("ops:nope", {})


def test_plugin_errors_pass_through():
    host.install({"ops.py": "from sheetbase_plugin import PluginError\n\ndef run(i):\n    raise PluginError('no cells')\n"})
    with pytest.raises(PluginError, match="no cells"):
        host.call_operation("ops:run", {})


def test_reinstall_replaces_modules():
    host.install({"ops.py": "def run(i):\n    return {'v': 1}\n"})
    assert host.call_operation("ops:run", {}) == {"v": 1}
    host.install({"ops.py": "def run(i):\n    return {'v': 2}\n"})
    assert host.call_operation("ops:run", {}) == {"v": 2}


def test_a_call_into_the_app_stops_the_run_until_it_is_answered():
    host.install({
        "ops.py": (
            "from sheetbase_plugin import host_call\n\n"
            "def run(i):\n"
            "    lots = host_call('sheetbase.lab.act', {'action': 'list_compound_lots'})\n"
            "    made = host_call('sheetbase.lab.act', {'action': 'add_compound_lot'})\n"
            "    return {'before': len(lots), 'made': made}\n"
        )
    })
    first = host.call_operation("ops:run", {})
    assert first == {"__host_calls__": [{"name": "sheetbase.lab.act", "arguments": {"action": "list_compound_lots"}}]}
    second = host.call_operation("ops:run", {"__host__": [{"ok": True, "result": [1, 2]}]})
    assert second == {"__host_calls__": [{"name": "sheetbase.lab.act", "arguments": {"action": "add_compound_lot"}}]}
    done = host.call_operation(
        "ops:run", {"__host__": [{"ok": True, "result": [1, 2]}, {"ok": True, "result": {"id": "x"}}]}
    )
    assert done == {"before": 2, "made": {"id": "x"}}


def test_a_refused_call_raises_a_plain_error_in_the_plugin():
    from sheetbase_plugin import HostError

    host.install({
        "ops.py": "from sheetbase_plugin import host_call\n\ndef run(i):\n    return host_call('sheetbase.lab.act', {})\n"
    })
    with pytest.raises(HostError, match="not allowed") as caught:
        host.call_operation("ops:run", {"__host__": [{"ok": False, "error": "not allowed", "code": "scope_missing"}]})
    assert caught.value.code == "scope_missing"


def test_several_calls_can_be_asked_for_at_once():
    host.install({
        "ops.py": (
            "from sheetbase_plugin import host_calls\n\n"
            "def run(i):\n    a, b = host_calls([('t.a', {}), ('t.b', {'x': 1})])\n    return {'a': a, 'b': b}\n"
        )
    })
    out = host.call_operation("ops:run", {})
    assert [c["name"] for c in out["__host_calls__"]] == ["t.a", "t.b"]
    assert host.call_operation("ops:run", {"__host__": [{"ok": True, "result": 1}, {"ok": True, "result": 2}]}) == {"a": 1, "b": 2}
