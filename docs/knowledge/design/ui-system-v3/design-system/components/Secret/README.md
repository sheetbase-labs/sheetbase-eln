# Secret

A value shown once, such as a new API token or a webhook signing key.

- `Sheetbase.Secret` with `value`, `onCopy` and `copyLabel`. Class `.secret`.
- Always pair it with a warn `Notice` saying it won't be shown again, and never show it again after the dialog closes; afterwards show only the name and the last four characters.
- Copy confirms with a toast ("Token copied").
