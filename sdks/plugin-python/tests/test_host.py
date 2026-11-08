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
