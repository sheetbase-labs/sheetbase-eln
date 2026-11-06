"""Sentinel for optional arguments that should not be sent at all.

Generated RPC methods default optional parameters to :data:`UNSET`, so an
omitted argument is left out of the request body while an explicit ``None``
is sent as JSON ``null``.
"""
from __future__ import annotations

from typing import Final


class Unset:
    """Type of :data:`UNSET`."""

    _instance: "Unset | None" = None

    def __new__(cls) -> "Unset":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __repr__(self) -> str:
        return "UNSET"

    def __bool__(self) -> bool:
        return False


UNSET: Final = Unset()
