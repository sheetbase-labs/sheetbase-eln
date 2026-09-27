# Button

Buttons perform actions; links navigate. One primary button per view, labelled with the exact action ("Submit for review", "Set unit for 84 rows").

- Component: `Sheetbase.Button` with `variant` `primary` | `secondary` (default) | `quiet` | `danger` | `danger-fill`, `size` `sm` (24px, inside rows) | `lg` (44px, phone), `icon` (an `Icon` name), `iconOnly` (needs `aria-label`), `href` (renders a link styled as a button), `disabled`, `onClick`.
- Classes for plain markup: `.btn`, `.btn-p`, `.btn-q`, `.btn-s`, `.btn-l`, `.ib`.
- Disabled buttons keep their label and sit next to a reason ("2 required items before you can start").
- A button that opens a menu sets `aria-expanded`; it shows the pressed state while open.
- Group low-frequency actions behind a `…` menu instead of adding toolbar buttons.
