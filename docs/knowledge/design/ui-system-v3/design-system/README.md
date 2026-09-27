# Sheetbase

The design system for Sheetbase ELN, a scientific working environment for a cell and gene therapy CDMO. It should feel precise, calm, dense and trustworthy: closer to an instrument or an IDE than a SaaS dashboard. Built from the Sheetbase product design guide (v1.1, 1 Sep 2026).

## Principles

- **Work first.** The scientific record (notebook, sheet, dataset, chart) is the strongest object on the page. Navigation, inspectors and toolbars support it and never compete.
- **Calm density.** Remove space before reducing legibility. Rows are 32px, sheet rows 28px, body text 13px. Never shrink text to fit.
- **Stable edges.** Left is location (`nav-width` 232px), centre is work, right is properties and provenance (`inspector-width` 300px).
- **Evidence gets width.** Prose stays within 680px; sheets, tables and charts break wider.
- **Border before shadow.** Use alignment, then a background plane, then a 1px `border`. `shadow-overlay` and `shadow-dialog` are for floating surfaces only.
- **Colour has a job.** Every non-neutral colour means action, selection, status, validation, category or data. If removing it loses no meaning, remove it.
- **Scientifically exact.** Units in headers, scientific notation preserved, tabular numerals, provenance one click away, derived values marked `ƒx`.

## Colour

Mostly cool neutrals with one decisive blue.

| Role | Token | Light | Dark |
| --- | --- | --- | --- |
| Page | `bg` | #FDFDFF | #0E1116 |
| Panels | `surface` | #FFFFFF | #151A21 |
| Border | `border` | #DEE1E7 | #2A313B |
| Text | `text` | #0F141C | #E6E9EE |
| Secondary text | `text-muted` | #5D646F | #9AA3AF |
| Interaction | `accent` | #006EDC | #4C9BFF |
| Primary button | `accent-strong` | #006EDC | #1F6FD6 |
| Selection | `selection` | #E7EFFB | #1C2B40 |

Status marks use `success`, `warning`, `danger`, `review` (violet) and `analysis` (cyan). Colour sits in the dot or icon; the text beside it stays `text`. Error text uses `danger-text`, warning text `warning-text`, never the mark colours.

Chart series use `series-a`, `series-b`, `series-c`. They differ in lightness as well as hue and pair with distinct marker shapes (circle, square, triangle), so they survive greyscale and colour-blind viewing. Excluded or flagged points are hollow.

### Dark mode

Dark mode keeps the hierarchy rather than inverting. Surfaces are quiet near-black blues (`bg` #0E1116, `surface` #151A21); borders stay visible at `border` #2A313B; the blue lightens to #4C9BFF for links and focus, and darkens to #1F6FD6 behind white button text. Status and series colours lift in luminance but keep their identity. No glow, glass or saturated panels.

Switch themes by setting `data-theme="dark"` on any ancestor. Everything below it reads the dark values.

People choose System, Light or Dark once, in the account menu or Profile, and every open screen follows. `Sheetbase.theme` holds that choice (see the Appearance card): screens call `Sheetbase.theme.resolved()` and put the result on their root as `data-theme`. Never ship a separate dark copy of a screen.

## Type

- **Instrument Sans** (`font-heading`) for headings only: `page-title` 20px, `section` 15px, `doc-heading` 16px, weight 600. Never larger on routine pages; never 700–900.
- **Inter** (`font-sans`) for interface text, tables and data: `body` 13px, `prose` 14/22, `label` and `caption` 12px.
- **JetBrains Mono** (`font-mono`) for record IDs and machine values only.
- Sentence case everywhere. Left-aligned headings. Tabular numerals (`.num`) wherever numbers align.

All three are Google Fonts; load `https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@500;600&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap`.

## Spacing, size and shape

Spacing steps `space-1` 4 to `space-6` 32. Controls are 28px (`control-height`), small controls 24px. Radii: `radius-sm` 4 for tags, `radius-md` 6 for buttons, inputs, tables and notices, `radius-lg` 10 for dialogs only. No large rounded cards.

## Iconography

16px stroke icons at 1.4px (`Sheetbase.Icon`, names in the Icon card), drawn in `text-muted` (current colour). Icons label navigation and actions; they are never decorative. Icon-only buttons carry an `aria-label`. No emoji.

## Writing

Name the exact object and consequence ("Set unit for 84 rows", "Return with 1 comment"). Errors say what went wrong and how to fix it. Units are explicit and never hidden in placeholders. Use `—` for genuinely absent values.

## Using the system

Two files, both under `components/`:

- `bundle.css` defines every token as a CSS variable, in light and dark, plus the classes for layout and plain markup: `.shell`, `.topbar`, `.nav` and `.nav-rail`, `.pagehead`, `.tabs`, `.toolbar`, `.t` (record table), `.g` (sheet grid), `.dl`, `.doc` (notebook prose, with `.blk` and `.chg-mark` for review changes), `.field`, `.input`, `.select`, `.check`, `.dialog`, `.popover`, `.cal` (bookings), `.phone-bar` and `.phone-tabs`, and the `.ch-*` chart classes. Wrap a screen in `.sb-root`.
- `bundle.js` is one classic script that sets `window.Sheetbase`: the React components `Button`, `Status`, `Dot`, `Chip`, `Tag`, `Kbd`, `Avatar`, `Icon`, `Banner`, `Notice`, `EmptyState`, `Skeleton`, `Stepper`, `Toast`, `Tooltip`, `Menu`, `MenuItem`, `MenuSep`, `MenuLabel`, `Segmented`, `Source`, `Diff`, `Choice`, `Tree`, `TreeItem` and `Secret`, plus `Sheetbase.theme`. It reads `window.React` when it renders, so load it after or before React 18.

Use a component wherever one exists; plain markup with the classes is for layout. In a design canvas, mount them with `<x-import component-from-global-scope="Sheetbase.Button" variant="primary">Save</x-import>`.

## Pipelines

Pipelines automate analysis and ELN work. Their screens always show what is temporary (`.tmp`), which input snapshots a run used, what a run keeps (nothing unless chosen) and which actions need a person. Automation proposes; people accept, sign and approve. See the Pipeline card for the step list and code styles.

## Records, snapshots and evidence

- Every record has an ID that never changes. Link to the ID, never to a name or a folder; renaming or moving breaks nothing.
- Datasets change only by adding a snapshot. Anything that used data (a signed record, an analysis, a pipeline run) names the snapshot, e.g. "DS-0311 · S-15".
- Signed evidence never changes. When live data has moved on, show both side by side with `Diff`, and offer an amendment rather than an edit.
- Sheets are for working. Each column header carries a `Source`. Local columns can't be cited or read by pipelines until they are promoted, which goes through a reviewed model change.
- Templates have versions. A new version never changes existing work; the owner chooses, with a `Choice`, whether to take it.

## Interaction

- Every screen has a skip link, then the top bar, navigation, page header, tabs, content and inspector in that tab order.
- Menus and popovers take focus, trap it, close on Esc or an outside click and return focus to their button. Buttons that open them set `aria-expanded`.
- Feedback for an action you just took is a toast (bottom centre, 6 s, Undo when reversible). Problems with the page are banners; problems with a value sit next to the value.
- Touch targets on phone screens are at least 44px (`size="lg"`, `.btn-l`, `.row-l`).

## Named failures to avoid

SaaS card quilt, hero creep, pill soup, inspector dashboard, toolbar creep, colour confetti, fake spreadsheet, document tiles, compliance chrome, tiny science. See the product design guide for each.
