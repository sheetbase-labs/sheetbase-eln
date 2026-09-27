# SHELL — Application Shell, Navigation and Interaction

**Status (2026-09-27):** Proposed; not assigned. Depends on DSYS-02/03.

## Programme goal

Replace the current application shell with the design's anatomy and
information architecture, and give the whole product one keyboard, focus and
feedback model.

## Baseline at `main` `9538f36`

- `src/components/app-shell.tsx` (1,425 lines): sidebar grouped as Workspace,
  Scientific work, Configuration, Automation, Platform and More; skip link;
  responsive drawer and inspector drawer (NAV-01).
- `ThemeProvider` with light/dark/system; theme toggle in the shell.
- `ui/command.tsx` (cmdk) is used for record pickers, not a global palette.
- No keyboard shortcut layer. Multiple workspaces exist (ADR-0004) but there is
  no switcher in the shell.

## SHELL-01 — New shell and navigation

**Status:** proposed.

### Goal

Every authenticated route renders inside the design's shell.

### Design

`canvas/Main.dc.html` (full shell), `canvas/Panels.dc.html` (navigation and
inspector states), `canvas/FocusOrder.dc.html`, `design-system/components/Navigation/README.md`,
`Inspector/README.md`, `Menu/README.md`, `Notifications/README.md`.

### Scope

- 44px top bar: brand (home), workspace switcher menu, search box opening ⌘K,
  New menu (Experiment, Working sheet, Sample, Project, Import data, Scan a
  label), notifications bell with unread dot and popover, account menu
  (identity, appearance, profile, notifications, shortcuts, sign out).
- Navigation: Home, Inbox (count), Schedule; divider; Projects, Experiments,
  Protocols, Templates, Samples, Materials, Datasets (problem count),
  Analysis, Pipelines (failure count), Models; pinned projects; Settings at the
  foot. Sections a role cannot open are omitted, not disabled.
- 232px navigation collapsing to a 48px labelled rail (⌘\\); state remembered
  per user.
- Page frame: breadcrumbs, title, status line, actions, tabs, content, 300px
  inspector slot with Properties / Comments / History tabs.
- Workspace switcher over existing workspace memberships.
- Pinned projects built on `user_favourites`.
- Delete `app-shell.tsx` once replaced.

### Start here

- `src/components/app-shell.tsx` (1,425 lines): layout, sidebar groups,
  `useShell()` per-route config (breadcrumbs, inspector, inspector label),
  inspector collapse state, skip link. 30 routes call `useShell()`
  (`grep -rln "useShell(" src/routes`).
- `src/routes/__root.tsx`: maps auth context into the shell (workspace name,
  user, role).
- `src/lib/navigation.ts` (breadcrumbs from stable IDs, NAV-02),
  `src/lib/favourites.ts` (pinned projects), `src/lib/recents.ts`.
- `src/components/project-navigation-tree.tsx`,
  `src/components/collaboration/notification-inbox.tsx` (bell today).
- Workspace resolution: `src/lib/bootstrap.ts` and `src/lib/request-auth.ts`
  pick the user's first membership; there is no "active workspace".
- Design: render `Main`, `Panels`, `FocusOrder`; the full shell markup is in
  `canvas/Main.dc.html` (top bar, nav, overlays section).

### Steps (PRs)

1. **Shell skeleton.** New `src/components/shell/` (`top-bar.tsx`,
   `main-nav.tsx`, `page-header.tsx`, `inspector.tsx`, `shell.tsx`) keeping the
   `useShell()` contract so routes do not change. Top bar with brand, search box
   (opens the palette frame from SHELL-03), New menu, bell (existing inbox
   component for now) and account menu. Swap `__root.tsx` to it and delete
   `app-shell.tsx`.
2. **Navigation.** v3 sections and order; counts from existing queries where
   they exist (datasets with issues, failed pipeline runs) and placeholders
   hidden until WORK-01 provides Inbox counts; sections a role cannot open are
   omitted using `hasCapability`/role; pinned projects from `favourites.ts`;
   48px rail with tooltips and `⌘\` (via SHELL-03 registry), state saved per
   user (SHELL-02 preferences).
3. **Page header and inspector.** `PageHeader` with breadcrumbs, title
   (`text-page-title`), status line, actions and tab slot; inspector slot with
   Properties / Comments / History tabs; migrate the 30 `useShell()` callers to
   pass title/actions to the header.
4. **Active workspace.** Add an active workspace to the session (Better Auth
   session additional field or a `user_preferences` row, see SHELL-02), make
   `request-auth.ts`, the `/api/db` proxy and PostgREST token minting
   (`src/lib/postgrest-token.ts`) use it when the user is a member, and add the
   switcher menu with "Workspace settings". DB/API test: switching changes
   which rows are visible; a non-member workspace is refused.
5. **New menu actions** wired to existing create flows (experiment, sheet,
   sample, project, import, scan) or hidden until their task lands.

### Check it

`pnpm test src/components/shell`, `tests/browser/` shell journey (tab order,
rail toggle, workspace switch), parity against `Main` chrome once DSYS-06
exists; `grep -rn app-shell src` empty.

### Exit

All routes render in the new shell; tab order matches `FocusOrder`; navigation
counts come from real queries (INBOX, DSET, PIPE); axe checks pass on the
shell in both themes.

## SHELL-02 — Appearance setting

**Status:** proposed.

### Goal

One System / Light / Dark setting per user that every open screen follows.

### Design

`design-system/components/Appearance/README.md`; account menu in
`canvas/Main.dc.html`; `canvas/SettingsProfile.dc.html`.

### Scope

Store the preference on the user (server-side, not only `localStorage`); a
segmented control in the account menu and in Profile; System follows the OS
live; remove the top-bar theme toggle.

### Start here

`src/components/theme-provider.tsx` (localStorage `sheetbase-theme`, `.dark`
class), the no-flash script in `src/routes/__root.tsx`, `internal.user`
in `src/db/schema.ts` (no preferences today).

### Steps (PRs)

1. `api.user_preferences` table (user id, appearance, nav collapsed,
   preferences JSON) with RLS "own row only", plus `set_user_preference` RPC;
   DB test for own-row isolation.
2. ThemeProvider reads the server value (SSR-safe: pass it through the root
   route context so there is no flash), writes through the RPC, keeps
   `localStorage` as an instant cache, listens to `storage` events and the
   `prefers-color-scheme` media query.
3. Segmented control in the account menu and Profile (SET-03); remove the
   top-bar toggle.

### Check it

Browser test: change appearance in one tab, the other tab follows; reload on
another browser context signed in as the same user shows the same setting.

### Exit

Changing appearance in one tab updates other open tabs and persists across
devices; there is no other theme control.

## SHELL-03 — Keyboard shortcuts and command palette frame

**Status:** proposed.

### Goal

The shortcut set in the design works everywhere it is listed.

### Design

`canvas/Shortcuts.dc.html`, `canvas/SearchPalette.dc.html`, `canvas/FocusOrder.dc.html`.

### Scope

- A single shortcut registry (no ad-hoc `keydown` listeners): ⌘K, C, G then
  H/I/E, ?, ⌘\\; lists ↑↓, J/K, Enter, Space, X, /; notebook /, Enter, Esc, Tab,
  ⌘Enter, ⌥⌘M; review N/P, R, ⌘⇧Enter. Ctrl/Alt on Windows.
- Shortcuts dialog (?) generated from the registry.
- Overlays: focus moves in, is trapped, Esc closes the top-most, focus returns
  to the opener; outside click never closes a dialog with unsaved input.
- ⌘K palette frame with grouped results and actions (content from SRCH-02).

### Start here

12 ad-hoc `keydown` listeners today (`grep -rn "keydown" src --include=*.tsx`);
`src/components/ui/command.tsx` (cmdk) and `kbd.tsx`; design lists in
`canvas/Shortcuts.dc.html`.

### Steps (PRs)

1. `src/lib/shortcuts.ts`: a registry (`id`, keys per platform, scope
   `global | list | notebook | review`, description, handler), a provider that
   installs one listener, ignores events from inputs/contenteditable unless the
   shortcut allows it, and supports sequences (`G` then `H`).
2. Register the global shortcuts; `?` opens a dialog generated from the
   registry; replace the 12 ad-hoc listeners with registrations.
3. List, notebook and review scopes registered by their screens as those
   screens are migrated (the owning tasks reference this registry).
4. ⌘K palette frame (dialog, input, grouped result slots, footer hints);
   results come from SRCH-02.

### Check it

Unit tests for sequence matching and input suppression; browser test for ⌘K,
`?`, `G H`, and Esc focus return.

### Exit

Every shortcut in `Shortcuts.dc.html` is registered, listed in the dialog and
covered by a browser test; shortcuts are suppressed inside text inputs except
where the design says otherwise.

## SHELL-04 — Decide the fate of surfaces outside the design

**Status:** proposed; this is [DEC-03](DEC.md).

### Goal

No route is left without an owner in the new information architecture.

### Scope

Decide keep, fold into another route, or retire for each of:
`/agent-operations`, `/plate-designer`, `/planner`, `/instrument-monitor`,
`/storage`, `/report-builder`, `/lineage`, `/docs/$name`, `/foundations`.
Because the product must look exactly like v3, **keep** means the surface is
first designed in v3 (new screens added to the design, re-vendored and
rendered like the rest) and then built to parity; there is no restyled
exception. Record each decision in this file. Retiring a route removes its code
and tests in the same change; folding updates NAV canonical URLs.

### Steps

1. For each route, find its roadmap origin (`grep -rn "<route>" docs/knowledge`)
   and current users; write one line per route in a table in this task.
2. Product owner decides; record the decision and date in the table.
3. For each "keep": add v3 screens to the design, re-vendor, render, then add
   a screen-migration task to the relevant stream.
4. For each "retire": one PR removing the route, its components, stories,
   tests, navigation entries and any SQL that only it used (with a migration if
   tables go). For each "fold": move the capability into the target route's task.

### Exit

Each listed route has a recorded decision; every kept route has v3 design
screens in the snapshot and parity tests; the shell's navigation contains only
surfaces that exist in the design.

## SHELL-05 — Narrow screens

**Status:** proposed.

### Goal

Laptop and tablet widths follow the design.

### Design

`canvas/NotebookLaptop.dc.html` (1024px), `canvas/NotebookTablet.dc.html`,
`canvas/ProjectsTablet.dc.html`, `canvas/SheetTablet.dc.html`,
`canvas/SnapshotsLaptop.dc.html`.

### Scope

At 1024px the navigation is a rail and the inspector overlays; on tablet the
inspector is a drawer and touch targets are at least 44px. Phone layouts are
MOB.

### Start here

Current responsive behaviour in the shell (drawer below the NAV-01
breakpoint); design boards `NotebookLaptop` and `SnapshotsLaptop` (1024×760),
`NotebookTablet`, `ProjectsTablet` and `SheetTablet` (834×1112).

### Steps (PRs)

1. Breakpoints from the design sizes; rail at 1024px; inspector as overlay at
   laptop width and drawer on tablet; 44px targets on tablet.
2. Add the five boards to `design-states.ts` with their routes once those
   routes are migrated.

### Check it

Parity for the five boards.

### Exit

The five narrow boards are reproduced on their routes with the parity harness.
