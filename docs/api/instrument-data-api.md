# Instrument data API (Allotrope)

An instrument file can be converted to the **Allotrope Simple Model (ASM)**, a
vendor-neutral JSON document, and kept with its instrument run. The usual
dataset rows are still made; the ASM document is the copy a data team, a
lakehouse or another lab can read without knowing the vendor's file format.

Conversion runs in the isolated Python pipeline runtime with
[allotropy](https://github.com/Benchling-Open-Source/allotropy), pinned in
`docker/pipeline-python/requirements.txt` (see
[pipeline-python.md](../operations/pipeline-python.md)). Choose the converter
for an instrument in its **How data gets in** setup ("Add an Allotrope
converter…"). A file sent to that instrument's intake, the folder agent or the
connector API is converted, goes through the same parser approval as any other
parser, and lands as an instrument run with its ASM document.

## Reading documents

`instrument_run_documents` is on the lab read allowlist (`lab:read`), so it is
available over the API and to MCP through `sheetbase.canonical.read`.

```bash
# The converted files of one instrument, newest first, without the document
curl -H "Authorization: Bearer $TOKEN" \
  "https://app.example/api/db/instrument_run_documents?instrument_id=eq.<id>&order=created_at.desc&select=id,run_id,technique,vendor,converter,converter_version,measurements,created_at"

# The document itself
curl -H "Authorization: Bearer $TOKEN" \
  "https://app.example/api/db/instrument_run_documents?run_id=eq.<run id>&select=document"
```

| Column                            | Meaning                                                                  |
| --------------------------------- | ------------------------------------------------------------------------ |
| `run_id`                          | The instrument run. One document per run.                                |
| `technique`, `manifest`, `vendor` | What the document describes and which instrument software it came from.  |
| `converter`, `converter_version`  | What made it (`allotropy` and its version).                              |
| `image_digest`                    | The immutable runtime image that ran the converter, for reproducibility. |
| `measurements`                    | Number of measurements in the document.                                  |
| `device`                          | The instrument that wrote the file, as the document describes it.        |
| `document`                        | The ASM document. At most 16 MiB; a larger one is refused, not cut.      |

## Sending a document in

A pipeline step or an outside system that already converted a file can keep the
document with a run using `record_instrument_run_document` (scope `lab:write`,
also a pipeline action). Sending it again for the same run replaces it.

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  https://app.example/api/db/rpc/record_instrument_run_document \
  -d '{"p_run_id":"<run id>","p_document":{...},"p_converter":"allotropy","p_converter_version":"0.1.151","p_technique":"Plate Reader","p_measurements":96}'
```

## Events

`instrument.run.converted` is sent when a document is kept. See
[event-catalogue.md](event-catalogue.md). The document is not in the payload:
read it from `instrument_run_documents`.

## Access

A document is visible to anyone who can see its instrument run; the run's own
sharing rules apply. Service credentials read the whole workspace. The
conversion needs the Python runtime; when it is not set up an intake file
fails with `converter_unavailable` (HTTP 502, retryable) and nothing is stored.

The request and response shapes are in
[openapi/external-api-v0.json](openapi/external-api-v0.json), and every lab
table and action is listed in [lab-api.md](lab-api.md).
