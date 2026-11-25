import datetime as dt

import pytest

from sheetbase.resources.datasets import DatasetRowBatch
from sheetbase.values import (
    encode_value,
    format_time,
    from_timedelta,
    parse_time,
    to_timedelta,
)


def test_time_round_trips_through_its_stored_form():
    assert parse_time("09:30:00") == dt.time(9, 30)
    assert parse_time("9:05") == dt.time(9, 5)
    assert format_time(dt.time(14, 5, 30)) == "14:05:30"
    assert parse_time(None) is None


@pytest.mark.parametrize("bad", ["09:010", "24:00", "nine", ""])
def test_a_malformed_time_is_refused(bad):
    with pytest.raises(ValueError):
        parse_time(bad)


def test_duration_is_seconds():
    assert to_timedelta(5400) == dt.timedelta(hours=1, minutes=30)
    assert from_timedelta(dt.timedelta(minutes=10)) == 600
    assert from_timedelta(dt.timedelta(milliseconds=500)) == 0.5
    with pytest.raises(ValueError):
        from_timedelta(dt.timedelta(seconds=-1))


def test_row_batches_send_times_and_durations_in_stored_form():
    batch = DatasetRowBatch().create(
        row_id="r1",
        values={"start": dt.time(9, 30), "spin": dt.timedelta(minutes=10), "n": 3},
    )
    assert batch.rows[0]["values"] == {"start": "09:30:00", "spin": 600, "n": 3}
    assert encode_value("text") == "text"
