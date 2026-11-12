# The Pipelines board components

Pipeline screens draw the shapes of the Pipelines design board, not look-alikes. The board's own CSS and markup are saved in `/mnt/project-files/pipelines-system/board-html/` (guide: `board-components.md` beside it).

`src/features/pipelines/board/` holds them for the app:

- `board.css` is the board's `.pb-*` rules plus `.btn`, `.input`, `.select`, `.status`, `.seg`, `.code`, `.kind`, `.dl`, `.tmp`, `.check`, copied from the board and scoped under `.pb-scope`. The board's `--text*` tokens map to the app's `--foreground` family, and its accent to `--primary`.
- `board.tsx` has `BoardScope` (wraps a page), `BoardList`, `BoardHead`, `BoardBlock`, `BoardRow`, `BoardAdd`, `BoardIo`, `BoardCode`, `BoardSegmented`, `BoardButton`, `BoardInput`, `BoardSelect` and `BoardStatus`.

Put a pipeline page body inside `BoardScope`. A rule that only one page needs goes in that page's own file. Change a value in `board.css` only when the board changes.
