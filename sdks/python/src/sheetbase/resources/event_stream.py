"""The replayable event stream: every catalogued change, in order, as CloudEvents.

Needs a credential with the ``admin:read`` scope. A cursor is the ``sequence``
of the last event you handled; keep it and pass it as ``after`` to carry on
where you stopped.
"""

from __future__ import annotations

import json
import time
from typing import Any, Iterator, Optional, Sequence

from sheetbase._http import HttpTransport, StreamError
from sheetbase.errors import data_path_error


class CursorExpiredError(Exception):
    """The cursor is older than the events kept. Start again from ``earliest``."""

    def __init__(self, message: str, earliest: Optional[int], retention_days: Optional[int]) -> None:
        super().__init__(message)
        self.earliest = earliest
        self.retention_days = retention_days


_CATEGORIES = {
    400: "validation_error",
    401: "unauthenticated",
    403: "permission_denied",
    404: "not_found",
    429: "rate_limited",
}


def _raise(err: StreamError) -> None:
    if err.status == 410:
        raise CursorExpiredError(
            str(err), err.details.get("earliest"), err.details.get("retentionDays")
        ) from err
    raise data_path_error(_CATEGORIES.get(err.status, "server_error"), str(err)) from err


class EventStreamResource:
    def __init__(self, transport: HttpTransport) -> None:
        self._transport = transport

    def page(
        self,
        *,
        after: Optional[int] = None,
        limit: int = 200,
        types: Optional[Sequence[str]] = None,
    ) -> dict[str, Any]:
        """One page: ``events`` (CloudEvents), ``nextCursor`` and ``hasMore``."""
        params: dict[str, Any] = {"limit": limit, "format": "json"}
        if after is not None:
            params["after"] = after
        if types:
            params["types"] = ",".join(types)
        try:
            return self._transport.get("/api/events/stream", params=params)
        except Exception as err:  # the JSON error envelope carries ``code``
            if getattr(err, "code", None) == "cursor_expired":
                raise CursorExpiredError(str(err), None, None) from err
            raise

    def pages(
        self,
        *,
        after: Optional[int] = None,
        limit: int = 200,
        types: Optional[Sequence[str]] = None,
    ) -> Iterator[dict[str, Any]]:
        """Pages from ``after`` until you have caught up."""
        cursor = after if after is not None else 0
        while True:
            page = self.page(after=cursor, limit=limit, types=types)
            yield page
            cursor = page["nextCursor"]
            if not page["hasMore"]:
                return

    def stream(
        self,
        *,
        after: Optional[int] = None,
        types: Optional[Sequence[str]] = None,
        limit: int = 200,
        reconnect_delay: float = 3.0,
    ) -> Iterator[dict[str, Any]]:
        """Yield CloudEvents as they happen, reconnecting from the last one.

        Without ``after`` the stream starts at the newest event. Run it in a
        loop of your own and store ``event["sequence"]`` as you go.
        """
        cursor = after
        while True:
            params: dict[str, Any] = {"limit": limit}
            if cursor is not None:
                params["after"] = cursor
            if types:
                params["types"] = ",".join(types)
            event_name: Optional[str] = None
            data: list[str] = []
            try:
                for line in self._transport.stream_lines("/api/events/stream", params=params):
                    if line == "":
                        if event_name == "cursor_expired" and data:
                            info = json.loads("\n".join(data))
                            raise CursorExpiredError(
                                "Cursor is older than the events kept.",
                                info.get("earliest"),
                                info.get("retentionDays"),
                            )
                        if data and event_name:
                            event = json.loads("\n".join(data))
                            cursor = int(event["sequence"])
                            yield event
                        event_name, data = None, []
                    elif line.startswith("event:"):
                        event_name = line[6:].strip()
                    elif line.startswith("data:"):
                        data.append(line[5:].lstrip())
            except StreamError as err:
                _raise(err)
            except Exception as err:  # a dropped connection: carry on from the cursor
                if isinstance(err, (CursorExpiredError, GeneratorExit)):
                    raise
                if not _is_network_error(err):
                    raise
            time.sleep(reconnect_delay)


def _is_network_error(err: Exception) -> bool:
    import httpx

    return isinstance(err, (httpx.TransportError, httpx.StreamError))
