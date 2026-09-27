# Status

A controlled vocabulary shown as a 7px dot plus plain text. Colour sits in the mark; the text stays `text` so meaning never depends on colour.

- Component: `Sheetbase.Status` with `tone` and the label as children; `Sheetbase.Dot` for a mark on its own.
- Tones: `progress` In progress, `review` In review, `ok` Approved / Released / Valid, `warn` On hold / Expiring, `bad` errors, `draft` Draft, `none` Not started, `stored` Stored / Consumed, `analysis` runs.
- Classes for plain markup: `.dot` with `.st-*`.
- No saturated pills. Counts of problems read as text ("1 validation error").
