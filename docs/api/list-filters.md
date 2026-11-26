# List filters

Every record list in the app (samples, experiments, registry, materials,
protocols, templates, datasets, models, instruments, reports, pipelines,
requests, shipments, plates, incidents, analyses) filters with one tree of
conditions. It is the same tree Search uses and `api.search` takes as
`p_filter`.

In the page address it is the `filter` parameter, as compact JSON:

```json
{
  "g": "AND",
  "k": [
    { "f": "status", "o": "in", "v": ["reserved", "quarantined"] },
    { "f": "created", "o": "gte", "v": "2026-11-01" }
  ]
}
```

- `g` is the group (`AND`, `OR` or `NOT`) and `k` its conditions or groups.
- `f` is the column, `o` the operator and `v` the value (a list for `in` and
  `between`).
- Operators: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `contains`, `startsWith`,
  `endsWith`, `in`, `between`, `isNull`, `notNull`, `withinLastDays`. Which
  apply depends on the column: text, number, date, yes/no, or a list to pick
  from.

## Over the API, MCP and the assistant

Lists backed by the database (samples, experiments) turn the tree into one
PostgREST `and=(...)` clause on the `records` table, so a token can ask for the
same rows with the same clause, for example
`GET /api/db/records?kind=eq.sample&and=(status.in.("reserved","quarantined"),created_at.gte."2026-11-01")`.
Search takes the tree itself as `p_filter`. Reads through MCP
(`sheetbase.canonical.read`) and the assistant (`sheetbase.lab.list`) use the
same table filters. The filter writes nothing, so there are no webhook events.
