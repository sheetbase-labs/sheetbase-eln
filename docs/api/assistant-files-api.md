# Files in the assistant chat

A person can drop a plate reader export, a gel or blot photo or a vendor PDF
into the assistant chat. The assistant reads it and turns it into a plate run,
samples or a reagent lot through confirm cards, the same cards it offers when a
person types the values. See [lab-api.md](lab-api.md) for scopes and tokens.

A file in the chat is chat input, not a record. It is read once, kept by the
browser with the conversation and never stored on the server, so there is no
table, no event and no webhook for it. Anything the assistant writes from a file
is an ordinary action with its own change events (`plate_run.created`,
`sample.logged`, ...).

## What is read

| File                                             | What the assistant gets                                             |
| ------------------------------------------------ | ------------------------------------------------------------------- |
| CSV, TSV, tab-separated text, XLSX               | Every sheet as rows of cells (up to 3,000 rows and 80 columns each) |
| PDF, Word (.docx, .doc), slides, ODT, plain text | The text (up to 120,000 characters)                                 |
| PNG, JPEG, WebP                                  | The picture, shrunk to 1568 px, for a vision model to look at       |

A PDF with no text layer (a scan) is reported as such; attach a photo of the
page instead. Files over 25 MB are refused. Up to four files per chat.

The assistant sees a short preview of each file and reads the rest with
`sheetbase.attachment.read` (rows of a sheet, or characters of a document). A
file's contents are treated as data, never as instructions.

## Endpoint

`POST /api/assistant/attachments` takes a multipart form with `workspaceId` and
`file` and the signed-in session, and answers `{ "attachment": { ... } }`: the
reading. The chat endpoint `POST /api/assistant/chat` accepts these readings in
an `attachments` array beside `messages`. This is the in-app chat's own
contract (session cookie, not a token). Scripts and agents that hold a file
already read it themselves and call the lab actions directly.

## Assistant tools

| Tool                        | Kind | Does                                                                                                                                                                               |
| --------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sheetbase.attachment.read` | read | Reads more of an attached file by sheet and row, or by character position.                                                                                                         |
| `sheetbase.plate.from_file` | card | Makes a plate run from a plate reader export (a grid or a list with a well column), optionally analysing it against named controls. The card is built from the file's own numbers. |

Samples are logged with `sheetbase.sample.log`, reagent lots received with
`sheetbase.reagent.receive`, and so on: the assistant reads the values from the
file and proposes those existing cards.

## Same thing on the other surfaces

- **API, MCP, Python SDK**: the plate run is `create_plate_run` (see
  [lab-api.md](lab-api.md)), available through `sheetbase.lab.act` and the SDK.
  Reading a file is the caller's own job.
- **Webhooks**: no new state, so no new event. The plate run emits the existing
  plate events when the card is applied.
- **Pipelines**: use the existing plate run action.
