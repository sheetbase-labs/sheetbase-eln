"""Time of day, duration and well position values.

A ``time`` column holds a 24-hour clock time with no date or zone, sent and
read as ``"HH:MM:SS"``. A ``duration`` column holds a number of seconds, zero
or more. These helpers turn them into and out of Python's own types, and
:func:`encode_value` is applied to every value the SDK writes, so a
:class:`datetime.time` or :class:`datetime.timedelta` can be passed straight in.

A ``well`` column holds a plate address stored as ``"A1"`` (rows A to AF,
columns 1 to 48). :func:`parse_well` turns typed forms such as ``"a01"`` into
the stored one, and :func:`well_sort_key` orders wells row by row. A
``person`` column holds a workspace member's user id.
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


_WELL = re.compile(r"^([A-Z]{1,2})0*([1-9]\d?)$")
MAX_WELL_ROWS = 32
MAX_WELL_COLUMNS = 48


def _row_number(label: str) -> int:
    row = 0
    for ch in label:
        row = row * 26 + (ord(ch) - 64)
    return row


def parse_well(value: Optional[str]) -> Optional[str]:
    """``"a01"`` (or ``"A 1"``) as the stored ``"A1"``; ``None`` stays ``None``."""
    if value is None:
        return None
    match = _WELL.match(re.sub(r"\s", "", value).upper())
    if not match:
        raise ValueError(f"not a well position: {value!r}")
    row, column = _row_number(match.group(1)), int(match.group(2))
    if row > MAX_WELL_ROWS or column > MAX_WELL_COLUMNS:
        raise ValueError(f"not a well position: {value!r}")
    return f"{match.group(1)}{column}"


def well_sort_key(value: str) -> int:
    """Row-major order, so ``sorted(wells, key=well_sort_key)`` puts A2 before A10."""
    well = parse_well(value) or ""
    letters = well.rstrip("0123456789")
    return _row_number(letters) * 100 + int(well[len(letters):])


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
    "parse_well",
    "to_timedelta",
    "well_sort_key",
]
