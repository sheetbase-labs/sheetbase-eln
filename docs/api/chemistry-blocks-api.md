# Chemistry notebook blocks API

Structures and reactions are notebook blocks, so they use the ordinary block
calls on the authenticated same-origin `/api/db` boundary and the external API:
`insert_block`, `update_block_payload`, `create_record_with_blocks`, and reading
the `blocks` table (scopes `projects:write` and `projects:read`). Nothing
chemistry-specific needs its own endpoint.

## Structure (`type = "structure"`)

```jsonc
// POST /api/db/rpc/insert_block
{
  "p_record_id": "00000000-0000-4000-8000-000000000101",
  "p_type": "structure",
  "p_payload": {
    "title": "Target",
    "name": "Aspirin",
    "molfile": "<MDL molfile of the drawing>",
    "formula": "C9H8O4",
    "mw": 180.159,
    "smiles": "CC(=O)Oc1ccccc1C(=O)O",
    "caption": "The compound this batch is aiming for.",
  },
  "p_payload_schema_version": 1,
  "p_after_block_id": null,
  "p_expected_structure_version": 3,
}
```

`molfile` is the only required field. The app works `formula`, `mw` and `smiles`
out of the drawing when it saves; send them when you have them so the block is
searchable straight away.

## Reaction (`type = "reaction"`)

`drawing` is the scheme in OpenChemLib's text encoding (it keeps the reagents
over the arrow, which an RXN file does not). `rows` is the reaction table; each
row has a `role` (`reactant`, `reagent`, `catalyst`, `solvent` or `product`), a
`name`, and any of `mw`, `equiv`, `massMg`, `volumeMl`, `density`,
`concentration` and `note`. Moles, theoretical mass and yield are worked out
when the block is shown, never stored: typing an amount for one row (mass,
volume or equivalents) replaces the others for that row. `limitingId` names the
row the others are measured against; the first reactant is used when it is
unset. At most 60 rows.

## Reading and search

Both types are in the notebook search index: titles, captions, names, formulas
and SMILES (and the names and formulas of a reaction's rows) are searchable
through `search` and `sheetbase.search`.

## Events

Block edits stay on the live event stream like every other block. A submitted or
signed notebook carries its chemistry blocks in the frozen revision, so
`notebook.submitted` and `notebook.signed` webhooks cover them. There are no
chemistry-specific event names.
