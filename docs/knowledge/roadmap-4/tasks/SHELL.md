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

### Exit

The five narrow boards are reproduced on their routes with the parity harness.
