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

__all__ = ["PluginError", "__version__"]


class PluginError(Exception):
    """Refuse a call with a message a scientist can act on.

    Any other exception is reported as a crash of the plugin. Raise this one for
    expected problems such as "the counts are zero".
    """
