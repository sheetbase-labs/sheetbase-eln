# Menu, popover and tooltip

Floating surfaces for choices and context. They sit on `surface` with a 1px `border` and `shadow-overlay`, never a coloured fill.

- `Sheetbase.Menu` holds `MenuItem` (`icon`, `hint` for a shortcut or count, `href` or `onClick`, `danger`, `disabled`), `MenuSep` and `MenuLabel`. Classes `.menu`, `.menu-item`, `.menu-sep`, `.menu-label`.
- The button that opens a menu sets `aria-expanded`. Focus moves into the menu, ↑ ↓ move, Enter chooses, Esc closes and returns focus to the button. A click outside closes it (`.dismiss` layer).
- `.popover` is a larger floating panel (notifications, filter builder). `Sheetbase.Tooltip` (`.tooltip`, inverse colours) labels icons and derived values; it never holds actions.
- Destructive items go last, after a separator, in `danger-text`.
