# Sequence tools plugin API

Molecular biology comes from the **Sequence tools** plugin that ships with
Sheetbase (`plugins/sequence-tools`, plugin key `sequence-tools`). It is an
ordinary plugin: it is installed for owners and administrators when they open the
app, it can be switched off in Settings → Plugins like any other, and everything
it offers goes through the plugin points described in
[plugins-api.md](./plugins-api.md).

## The sequence block

A sequence is a plugin block, so it uses the ordinary block calls on the
authenticated same-origin `/api/db` boundary and the external API:
`insert_block`, `update_block_payload`, `create_record_with_blocks`, and reading
the `blocks` table (scopes `projects:write` and `projects:read`).

```jsonc
// POST /api/db/rpc/insert_block
{
  "p_record_id": "00000000-0000-4000-8000-000000000101",
  "p_type": "plugin",
  "p_payload": {
    "plugin": "sequence-tools",
    "block": "sequence",
    "state": {
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
  },
  "p_payload_schema_version": 1,
  "p_after_block_id": null,
  "p_expected_structure_version": 3,
}
```

`residues` and `name` are expected in the state, at most 400,000 bases.
Positions are 1-based and inclusive; a feature that crosses the origin of a
circle has `start > end`. The state can also carry what was done with the
sequence: `mapEnzymes` (names), `digests`, `primers` (`name`, `seq` 5′ to 3′),
`plans` (cloning plans: parts, method `ligation`, `golden_gate` or `gibson`,
enzymes), `reads` (Sanger reads) and `products` (what was registered, below).
The plugin's screen checks the state when it saves; the database checks only
that it is JSON and no larger than a plugin block may be.

The words in a plugin block's state (titles, names, captions, feature labels,
primer names) are in the notebook search index (`search`, `sheetbase.search`);
very long values such as the residues are left out. A submitted or signed
notebook carries its plugin blocks in the frozen revision.

## Calculations: the plugin's operations

The plugin declares read-only operations that do the sequence maths on DNA the
caller sends. Like every plugin operation they are generated into the
assistant, MCP, the pipeline actions (`plugin.sequence-tools.<id>`), the API and
the Python SDK, and they read nothing from the workspace and store nothing.
Their inputs and outputs are declared in `plugins/sequence-tools/plugin.json`.

| operation         | does                                                                                   |
| ----------------- | -------------------------------------------------------------------------------------- |
| `find-sites`      | each enzyme's site, cut count and cut positions                                        |
| `digest`          | fragments with size and ends (overhang kind and bases), gel bands                      |
| `annotate`        | common features and open reading frames                                                |
| `design-primers`  | primer pairs for a region with Tm, GC, product size and warnings                       |
| `check-primer`    | Tm, GC, GC clamp, hairpin and self-dimer ΔG, warnings                                  |
| `simulate-pcr`    | the products a primer pair would make, tails included                                  |
| `assemble`        | digest-and-ligate, Golden Gate or Gibson products with parts placed and junctions      |
| `align`           | score, identity and the aligned spans                                                  |
| `find-guides`     | CRISPR guides with PAM, strand, cut position, GC, score and near matches               |
| `optimise-codons` | re-coded DNA for a host, adaptation index before and after, GC, codons changed         |
| `check-read`      | a Sanger read against what it should be: verdict, strand, coverage and each difference |
| `fingerprint`     | the registry fingerprint of a sequence                                                 |

A FASTA header line and any spaces or digits in a sequence are ignored. The
Python port of this maths is checked against the screen's TypeScript with shared
test cases (`plugins/sequence-tools/test-vectors`).

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
