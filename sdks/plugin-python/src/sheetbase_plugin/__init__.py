"""Write Sheetbase plugins in plain Python.

A plugin is a folder with a ``plugin.json`` that says what it adds and some
``.py`` files that do the work. Each operation or analysis the manifest lists
points at one function, written as ``module:function``::

    # python/ops.py
    from sheetbase_plugin import PluginError

    def viability(input):
        total = input["live"] + input["dead"]
        if total == 0:
            raise PluginError("Count at least one cell.")
        return {"viability": round(100 * input["live"] / total, 1)}

The function runs inside Sheetbase's isolated Python runner: no network, no
files outside the plugin, no access to the database. It gets the declared
inputs and returns the declared outputs. ``sheetbase-plugin run`` runs it the
same way on your own machine.
"""

__version__ = "0.1.0"

__all__ = ["HostError", "PluginError", "__version__", "host_call", "host_calls"]


class PluginError(Exception):
    """Refuse a call with a message a scientist can act on.

    Any other exception is reported as a crash of the plugin. Raise this one for
    expected problems such as "the counts are zero".
    """


class HostError(PluginError):
    """The app refused a call a plugin made with ``host_call``, or it failed.

    ``code`` is set when the app gave one, such as ``scope_missing``.
    """

    def __init__(self, message, code=None):
        super().__init__(message)
        self.code = code


# Calls into the app --------------------------------------------------------
#
# A plugin has no network and no database, so it asks Sheetbase to act for it:
# ``host_call("sheetbase.lab.act", {"action": "list_compound_lots", ...})`` runs
# any tool the MCP server has, as the person who ran the operation, if the
# plugin's manifest asked for the scope. A change is only made after that
# person says yes.
#
# How it works: the operation stops at the first call it has no answer for and
# Sheetbase runs the call and then runs the operation again from the top with
# the answers it has so far, so a call is made once even though the function
# runs again. Write the function so that what happens before a call does not
# depend on anything but its input and the earlier answers (no random numbers,
# no clock), and do not catch ``BaseException``.


class _HostNeeded(BaseException):
    """Raised to stop the run until Sheetbase has made the calls it lists."""

    def __init__(self, calls):
        super().__init__("host call needed")
        self.calls = calls


_state = {"results": [], "cursor": 0}


def _begin_host(results):
    _state["results"] = list(results or [])
    _state["cursor"] = 0


def host_call(name, arguments=None):
    """Ask Sheetbase to run the tool ``name`` (for example ``sheetbase.lab.act``) and return its result."""
    return host_calls([(name, arguments)])[0]


def host_calls(requests):
    """Ask for several calls at once: a list of ``(name, arguments)``; returns the results in order."""
    start = _state["cursor"]
    out = []
    pending = []
    for name, arguments in requests:
        index = _state["cursor"]
        _state["cursor"] += 1
        if index < len(_state["results"]):
            answer = _state["results"][index]
            if not answer.get("ok"):
                raise HostError(answer.get("error") or "The call failed.", answer.get("code"))
            out.append(answer.get("result"))
        else:
            pending.append({"name": name, "arguments": dict(arguments or {})})
    if pending:
        raise _HostNeeded(pending)
    return out
