# Sequence blocks and molecular biology API

A sequence is a notebook block (`type = "sequence"`), so it uses the ordinary
block calls on the authenticated same-origin `/api/db` boundary and the external
API: `insert_block`, `update_block_payload`, `create_record_with_blocks`, and
reading the `blocks` table (scopes `projects:write` and `projects:read`).
Nothing sequence-specific needs its own endpoint for storing or reading one.

## The block (`type = "sequence"`)

```jsonc
// POST /api/db/rpc/insert_block
{
  "p_record_id": "00000000-0000-4000-8000-000000000101",
  "p_type": "sequence",
  "p_payload": {
    "title": "Backbone check",
    "name": "pTest",
    "molecule": "dna", // dna, rna or protein
    "topology": "circular", // or linear
    "residues": "TCGCGCGTTTCGGTGATGACGG…",
    "features": [
      {
        "id": 1,
        "type": "CDS",
        "label": "AmpR",
        "strand": -1,
        "start": 1626,
        "end": 2486,
        "parts": [{ "start": 1626, "end": 2486 }],
        "qualifiers": {},
      },
    ],
    "caption": "Backbone for the cloning below.",
  },
  "p_payload_schema_version": 1,
  "p_after_block_id": null,
  "p_expected_structure_version": 3,
}
```

`residues` and `name` are required; at most 400,000 bases. Positions are 1-based
and inclusive; a feature that crosses the origin of a circle has `start > end`.
The block can also carry what was done with the sequence, all optional and
checked on save: `mapEnzymes` (names), `digests`, `primers` (`name`, `seq` 5′ to
3′), `plans` (cloning plans: parts, method `ligation`, `golden_gate` or
`gibson`, enzymes), `reads` (Sanger reads, bases plus a Phred+33 quality string)
and `products` (what was registered, below).

Titles, names, captions, feature labels, primer names and plan names are in the
notebook search index (`search`, `sheetbase.search`). A submitted or signed
notebook carries its sequence blocks in the frozen revision.

## Calculations: `sheetbase.sequence.analyse` (MCP and assistant)

One read-only tool does the sequence maths on DNA the caller sends. It reads
nothing from the workspace and stores nothing, so any read credential may call
it (workspace flag `mcp_read`). `action` picks the calculation:

| action           | arguments                                                                                                | returns                                                                        |
| ---------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `sites`          | `sequence`, `topology`, `enzymes?`, `uniqueOnly?`                                                        | each enzyme's site, cut count and cut positions                                |
| `digest`         | `sequence`, `topology`, `enzymes`                                                                        | fragments with size and ends (overhang kind and bases), gel bands              |
| `annotate`       | `sequence`, `topology`                                                                                   | common features and open reading frames                                        |
| `primers`        | `sequence`, `topology`, `start`, `end`, `targetTm?`, `forwardTail?`, `reverseTail?`                      | pairs with Tm, GC, product size and warnings                                   |
| `check_primer`   | `primer`                                                                                                 | Tm, GC, GC clamp, hairpin and self-dimer ΔG, warnings                          |
| `pcr`            | `template`, `topology`, `forward`, `reverse`                                                             | the products the pair would make, tails included                               |
| `assemble`       | `method`, `parts[]`, `enzyme?` (Golden Gate)                                                             | products with parts placed, junctions and warnings                             |
| `align`          | `reference`, `query`, `mode?`                                                                            | score, identity and the aligned spans                                          |
| `crispr`         | `sequence`, `topology`, `nuclease?` (`spcas9`, `sacas9`, `cas12a`), `start?`, `end?`, `limit?`           | guides with PAM, strand, cut position, GC, score, near matches in the sequence |
| `codon_optimise` | `sequence`, `input` (`dna` or `protein`), `host` (`ecoli`, `human`, `yeast`), `avoidEnzymes?`, `maxRun?` | re-coded DNA, adaptation index before and after, GC, codons changed            |
| `check_read`     | `expected`, `topology`, `read`, `quality?`                                                               | verdict, strand, coverage and each difference with its quality                 |

A FASTA header line and any spaces or digits in a sequence are ignored. Limits:
400,000 bases per sequence, 12 parts per assembly.

## Registering a construct

A cloning product is registered as an entry of a registry model (the starter
Construct registry has a sequence field). The registry stores a fingerprint of
the sequence (the same from either strand and, for a circle, any start), so the
same sequence cannot be entered twice. These are the existing registry calls,
listed in [lab-api.md](./lab-api.md) and run through `sheetbase.lab.act`:

1. `registry_find_duplicates` with the model key, name and
   `p_custom_fields` holding the fingerprint (`seq:` plus the SHA-256 of the
   canonical sequence) under the model's sequence field.
2. `create_registry_entry`, which refuses a duplicate unless
   `p_allow_duplicate` is true.
3. `add_registry_parent` once per part, with role `vector`, `insert`,
   `backbone` or `parent`.

The in-app assistant does the same from one card (`sheetbase.registry.add`):
give it `sequence`, `topology` and `parents` and it works the fingerprint out
and links the parents when the person presses the button.

## Events

Registering a construct emits `registry.entry.created` and `record.created`;
block edits stay on the live event stream like any other block. There are no
sequence-specific event names.
