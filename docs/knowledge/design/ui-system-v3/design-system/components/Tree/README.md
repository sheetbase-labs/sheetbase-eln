# Tree

Folders inside a project. Folders only organise: moving an item keeps its ID, links, history and access.

- `Sheetbase.Tree` wraps `Sheetbase.TreeItem`s. Each item takes `depth` (0 or 1; two levels at most), `current`, `count`, `icon` (default `folder`) and `href` or `onClick`. Classes `.tree`, `.tree-item`.
- The current folder gets `aria-current="page"` and the selection background, like the main navigation.
- Keep the tree 240px wide on the left of the project area. Long names truncate; the full name is the item's title.
