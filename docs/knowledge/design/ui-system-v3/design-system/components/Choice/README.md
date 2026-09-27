# Choice

A radio (or checkbox) option with a title and one line on its consequence. Use it when the options change what happens to records: where promoted columns go, whether a notebook takes a new template version, where a moved item lands.

- `Sheetbase.Choice` with `title`, `name`, `checked`, `disabled`, and the consequence as children. Class `.choice` (`.on`, `.off`).
- Stack choices vertically, 6px apart, at most four. The safe or reversible option comes first and is checked by default.
- For plain settings with no consequence to explain, use `.check` instead.
