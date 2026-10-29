# Dev toolbar

A thin bar docked to the bottom of the page for tuning the interface live, after the internal
toolbar Linear describes in
[Behind the latest design refresh](https://linear.app/now/behind-the-latest-design-refresh).
Everything it does is local to the browser and nothing is saved to the server.

## Who sees it

- Development builds (`pnpm dev`): everyone, as a bar along the bottom of the page.
  Automated browsers (Playwright) and the parity build
  (`VITE_PARITY`) don't see it unless it was switched on.
- Production builds: only workspace owners and admins, and only after they press
  **Ctrl + Alt + D**. Ctrl + Alt + D shows or hides it everywhere, and the choice
  is remembered in `localStorage` (`sb-devtools`).

## What it does

- **Appearance**: System, Light or Dark, through the shared theme store.
- **Density**: compact, default or comfortable (`--row-height`, `--control-height`).
- **Colour**: opens a popover above the bar with hue, chroma and lightness of
  `primary`, `background`, `foreground`, `border`, `destructive` and `success`,
  for the theme you are in. "Copy tuned colours" puts the values on the
  clipboard as JSON.
- **Helpers**: outline every element, turn off animations.
- **Show my changes**: untick to suspend every change, to see whether a problem
  comes from your tweak or was already there. "Reset everything" clears them.
  "Hide" removes the bar; Ctrl + Alt + D brings it back.

The bar sits over the bottom 36px of the page.

Settings live in `localStorage` (`sb-dev-settings`) and are written into one
`<style id="sb-dev-toolbar-style">` element. The code is in
`src/components/dev-toolbar/`; `dev-settings.ts` is pure and unit tested.

## Not built yet

- Feature flags: no capability flag is registered today
  (`src/lib/capabilities.ts`), so there is nothing to toggle. Add a section when
  the first one lands.
- A locale switch for the stretched test language: `VITE_SHEETBASE_LOCALE=pseudo`
  is chosen at build time in the copy catalogue (PR #295), so it can't be flipped
  at runtime yet.
