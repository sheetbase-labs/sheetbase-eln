---
name: Sheetbase ELN
description: A precise, flexible electronic laboratory notebook for scientific work.
colors:
  laboratory-blue: '#006EDC'
  signal-blue: '#3986E4'
  active-blue-wash: '#E7EFFB'
  canvas-white: '#FDFDFF'
  surface-white: '#FFFFFF'
  sidebar-mist: '#F7F9FC'
  control-mist: '#F1F4F8'
  border-slate: '#DEE1E7'
  input-slate: '#D6DBE3'
  scientific-ink: '#0F141C'
  secondary-ink: '#5D646F'
  success-green: '#00A659'
  warning-amber: '#E8A200'
  destructive-red: '#EA3130'
  analysis-violet: '#9B61EA'
  analysis-cyan: '#00A3BB'
  dark-canvas: '#080B10'
  dark-surface: '#0E1218'
  dark-border: '#272C32'
  dark-foreground: '#EFF2F6'
typography:
  display:
    fontFamily: 'Instrument Sans Variable, Inter Variable, ui-sans-serif, system-ui, sans-serif'
    fontSize: '2rem'
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: '-0.025em'
  headline:
    fontFamily: 'Instrument Sans Variable, Inter Variable, ui-sans-serif, system-ui, sans-serif'
    fontSize: '1.5rem'
    fontWeight: 650
    lineHeight: 1.3
    letterSpacing: '-0.018em'
  title:
    fontFamily: 'Instrument Sans Variable, Inter Variable, ui-sans-serif, system-ui, sans-serif'
    fontSize: '0.875rem'
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: '-0.006em'
  body:
    fontFamily: 'Inter Variable, ui-sans-serif, system-ui, sans-serif'
    fontSize: '0.875rem'
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 'normal'
  label:
    fontFamily: 'Inter Variable, ui-sans-serif, system-ui, sans-serif'
    fontSize: '0.75rem'
    fontWeight: 550
    lineHeight: 1.35
    letterSpacing: '0.01em'
  data:
    fontFamily: 'Inter Variable, ui-sans-serif, system-ui, sans-serif'
    fontSize: '0.8125rem'
    fontWeight: 400
    lineHeight: 1.35
    letterSpacing: 'normal'
rounded:
  xs: '4px'
  sm: '5px'
  md: '7px'
  lg: '8px'
  xl: '12px'
  full: '9999px'
spacing:
  1: '4px'
  2: '8px'
  3: '12px'
  4: '16px'
  5: '20px'
  6: '24px'
  8: '32px'
  10: '40px'
  12: '48px'
  16: '64px'
components:
  button-primary:
    backgroundColor: '{colors.laboratory-blue}'
    textColor: '{colors.surface-white}'
    typography: '{typography.label}'
    rounded: '{rounded.md}'
    padding: '8px 14px'
    height: '36px'
  button-secondary:
    backgroundColor: '{colors.control-mist}'
    textColor: '{colors.scientific-ink}'
    typography: '{typography.label}'
    rounded: '{rounded.md}'
    padding: '8px 14px'
    height: '36px'
  button-outline:
    backgroundColor: '{colors.canvas-white}'
    textColor: '{colors.scientific-ink}'
    typography: '{typography.label}'
    rounded: '{rounded.md}'
    padding: '8px 14px'
    height: '36px'
  input-default:
    backgroundColor: '{colors.canvas-white}'
    textColor: '{colors.scientific-ink}'
    typography: '{typography.body}'
    rounded: '{rounded.md}'
    padding: '8px 12px'
    height: '36px'
  card-default:
    backgroundColor: '{colors.surface-white}'
    textColor: '{colors.scientific-ink}'
    rounded: '{rounded.lg}'
    padding: '20px'
  notebook-block:
    backgroundColor: '{colors.surface-white}'
    textColor: '{colors.scientific-ink}'
    rounded: '{rounded.lg}'
    padding: '16px'
  status-in-progress:
    backgroundColor: '#ECFDF5'
    textColor: '#047857'
    typography: '{typography.label}'
    rounded: '{rounded.full}'
    padding: '2px 8px'
  status-review:
    backgroundColor: '#F5F3FF'
    textColor: '#6D28D9'
    typography: '{typography.label}'
    rounded: '{rounded.full}'
    padding: '2px 8px'
  sidebar-active:
    backgroundColor: '{colors.active-blue-wash}'
    textColor: '#0B2648'
    typography: '{typography.body}'
    rounded: '{rounded.md}'
    padding: '8px 10px'
---

# Design System: Sheetbase ELN

## 1. Overview

**Creative North Star: "The Precision Notebook"**

Sheetbase combines the ordered clarity of a scientific instrument with the flexibility of a working laboratory notebook. The interface is quiet, bright and exact. It allows dense scientific information to remain visible without turning every page into an administrative dashboard.

The visual hierarchy starts with the work itself. Notebook content, data tables and plots occupy the primary plane. Navigation and properties remain stable at the edges. Controls are compact and predictable. Surfaces are nearly flat, separated by fine structure rather than decorative depth.

The system is Attio-inspired in discipline, not imitation. It adopts calm density, strong relational context and contextual inspectors while retaining a distinct scientific character. It explicitly rejects generic AI-tool aesthetics, oversized product headlines, sparse card grids, glassmorphism, decorative gradients and faux-scientific imagery.

**Key Characteristics:**

- Bright neutral canvas with a single decisive blue action colour.
- Compact application chrome and stable three-pane layouts.
- Document-first composition rather than dashboard-first composition.
- Instrument Sans headings; Inter for body, controls and scientific data.
- Fine borders, low elevation and restrained radii.
- Semantic colour for status and data, never decorative colour flooding.
- Full-featured tables and charts that visually belong to the same system.
- Comfortable and compact density modes built from the same tokens.
- Light and dark themes with equivalent hierarchy, not simple inversion.

**The Work-First Rule.** The scientific record is always the strongest visual object on the page. Sidebars, inspectors, toolbars and metadata must support it without competing with it.

**The Calm Density Rule.** Reduce space before reducing legibility. Dense screens rely on alignment, typographic contrast and progressive disclosure, never on tiny text or collapsed touch targets.

**The Stable Edges Rule.** Project navigation belongs on the left, contextual properties belong on the right, and the active work stays in the centre. Do not move global actions between these planes without a workflow reason.

**Layout guidance:**

- Desktop product screens use a stable application shell with a left project tree, central working canvas and optional right inspector.
- The central notebook column should normally read as a continuous document. Avoid masonry or dashboard grids for notebook content.
- Use a maximum readable width for prose-heavy notebook sections while allowing tables and charts to expand when needed.
- Right inspectors are narrower, denser and separated by a single border. On narrow screens they become modal sheets.
- Page titles remain compact. Product pages do not use marketing-scale typography.
- Use the 4px base grid. Most component gaps are 8px, 12px or 16px; major section rhythm is 24px or 32px.

**Motion guidance:**

- Motion communicates state, insertion, reordering, expansion or spatial continuity.
- Standard transitions are 120–180ms. Sheets and dialogs may use up to 240ms.
- Do not animate charts, counters or decorative surfaces merely to make a screen feel active.
- Always respect reduced-motion preferences.

## 2. Colors

The palette is a cool scientific neutral system with one clear laboratory blue, supported by restrained semantic and analytical colours.

The YAML frontmatter uses sRGB equivalents for strict DESIGN.md tooling compatibility. The implementation may retain the corresponding OKLCH values as its canonical CSS tokens, provided the perceptual result and token roles remain unchanged.

### Primary

- **Laboratory Blue** (`#006EDC`): primary actions, selected control emphasis and high-confidence interactive links. Use it sparingly enough that the next action remains obvious.
- **Signal Blue** (`#3986E4`): focus rings, active chart interaction and lighter blue emphasis. It must not compete with the primary action.
- **Active Blue Wash** (`#E7EFFB`): selected navigation rows, active filters and quiet informational emphasis. Always pair it with dark blue or scientific ink text.

### Secondary

- **Success Green** (`#00A659`): successful checks, in-progress or approved states where green is semantically correct, and one chart series. Status treatments use pale backgrounds and dark text rather than solid green fills.
- **Analysis Violet** (`#9B61EA`): secondary analysis series and review-state categorisation. Violet is not a brand accent and must never become a gradient or page-level theme.
- **Warning Amber** (`#E8A200`): expiry, review attention, conflict and caution states. Reserve for conditions requiring awareness rather than destructive failure.
- **Analysis Cyan** (`#00A3BB`): tertiary analytical series, instrument telemetry and secondary technical data.
- **Destructive Red** (`#EA3130`): failed states, destructive actions and blocking validation. Never use red to make a neutral action more noticeable.

### Neutral

- **Canvas White** (`#FDFDFF`): primary light-mode application background. It is subtly cool rather than pure white.
- **Surface White** (`#FFFFFF`): cards, notebook blocks, dialogs and floating surfaces.
- **Sidebar Mist** (`#F7F9FC`): persistent navigation and low-emphasis structural planes.
- **Control Mist** (`#F1F4F8`): secondary controls, muted surfaces and table header treatments.
- **Border Slate** (`#DEE1E7`): default dividers and component boundaries.
- **Input Slate** (`#D6DBE3`): stronger form-control boundary where a field must read as editable.
- **Scientific Ink** (`#0F141C`): primary text and icons.
- **Secondary Ink** (`#5D646F`): metadata, descriptions and low-emphasis labels. Do not use it where contrast becomes marginal.

### Dark mode

- **Dark Canvas** (`#080B10`): application background.
- **Dark Surface** (`#0E1218`): primary raised plane.
- **Dark Border** (`#272C32`): dividers and boundaries.
- **Dark Foreground** (`#EFF2F6`): primary text.
- Primary blue becomes lighter in dark mode so its perceived emphasis remains equivalent.
- Dark mode is quiet and neutral. Do not add glow, translucent glass or saturated colour fields.

### Data visualisation

The default ordered categorical sequence is blue, green, violet, amber and cyan. Adjacent series must remain distinguishable by marker, line style or pattern when colour alone is insufficient.

- Do not use red and green as the only distinction.
- Sequential scales use a single-hue lightness ramp.
- Diverging scales require an explicit meaningful midpoint.
- Plate maps and heatmaps always include a scale, missing-value treatment and accessible tabular alternative.
- Gridlines are lighter than axes and never dominate the data.

**The Colour Has a Job Rule.** Every non-neutral colour must communicate action, status, category or data. If removing the colour loses no meaning, remove it.

## 3. Typography

Instrument Sans provides the product's distinctive but restrained heading voice. Inter is the high-legibility working face for controls, tables, metadata and body copy. Monospace is reserved for code, identifiers when alignment matters, formula fragments and machine-readable values.

### Roles

- **Display:** 32px / 38px, Instrument Sans, 650. Reserved for rare high-level catalogue or onboarding headings, never routine application pages.
- **Headline:** 24px / 31px, Instrument Sans, 650. Main page and major record titles.
- **Section heading:** 18px / 25px, Instrument Sans, 600. Significant notebook or documentation sections.
- **Component title:** 14px / 20px, Instrument Sans, 600. Cards, blocks, chart frames and inspector groups.
- **Body:** 14px / 21px, Inter, 400. Default product copy.
- **Small body:** 12px / 17px, Inter, 400. Secondary metadata and supporting explanation.
- **Label:** 12px / 16px, Inter, 550. Controls, table headers and property names.
- **Data:** 13px / 18px, Inter, 400 with tabular numerals where values align in columns.
- **Micro label:** 10px / 14px, Inter, 600, uppercase with restrained tracking. Use only for block type markers and compact overlines.

### Rules

- Sentence case is the default for headings, buttons, tabs and labels.
- Use tabular numerals in tables, metrics, timestamps and scientific values.
- Preserve scientific notation, units, superscripts and symbols exactly.
- Do not use all caps for ordinary navigation or buttons.
- Do not use font weight as the only hierarchy; combine it with size, colour and spacing.
- Page headings are compact and left aligned. Do not centre product headings.
- Long notebook prose remains comfortably readable; dense tables may use the data role but never fall below 12px.
- Truncate only when the full value remains available through expansion, tooltip or inspector.

**The Data Is Language Rule.** Units, precision, identifiers and scientific notation are content, not decoration. Typography must preserve their meaning and alignment.

## 4. Elevation

Sheetbase is flat by default. Hierarchy is created through background planes, borders and spacing before shadows.

- **Base plane:** no shadow. Application canvas, sidebar and standard document content.
- **Bounded surface:** 1px border with either no shadow or a near-imperceptible `shadow-xs`. Cards, fields, tables and notebook blocks.
- **Interactive lift:** a subtle increase on hover only where the entire surface is actionable. Do not lift static cards.
- **Floating surface:** popovers, menus and tooltips use a compact neutral shadow and a clear border.
- **Modal surface:** dialogs and sheets use the strongest elevation in the system, still neutral and without coloured glow.

Notebook blocks may gain a slight shadow on hover to reveal block-level manipulation, but the resting document must read as continuous rather than as stacked tiles.

**The Border Before Shadow Rule.** If a one-pixel boundary and background change can establish hierarchy, a shadow is forbidden.

**The No Nested Elevation Rule.** Do not place multiple shadowed cards inside another shadowed card. Internal regions use dividers, rows or flat sub-surfaces.

## 5. Components

All components are repository-owned shadcn-style components built on Base UI primitives, following the shadcn architecture and accessibility patterns; the legacy Radix kit under `src/components/ui/` is retained only for the internal `/foundations` and `/docs/$name` routes. shadcn supplies architecture, Sheetbase owns the visible language. New screens must compose existing components before introducing new primitives (ADR-0055).

### Buttons

- Primary buttons use Laboratory Blue and are limited to the principal action within a local region.
- Secondary buttons use a quiet neutral fill.
- Outline buttons are standard utility actions.
- Ghost buttons are for compact chrome, table rows and inspectors.
- Destructive buttons remain visually restrained until the destructive context is clear.
- Link buttons are textual actions, not substitutes for every tertiary button.
- Default height is 36px; compact controls are 32px; large controls are exceptional.
- Icon-only buttons require accessible labels and tooltips when the icon is not universally understood.
- Loading preserves button width and replaces or accompanies the icon with a spinner.

### Inputs and fields

- Inputs use a visible border, transparent or white fill and a 36px default height.
- Labels sit above fields in forms and remain visible; placeholders never replace labels.
- Focus uses Signal Blue border and a soft two-pixel ring.
- Validation appears adjacent to the relevant field and explains how to resolve the issue.
- Scientific units belong in a suffix, adjoining control or explicit label; never hide them in placeholder text.
- Read-only fields must look distinct from disabled controls.

### Navigation

- The left sidebar contains workspace navigation, project trees, folders and saved views.
- Active rows use Active Blue Wash with dark blue text, not a solid primary fill.
- Nested hierarchy uses indentation and disclosure controls rather than repeated card containers.
- Breadcrumbs show location, while tabs show the current record's internal views. Do not make them duplicate each other.
- Global search and command access use `⌘K` / `Ctrl+K` consistently.

### Cards and surfaces

- Cards are compact, flat and bounded by Border Slate.
- Standard radius is 8px.
- Card headers use a small component title and optional concise description.
- Cards are appropriate for independent summaries, inspectors and reusable widgets. They are not the default container for every section.
- Avoid nested cards. Use separators, grouped rows and subtle background changes inside a card.

### Badges and status

- Generic badges describe categories or compact metadata.
- `StatusBadge` owns the controlled record-state vocabulary: draft, planned, in progress, review, approved, locked, failed, warning and archived.
- Every status includes text and may include a small shape or icon. Never rely on hue alone.
- Use pale tonal backgrounds with darker foreground text. Solid saturated status pills are forbidden.
- Status words are lower case in compact badges unless grammar requires otherwise.

### Tables and data grids

- Tables default to read-only scanning. Editing, selection, grouping, validation and calculation are enabled deliberately.
- Headers remain visually quiet but clearly distinct from rows.
- Numeric values align right where comparison benefits; identifiers and categories align left.
- Sticky headers and pinned columns require a visible boundary when they overlap scrolling content.
- Selected rows use a blue wash, not a solid blue fill.
- Row actions appear on hover or focus but remain keyboard reachable.
- Empty, loading, error and partial-data states are part of the table component, not page-specific improvisations.
- A full spreadsheet-like surface may remove outer card chrome and occupy the working canvas edge to edge.

### Notebook blocks

- `NotebookBlock` is the base composition for text, headings, lists, checklists, tables, charts, files, images, equations, callouts, protocols, linked records and scientific results.
- Resting blocks form a continuous document rhythm. Borders are light; drag handles and overflow actions appear on hover or focus.
- Block titles use Instrument Sans component-title styling.
- Reordering, duplication, conversion and deletion belong in a consistent block menu.
- Embedded tables and charts can open into dedicated full-screen editors without losing notebook context.
- Two-column layouts are allowed for related concise blocks, but long prose and primary results remain full width.

### Charts

- `ChartFrame` owns title, subtitle, legend, export, expansion and overflow behaviour.
- Configuration controls sit outside the plot area.
- Every chart can link back to its source dataset and saved analysis view.
- The plot itself avoids card-like inset panels, decorative gradients and excessive annotation.
- Exports must preserve labels, units, legends and intended theme.

### Plate maps

- `PlateMap` supports standard plate geometries, clear row and column headers, semantic well assignments, selection and validation.
- Well colour is paired with labels, patterns, symbols or an inspector.
- Hover and keyboard focus reveal the same information.
- Dense plate maps may use square or mildly rounded wells; avoid playful bubble styling.

### Inspectors and properties

- `PropertyList` and the right-hand inspector provide contextual details, links, activity, comments, validation and actions.
- Property labels are quiet and consistent; values carry the visual weight.
- Inspector sections use dividers rather than independent cards unless the content is genuinely self-contained.
- A selected record remains visibly connected to its source row, node, well or notebook reference.

### Approvals and audit

- `ApprovalStepper` shows the current stage, completed stages and pending responsibility without implying compliance automatically.
- `AuditTrail` is chronological, attributable and specific. Events include actor, action, target and timestamp.
- Electronic signature and locking controls state consequences before confirmation.
- Version comparison uses stable side-by-side alignment, restrained added/removed colour and clear unchanged regions.

### Application states

- Loading uses skeletons that match the eventual structure, not generic centred spinners for whole pages.
- Empty states explain what is absent and offer one relevant next action.
- Error states preserve recoverable work and distinguish validation, permission, connectivity and server failures.
- Offline state is persistent but quiet, and must explain what will or will not sync.
- Permission-denied states do not expose restricted record detail.

**The Domain Component Rule.** A component belongs in `sheetbase/` only when it encodes reusable scientific or regulated meaning. Screen-specific arrangement remains a pattern or page composition.

## 6. Do's and Don'ts

### Do

- Do build screens from the documented primitives, scientific components and patterns.
- Do keep project context, record state and ownership visible during deep work.
- Do use the central canvas for the work and the right inspector for context.
- Do use semantic tokens rather than literal colours in feature code.
- Do preserve calm density through alignment and progressive disclosure.
- Do make tables, charts and notebook blocks feel like one coherent system.
- Do use Instrument Sans for headings and Inter for body copy, controls and data.
- Do show lineage, source data and review state where decisions depend on them.
- Do include keyboard, focus, loading, empty, error and permission states during component definition.
- Do verify contrast and support non-colour distinctions in scientific visualisations.
- Do use actual scientific labels, realistic data lengths and messy edge cases when evaluating components.
- Do treat light, dark, comfortable and compact modes as first-class variants of the same system.

### Don't

- Do not default every page to a grid of statistic cards.
- Do not turn notebook sections into a mosaic of disconnected tiles.
- Do not use oversized marketing typography inside the application.
- Do not introduce a new blue, radius, shadow or font because one screen feels special.
- Do not use purple gradients, glassmorphism, glows, floating spheres or decorative grid backgrounds.
- Do not use random molecular, DNA or laboratory illustrations as filler.
- Do not nest rounded cards inside rounded cards.
- Do not use colour without semantic meaning.
- Do not make status, chart series or validation understandable only through colour.
- Do not shrink body or table text below the documented minimum to fit more content.
- Do not claim “compliant” without a real, configured and reviewable basis.
- Do not hide units, precision or provenance to make a layout look cleaner.
- Do not make right-click, hover or drag the only route to an action.
- Do not let shadcn defaults dictate the visual identity; shadcn is the component architecture, not the brand.
- Do not create a scientific component for a one-off page arrangement.

**The Screenshot Test.** A Sheetbase screen should remain recognisable without its logo: bright cool neutrals, compact blue actions, stable edge navigation, disciplined borders, dense scientific information and no decorative SaaS effects.
