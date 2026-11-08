"""Plugins: call an operation an installed plugin declares.

An owner or administrator installs a plugin in Settings › Plugins. Every
operation it declares gets an API route, ``POST /api/plugins/<key>/<operation>``,
and this resource is the one generic way to reach all of them::

    result = client.plugins.call("cell-count", "viability", {"live": 92, "dead": 8})
    result["viability"]   # 92.0

``key`` is the plugin's name in the workspace (the last part of its id, so
``acme.cell-count`` is ``cell-count``). Use a **personal** token: a service
token is refused so every call is attributed to a person. A ``read`` operation
needs a ``:read`` scope; a ``write`` operation needs ``lab:write``.
"""

from __future__ import annotations

from typing import Any, Optional

from sheetbase._http import HttpTransport


class PluginsResource:
    def __init__(self, transport: HttpTransport) -> None:
        self._transport = transport

    def call(
        self, key: str, operation: str, input: Optional[dict[str, Any]] = None
    ) -> dict[str, Any]:
        """Run an operation and return its declared outputs."""
        result = self._transport.post(
            f"/api/plugins/{key}/{operation}", json_body={"input": input or {}}
        )
        return result["output"]
