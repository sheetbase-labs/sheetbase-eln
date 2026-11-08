# Colony counter

A block with its own page (`ui/counter.html`), shown in a sandboxed frame with no
network, no cookies and no view of the rest of the app. It talks to Sheetbase only
through `sheetbase-ui.js`: `onContext` gives it the saved state and `setState`
keeps the count with the block.
