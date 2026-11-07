# Event stream

Every catalogued change in a workspace, in order, so another system can follow
what happens and pick up where it stopped. Events are
[CloudEvents 1.0](https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/spec.md)
in the structured JSON format.

```
GET /api/events/stream
```

Needs a signed-in session, or a token with the `admin:read` scope (a personal
token or a service credential). You only receive events you could see in the
app: the permission filter is the same one webhooks use.

## Reading a page

```
GET /api/events/stream?after=1200&limit=200&types=pipeline.run.reproduced
```

| Parameter | Meaning                                                                                                                      |
| --------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `after`   | The `sequence` of the last event you handled. Leave it out to start at the oldest kept event. `Last-Event-ID` works as well. |
| `limit`   | 1 to 1000, default 200.                                                                                                      |
| `types`   | Optional comma-separated [event names](event-catalogue.md). Names that are not in the catalogue are refused.                 |
| `format`  | `json` forces a JSON page even if the request accepts `text/event-stream`.                                                   |

```json
{
  "events": [
    {
      "specversion": "1.0",
      "id": "5b0b…",
      "source": "/workspaces/0e0b…",
      "type": "io.sheetbase.pipeline.run.reproduced",
      "subject": "pipeline_reproduction/9a1c…",
      "time": "2026-11-07T10:00:00.000Z",
      "datacontenttype": "application/json",
      "sequence": "1201",
      "data": {
        "actor": { "userId": "…", "credentialId": null, "clientId": null },
        "provenance": {
          "entityType": "pipeline_reproduction",
          "operation": "create",
          "entityUuid": "9a1c…",
          "sequence": 1201,
          "recordId": null,
          "projectId": null
        },
        "data": { "action": "reproduced", "runId": "…", "status": "matches" }
      }
    }
  ],
  "nextCursor": 1201,
  "hasMore": false,
  "earliest": 17,
  "latest": 1201,
  "retentionDays": 30
}
```

- `sequence` (a CloudEvents extension attribute) is the position in the
  workspace's log. It only goes up. Keep the `nextCursor` of the last page you
  handled and pass it as `after` next time.
- `hasMore` means read again straight away. `nextCursor` can move past events
  you cannot see or that are not catalogued, so a page may be empty and still
  advance.
- `id` never repeats for a different change; use it to ignore a repeat.

## Following live

Ask for `text/event-stream` and the server keeps the connection open:

```
curl -N -H "Accept: text/event-stream" -H "Authorization: Bearer $TOKEN" \
  "https://app.example.org/api/events/stream?after=1201"
```

Each event is one frame whose `id` is the sequence, so a client that reconnects
(`EventSource` does this by itself) resumes from `Last-Event-ID`:

```
id: 1202
event: pipeline.run.reproduced
data: { …the CloudEvent… }
```

Without `after` or `Last-Event-ID` a live stream starts at the newest event. A
`: keep-alive` comment goes out every 15 seconds, and the server closes the
stream every 10 minutes so reconnecting is routine.

## Retention and expired positions

Events are kept for the number of days set in **Settings → Integrations → Event
stream** (default 30; 1 to 3650). Asking from a position older than the oldest
kept event answers `410` with `error.code` `cursor_expired` (the live stream
sends a `cursor_expired` event and closes). Read from `earliest` instead, and
reload anything you need from the API tables.

## Errors

| Status | `error.code`         | Meaning                                     |
| ------ | -------------------- | ------------------------------------------- |
| 400    | `invalid_request`    | A bad `after`, `limit` or `types`.          |
| 401    | `unauthenticated`    | Not signed in.                              |
| 403    | `insufficient_scope` | The token lacks `admin:read`.               |
| 410    | `cursor_expired`     | The position is older than the events kept. |
| 429    | `rate_limited`       | More than 120 requests a minute.            |

## Other ways in

- **Python SDK**: `client.events.stream(after=1201)` yields events and
  reconnects from the last one; `client.events.page(...)` and `.pages(...)` read
  pages. Catch `CursorExpiredError`.
- **MCP**: `sheetbase.events.read` reads a page for an agent.
- **SQL and PostgREST**: `POST /api/db/rpc/event_stream_page` returns the same
  rows (`admin:read`).
- **Data access roles** (stewards) see the address in the Integrations settings.

## Not yet

NATS and Kafka are not built in. Something that sits between this stream and a
broker (read a page, publish, store the cursor) is a short loop with the SDK,
and a bridge that does it for you is planned.

## Which events exist

The names, summaries and payloads are in the [event catalogue](event-catalogue.md).
This release adds `pipeline.run.reproduced`, `lineage.endpoint.created`,
`lineage.endpoint.updated` and `lineage.delivery_failed`.
