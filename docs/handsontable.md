# Handsontable integration

Sheetbase uses Handsontable only for editable scientific sheets. Registry,
queue, and read-oriented tables continue to use TanStack Table.

## Licence setup

Sheetbase currently uses Handsontable for a non-commercial demonstration.
Its documented non-commercial and evaluation licence key is explicit local
and build configuration:

```dotenv
VITE_HANDSONTABLE_LICENSE_KEY=non-commercial-and-evaluation
```

The `VITE_` prefix is intentional. Handsontable validates its licence in the
browser, so this value is public build configuration, not a server-side
secret. The value is in `.env.example` to make fresh local setup
deterministic. Restart the development server or rebuild the production
bundle after you change it.

Do not reuse this mode if Sheetbase's use becomes commercial. A commercial
deployment must buy an appropriate licence and override the environment
value. Do not commit the purchased key.

Without a key, Sheetbase renders an explicit unavailable state. It does not
initialise an unlicensed grid.

## Integration boundary

- Render grids through `SheetbaseGrid`. Do not import the vendor React
  wrapper from notebook or route components.
- `SheetbaseGrid` dynamically imports the vendor bundle after client mount.
  Its loading markup is safe to server-render in TanStack Start.
- The wrapper owns the licence, theme, outer accessible name, and
  keyboard-help description. Callers supply Handsontable settings. They
  cannot replace the licence or theme.
- Sheetbase theme variables override Handsontable's main theme for
  typography, borders, selection, read-only cells, and light/dark
  application colours.
- Handsontable has richer browser layout and clipboard behaviour than jsdom.
  Unit tests mock the dynamically loaded client boundary. Real keyboard,
  selection, copy/paste, fill, and virtualisation checks belong in browser
  tests.
