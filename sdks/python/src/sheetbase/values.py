"""Time of day and duration values.

A ``time`` column holds a 24-hour clock time with no date or zone, sent and
read as ``"HH:MM:SS"``. A ``duration`` column holds a number of seconds, zero
or more. These helpers turn them into and out of Python's own types, and
:func:`encode_value` is applied to every value the SDK writes, so a
:class:`datetime.time` or :class:`datetime.timedelta` can be passed straight in.
"""
from __future__ import annotations

import datetime as _dt
import re
from typing import Any, Optional, Union

_TIME = re.compile(r"^([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$")


def parse_time(value: Optional[str]) -> Optional[_dt.time]:
    """``"09:30:00"`` (or ``"9:30"``) as a :class:`datetime.time`; ``None`` stays ``None``."""
    if value is None:
        return None
    match = _TIME.match(value.strip())
    if not match:
        raise ValueError(f"not a 24-hour time: {value!r}")
    return _dt.time(int(match.group(1)), int(match.group(2)), int(match.group(3) or 0))


def format_time(value: _dt.time) -> str:
    """A :class:`datetime.time` as the stored ``"HH:MM:SS"``. Fractions of a second are dropped."""
    return value.strftime("%H:%M:%S")


def to_timedelta(seconds: Optional[Union[int, float]]) -> Optional[_dt.timedelta]:
    """A stored duration (seconds) as a :class:`datetime.timedelta`."""
    if seconds is None:
        return None
    return _dt.timedelta(seconds=seconds)


def from_timedelta(value: _dt.timedelta) -> Union[int, float]:
    """A :class:`datetime.timedelta` as the stored number of seconds."""
    if value < _dt.timedelta(0):
        raise ValueError("a duration must be zero or more")
    seconds = value.total_seconds()
    return int(seconds) if seconds.is_integer() else seconds


def encode_value(value: Any) -> Any:
    """A value ready to send: times become ``"HH:MM:SS"`` and timedeltas seconds.

    pandas ``Timedelta`` subclasses :class:`datetime.timedelta`, so DataFrame
    duration columns upload as seconds too. Other values pass through.
    """
    if isinstance(value, _dt.timedelta):
        return from_timedelta(value)
    if isinstance(value, _dt.time):
        return format_time(value)
    return value


__all__ = [
    "encode_value",
    "format_time",
    "from_timedelta",
    "parse_time",
    "to_timedelta",
]
