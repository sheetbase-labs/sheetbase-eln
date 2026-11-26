# List filters

Every record list in the app (samples, experiments, registry, materials,
protocols, templates, datasets, models, instruments, reports, pipelines,
requests, shipments, plates, incidents, analyses, projects) filters with one tree of
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

## Where the columns come from

A list does not name its filter columns. They come from the rows it holds: each
value a row carries is a column, typed by what the rows hold (number, date,
yes/no, a short list of words to pick from, or text), a key that names a project
or a person gets the lookup picker, and a record's model fields are added
alongside. A new column on the rows is a new filter with no further work. A list
only passes names for keys that read badly, or keys to leave out.

Lists loaded in full (everything except samples and experiments) filter the rows
in the page, so counts are always over the whole set. Samples and experiments
page in the database, so they map the same tree to the clause above.
