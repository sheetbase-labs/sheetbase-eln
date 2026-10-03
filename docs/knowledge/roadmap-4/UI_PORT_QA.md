# UI port QA — ELN vs `sheetbase-app (5)`

> **Reconciled 2 October 2026:** this document retains the port/QA history.
> Current task completion and remaining requirements are in
> [RECONCILIATION.md](RECONCILIATION.md) and [NEXT.md](NEXT.md). Historical
> “complete” and “no gap banners” statements describe the port scope at that
> time; they do not close the original Roadmap 4 capability or acceptance exits.
> The original parity registry currently maps no states. DSYS-06 owns the
> reference/test-contract reconciliation; the earlier port strategy statement
> does not itself establish a replacement acceptance gate.

**Status:** review complete. The visual/style drift is fixed (commits
`5fe5782d`, `a35b61eb`); the structural divergences (#208–#219) were then
worked off along with the capability build-out (see `UI_PORT.md`). Method and
findings are recorded below so every item can be re-checked.

**Resolved since (§4):** Home (#208), samples/materials Scan label + Import
(#209), protocols tabs Effective/Mine/In review/Review due/Retired (#210),
pipelines tabs All/Mine/Needs attention/Scheduled/Drafts (#211), analysis
Cited in records tab (#212), agents heading + Proposals-first tabs (#213),
audit Change and Reason columns (#214), signature meanings table (#215),
Settings General Record IDs + Editing rules (#216), sheets/new Blank sheet
card (#217), inbox kinds + Notification settings + Mark all seen (#218),
instruments filter copy "Any" (#219).

## Method

Both apps were run side by side and compared three ways:

1. **Source token diff** — every ported component/route against its reference
   counterpart, comparing the set of Tailwind utility classes and icon names
   (formatting-normalised, so prettier re-wrapping is ignored).
2. **Computed-style diff** — 30 routes loaded in both apps at 1440×900; the
   `main`, `h1`, table `th`/`td`, tab, `nav`, `header` and search input were
   measured (font-size, weight, line-height, letter-spacing, padding, margin,
   height, width, gap, radius).
3. **Element text diff** — every visible text-bearing leaf on both sides matched
   by tag+text, then font-size/line-height/padding compared.
4. **Visual side-by-side** — screenshots of 24 routes composited reference|ELN.

Apps: reference `vite dev --port 3300`; ELN `pnpm dev` on `:3000`
(`SHEETBASE_DEV_AUTH_FREE=true`).

## 1. Systemic typography (highest impact)

The reference sets a **13px body**:

```css
/* sheetbase-app (5) src/styles/app.css */
body {
  font-size: 13px;
  line-height: 18px;
}
```

The ELN sets `html { font-size: 16px }` and leaves `body` at the inherited
16px:

```css
/* src/styles.css:370-381 */
html {
  font-size: 16px;
}
body {
  @apply min-h-svh bg-background text-foreground antialiased;
  font-family: var(--font-sans);
}
```

Any ported markup that relies on the reference's inherited 13px body therefore
renders at **16px** in the ELN. The `text-body` utility is 13px, so the drift is
exactly on elements with no explicit `text-*` class.

Confirmed visible:

- **`/sheets/new`** — the card labels `From a dataset snapshot`, `From a
template`, `Paste or import a file` are **16px/24px** vs reference
  **13px/18px**.

Fix: give `body` the reference's `font-size: 13px; line-height: 18px` (or
`@apply text-body`). Rem `spacing` is 16px-based in both apps (reference `html`
is also 16px), so this changes type only, not layout scale.

## 2. Font-size / padding mismatches (per element)

Measured visible text where reference and ELN differ by ≥1px:

| Page                   | Element                                                                        | Reference                              | ELN                                 | File                                                                            |
| ---------------------- | ------------------------------------------------------------------------------ | -------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------- |
| `/settings/usage`      | card/section heading `Run minutes` (and `Seats by role`, `Storage by kind`, …) | 15px/20px (`text-section`)             | **12px/16px** (`text-label`)        | `src/routes/settings/usage.tsx` (card `label`, `<h2 className="text-label …">`) |
| `/settings/usage`      | table `td`                                                                     | padding-top **6px**, line-height 17px  | padding-top **0**, line-height 18px | `src/routes/settings/usage.tsx` breakdown table                                 |
| `/templates`           | status badge in the table (`Published`/`Draft`)                                | 13px/18px (`text-body`, no size class) | **12px/16px** (`text-label`)        | `src/routes/templates.tsx`                                                      |
| `/models`              | status badge (`Draft`)                                                         | 12px/16px (`text-label`)               | **13px/18px**                       | `src/routes/models.tsx`                                                         |
| `/settings/signatures` | `Save changes` button                                                          | 13px/18px, padding-left 10px           | **12px/16px**, padding-left 8px     | `src/routes/settings/signatures.tsx`                                            |
| `/settings/audit`      | search input                                                                   | width 240px                            | width **260px**                     | `src/routes/settings/audit.tsx`                                                 |
| `/settings/audit`      | table `td` height                                                              | 37px                                   | 33px                                | `src/routes/settings/audit.tsx`                                                 |
| `/analysis/new`        | `h1`                                                                           | 20px/26px                              | **16px/24px**                       | `src/routes/analysis/new.tsx` (structural — see §4)                             |
| `/schedule`            | `Today` chip                                                                   | 12px                                   | **10px**, padding-left +4px         | `src/routes/schedule.tsx`                                                       |

**Outcome (fixed in `5fe5782d`):** the systemic body base and the `mono`
line-height are fixed, so the `/sheets/new` labels and the `/help` rows match;
the `/settings/usage` first-cell padding, `/settings/signatures` button,
`/settings/audit` search and `/pipelines/agents` tab padding are fixed; the
`/analysis/new` heading is `text-title`.

False positives from the tag+text match (different elements that happen to
share text, mostly a table cell vs an inspector label): the `/templates` and
`/models` status badges, the `/settings/usage` `Run minutes` heading and the
`/schedule` `Today` chip all match the reference element-for-element when the
same node is measured on both sides.

## 3. Shared-component drift — `ListToolbar`

`src/components/v3/inventory/list.tsx` is a **reduced copy** of the reference's:

- The reference exports `ViewControls` (Table / Filter / Sort / Group dropdowns)
  and `FieldsButton`, and `ListToolbar` takes a `views?: ViewOptions` prop that
  renders them.
- The ELN has **no `ViewControls` and no `FieldsButton`**, and its
  `ListToolbar` has no `views` prop — so every list that uses it loses the
  `Table ▾  Filter ▾  Sort: …  Group: …` controls and the `Fields` button.

Visible on `/samples`, `/materials`, `/datasets`, `/protocols` (their reference
counterparts all show the controls). `projects-page.tsx` and a few others render
their own controls, which is why they still show Sort/Filter.

Reference: `sheetbase-app (5)/src/components/inventory/list.tsx:44-98`.
ELN: `src/components/v3/inventory/list.tsx:89-121`.

## 4. Per-page structural divergences

These are design/content differences rather than pure style. Confirm each is not
an intentional ELN-model adaptation before acting. **Filed as issues
#208–#219.**

Empty-state / capability-gap polish (fixed in `a35b61eb`): the Home
`Awaiting your review` empty state drops its lone check icon (the reference
home shows no icon there); `/analysis` centres its empty state
(`role=status`, `flex justify-center`, `items-center text-center`) to match the
reference list-empty convention the other lists already use; and the inline
capability gaps on `/experiments` and `/inbox` get `py-3` so they are not flush
against the table header.

- **`/` (Home)** — the ELN renders a simplified custom home (`Good morning`,
  `Today`, `Awaiting your review`, `Needs attention`). The reference home has a
  status chip row (`N to review · N datasets with errors · …`) with
  `Open notebook` / `New experiment` actions, an `Awaiting your review` table, a
  `Continue working` table, a `Today` timeline column and `Recent activity`.
  The ELN has none of those. (`src/routes/index.tsx` vs reference
  `_app/index.tsx` + `home/quiet-home.tsx`.)
- **`/samples`** — the list toolbar is missing the reference's `Scan label` and
  `Import` actions (reference `_app/samples/index.tsx:42-43`).
- **`/materials`** — missing `Scan label`; tab label `Expiring` vs reference
  `Expiring in 30 days`.
- **`/protocols`** — tabs `All / Active / In review / Drafts` vs reference
  `Effective / Mine / In review / Review due / Retired`; table is missing the
  `Version`, `Area` and `Effective` columns; missing the `Import document`
  action.
- **`/datasets`** — tab label `Issues` vs reference `Has issues`.
- **`/pipelines`** — tabs `All / Active / Drafts / Retired` vs reference
  `All / Mine / Needs attention / Scheduled / Drafts`
  (`src/routes/pipelines.tsx:49-55`).
- **`/analysis`** — missing the `Cited in records` tab (reference has
  `All / Mine / Cited in records / Drafts`).
- **`/pipelines/agents`** — tab order is `Workflows / Proposals / Policies` vs
  reference `Proposals / Workflows / Policies` (`src/routes/pipelines/agents.tsx`
  ~L298-308); page heading `Agent operations` vs reference `Agents`.
- **`/settings/audit`** — columns `When / Actor / Operation / Entity / Record /
Project` vs reference `Time / Actor / Action / Object / Change / Reason`; no
  date-range filter, no retention-policy line, no `Export for inspection…`
  action.
- **`/settings/signatures`** — structure differs: reference has a `Signature
meanings` table + a 3-option re-authentication radio group; the ELN has a
  `Your signature` certification block + `Workspace policy` checkboxes + a
  2-option segmented control.
- **`/settings` (General)** — the ELN shows an editable `Identifier prefixes`
  grid; the reference shows a read-only `Record IDs` table (Record / Prefix /
  Next ID / Example). The ELN is missing the reference's `Editing rules` section
  (`Ask for a reason…`, `Lock a record when it is signed`, `Allow offline
editing…`).
- **`/sheets/new`** — missing the reference's `Blank sheet` card (the ELN uses a
  Project/Name form + `Create blank sheet` instead); different header.
- **`/inbox`** — tabs `All types / Reviews / Runs / Following` vs reference
  `All types / Reviews / Data issues / Runs / Signatures / Materials`; missing
  `Notification settings` and `Mark all seen`. (Some of this is a recorded gap,
  RH-116.)
- **`/instruments`** — filter default label `All` vs reference `any`.

## 5. Verified clean

- **Shared `ui/*` kit** — no class or icon drift across `button`, `badge`,
  `input`, `table`, `status`, `tabs`, `layout`, `alert`, `dialog`,
  `dropdown-menu`, `tree`, `stepper`, `sheet`, `choice`, `avatar`,
  `empty-state`, `source`, `popover`, `radio-group`, `secret`, `checkbox`,
  `tooltip`, `kbd`, `skeleton`.
- **Icons** — the icon set and per-file icon usage match the reference; no
  misplaced/renamed icons found in the shared kit or ported components.
- **`/help`**, **`/help/records`** — layout matches; only the version/status
  strings differ (deployment data).
- **`/projects`**, **`/experiments`** — layout, toolbar and columns match
  closely; differences are data volume only.

## Re-running the comparison

- Reference app: `cd ~/Downloads/sheetbase-app\ \(5\) && pnpm exec vite dev --port 3300`
- ELN app: `pnpm dev` (auth-free, `:3000`)
- Token diff: compare class/icon sets per file (formatting-normalised).
- Computed style / text diff: Playwright, both bases, match elements by
  tag+text, report deltas ≥1px, skip `sr-only`.
