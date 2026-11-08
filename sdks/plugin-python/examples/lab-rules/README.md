# Lab rules

Sample plugin that runs when a record or file is saved. It declares four
`record-hooks` and one search provider:

- **Before a save** (`title-and-owner`): refuses an experiment with a short
  title, warns when the protocol note is missing, and fills in a `storage` tag.
- **After a save** (`summarise`): writes a one-line summary on the record and
  adds it to the plugin's `summaries` index.
- **After a status change** (`second-pair-of-eyes`): when an experiment goes to
  review, asks a reviewer other than the sender to sign off. The plugin never
  signs; a person presses the step.
- **Before an upload** (`scan-upload`): refuses an empty file.
- **Search** (`similar-experiments`): asks the app to rank the `summaries`
  index for the words typed (a plugin that makes vectors can pass `vector`).

Try the functions from the command line with `sheetbase-plugin try`.
