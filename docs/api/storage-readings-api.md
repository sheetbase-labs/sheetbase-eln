# Freezer and room readings API

Temperatures and other readings are kept for storage units (freezers, fridges,
incubators) and rooms. They use the external API, the MCP server, the
assistant and webhooks.

## Send readings

`record_storage_readings` (scope `lab:write`). Name exactly one of
`p_unit_id` and `p_room_id`.

```jsonc
// POST /api/db/rpc/record_storage_readings
{
  "p_unit_id": "00000000-0000-4000-8000-000000000201",
  "p_room_id": null,
  "p_readings": [
    {
      "feed": "Temperature",
      "value": -78.4,
      "unit": "°C",
      "at": "2026-11-06T09:00:00Z",
    },
  ],
}
```

Returns `{ "stored": 1, "feeds": 1 }`. A measurement that does not exist yet is
created (up to 50 per place), and a `Temperature` on a unit or room starts with
that place's own range as its limits. The caller needs write access in the
workspace.

## Read them

`query_storage_readings` (scope `lab:read`). Leave both ids out for every
place, or pass `p_out_of_range_only: true` to see only what is outside its
limits. Each entry has the latest `lastValue` and `lastAt`, `lowLimit`,
`highLimit`, `state` (`ok`, `low` or `high`) and `outOfRangeSince`.

## MCP and assistant

- `sheetbase.storage.readings` reads the same thing for agents (scope
  `lab:read`, read only). The in-app assistant uses it to answer which
  freezers are out of range.
- The assistant can log a reading from a card the person confirms
  (`sheetbase.storage.log_reading`); it calls `record_storage_readings` as that
  person.
- Agents log readings with `sheetbase.lab.act` (`record_storage_readings`),
  acting as the person their personal token belongs to. Needs `lab:write` and
  the workspace's "Agents can act in the lab" setting.

## Webhooks and events

When a reading takes a measurement outside its limits, or back inside, the
people who manage storage get a notification and these events are sent:

- `storage.alarm.raised`
- `storage.alarm.cleared`

The payload names the `feed`, its `state` (`low`, `high` or `ok`), `value`,
`lowLimit`, `highLimit`, `unit`, `at` and the `storageUnitId` or `storageRoomId`.
Individual readings are not events (too many); read them with
`query_storage_readings`. See the [event catalogue](event-catalogue.md).
