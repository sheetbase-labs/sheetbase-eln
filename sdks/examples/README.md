# Sheetbase SDK examples

Representative scientific workflows using the public-contract SDKs only.
Examples never call internal routes and never reproduce server-side business
rules: validation, permissions, calculation semantics and versioning stay
authoritative in Sheetbase.

## Python

| Example | Workflow |
| --- | --- |
| [`python/analysis_roundtrip.py`](python/analysis_roundtrip.py) | Download a dataset into pandas, analyse it, upload derived results as new rows, then snapshot an immutable Dataset Version as evidence. |
| [`python/frozen_evidence.py`](python/frozen_evidence.py) | List Dataset Versions, download the frozen version as a DataFrame, and compare it against live rows without mutating anything. |

## TypeScript

| Example | Workflow |
| --- | --- |
| [`typescript/bulk-transfer.ts`](typescript/bulk-transfer.ts) | Bulk-upload records with batched, revision-chained commits; download them back expanded; read record revision history for provenance. |

Run the Python examples against a reachable Sheetbase deployment:

```bash
python sdks/examples/python/analysis_roundtrip.py
```

The TypeScript example is read with `--experimental-strip-types` on Node 22+
or compiled with the SDK's `tsconfig.json` first.
