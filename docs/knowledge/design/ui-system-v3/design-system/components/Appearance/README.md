# Appearance switch

One setting, System, Light or Dark, that every open Sheetbase screen follows. It lives in two places, both bound to the same stored value: the account menu (the quick way) and Profile settings (where people look for it). There is no separate top-bar toggle: it could only flip light and dark, can’t express System, and adds chrome to every screen.

- `Sheetbase.Segmented` renders the switch (`options`, `icons`, `value`, `onChange`). Class `.seg`.
- `Sheetbase.theme` is the shared setting: `get()`, `set('system' | 'light' | 'dark')`, `resolved(override)` returns `light` or `dark`, and `subscribe(fn)` re-renders when it changes. It is stored in the browser when allowed and broadcast to every other frame on the page, so all screens switch together.
- Put the resolved value on the screen root as `data-theme`. Every token in `bundle.css` has a light and a dark value, so nothing else changes.
- System follows the computer’s setting and updates live when it changes.
