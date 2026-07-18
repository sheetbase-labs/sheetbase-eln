# 0009. Stable application shell for authenticated routes

- **Status:** accepted
- **Date:** 2026-07-18
- **Ticket:** UI-003

## Context

The Sheetbase ELN mockups (Project Dashboard, Experiment Notebook, My Work)
all share a stable three-region chrome: a left workspace/project
navigation plane (~240px), a compact top bar (breadcrumbs · search · primary
action · account), a centred work area, and an optional right contextual
inspector (~320px). `Concepts/sheetbase-ui-system-v2` ships a
`DesignSystemShell` that demonstrates the layout but is scoped to the
concept-system review site, not the product.

Forces:

- The shell must wrap authenticated product routes without forcing public
  routes (`/sign-in`, `/foundations`) into the application chrome.
- The sidebar must collapse without losing the active workspace/project
  context. The inspector must convert to a modal sheet on narrow screens.
- Browser navigation, deep links and route-level loading must be preserved.
  The shell is layout only; route loaders and guards stay where they are.
- The shell should stay reusable so a project dashboard, a notebook and a
  "My work" page can all pass their own breadcrumbs, nav sections, project
  tree and inspector content without re-implementing chrome.

## Decision

1. **One `AppShell` component in `src/components/app-shell.tsx`.** It is
   the stable chrome for every authenticated route. Public routes do not
   use it; `/sign-in` and `/foundations` keep their own top-level layout.

2. **Data-driven, composable props.** `AppShell` takes `breadcrumbs`,
   `navSections`, `projectTree`, `navExtra`, `primaryAction`, `inspector`
   and `inspectorLabel` plus the signed-in `context` (workspace + user).
   Routes plug in their own real data; the shell owns layout, collapse,
   breakpoints, landmarks, the command palette and sign-out.

3. **Layout regions and breakpoints.**
   - Sidebar: fixed `w-60` on desktop (`md:`), collapses to a `w-14` icon
     rail with tooltips. Below `md` it is a left `Sheet` opened from the
     top-bar menu button.
   - Inspector: `w-80` right `<aside>` on `xl:`. Below `xl` it is a right
     `Sheet` opened from a top-bar button that only appears when an
     inspector slot is provided.
   - Centre: `min-w-0 flex-1`, content capped at `max-w-[1280px]` so it
     grows while the sidebar and inspector widths stay stable.

4. **Collapse preserves context.** The collapse state persists in
   `localStorage` (`sheetbase-sidebar-collapsed`). Collapsing hides labels
   and the project tree but keeps nav icons, the workspace glyph and the
   profile avatar, and breadcrumbs always carry the active
   workspace/project/record context in the top bar.

5. **Command palette (⌘K).** A `Dialog` + `Command` palette lists enabled
   nav items and quick actions (toggle colour mode, toggle density, sign
   out). Disabled nav items are excluded. The global ⌘K / Ctrl-K listener
   opens it.

6. **Landmarks and skip nav.** `<header role=banner>`, `<nav
   aria-label=Primary>`, `<nav aria-label=Breadcrumb>`, `<aside
   aria-label=Application navigation>`, `<main id=app-shell-main
   tabIndex=-1>` and an optional `<aside aria-label=Inspector>`. A
   skip-link targets `#app-shell-main`. The last breadcrumb carries
   `aria-current="page"`; the active nav item carries `aria-current="page"`.

7. **Disabled nav items are honest.** Routes that do not exist yet (My
   work, Activity, Tasks, Reviews) render as `aria-disabled` placeholders
   with a "coming soon" tooltip rather than dead links, and are excluded
   from the command palette. They are enabled as their routes land in
   later phases.

8. **Sign-out and preferences.** The account dropdown calls
   `authClient.signOut()` then `router.invalidate()`. Theme and density
   toggles reuse the UI-001 `useTheme` provider.

## Consequences

- `src/routes/index.tsx` and `src/routes/projects.tsx` render inside
  `AppShell`; their existing route guards and loaders are untouched.
- Public routes are unchanged and verified to render without the chrome.
- Visual review of the shell happens on authenticated routes; there is no
  public shell preview (UI-008 will own the dev-only catalogue gate).
- The shell is the single place future product routes extend; adding a
  notebook or "My work" page means passing new breadcrumbs/nav/inspector
  props, not new chrome.
