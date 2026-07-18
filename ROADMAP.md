# Sheetbase roadmap

## Destination

The first destination is a trustworthy single-user alpha in which a scientist can sign in with GitHub, create a project and experiment notebook, write a mixed block document, work with a real editable PostgreSQL-backed sheet using Handsontable and HyperFormula, and understand how every visible object maps to an authenticated REST API.

This alpha establishes the product architecture. The remaining mockup surfaces should then be built as compositions over the same records, relationships, tables, calculations, events and UI components rather than as independent applications.

## Principles that govern the route

- The notebook remains the centre of gravity; registries and specialist workspaces support it.
- PostgreSQL is authoritative. PostgREST exposes safe CRUD and controlled RPCs, while row-level security remains the access-control boundary.
- The browser uses an authenticated application proxy. External clients use scoped API credentials, and both reach the same PostgREST contract.
- Handsontable is for spreadsheet-like scientific editing. TanStack Table is for registries, queues and read-oriented operational views.
- HyperFormula formulas are durable definitions. Calculated values may be cached for display and querying, but they are never the sole authoritative representation of a calculation.
- The mockups and concept system are the approved visual direction. Components are improved in place rather than replaced with a different aesthetic.
- Traceability, accessibility and failure states are designed with the normal workflow, not added after it.

## Roadmap

### 0. Product and project baseline — complete

The repository has the TanStack Start scaffold, TanStack Query, DB and Table dependencies, Drizzle, PostgreSQL development services, Tailwind and shadcn foundations, product guidance, design tokens and the source mockups. Validation currently covers formatting, linting, types, tests and a production build.

The next phase starts from this baseline; it should not implement screens before the application and data boundaries are proven.

### 1. Runtime, identity and authenticated API spine

Establish the smallest secure path through the complete system:

- run the application, PostgreSQL and its own PostgREST service locally;
- add migration and seed workflows with repeatable development bootstrap;
- integrate Better Auth with GitHub sign-in and sign-up;
- make the first user the owner of the initial workspace while retaining a membership model that can support invitations later;
- define the browser session-to-PostgREST JWT bridge and scoped external API credentials;
- establish row-level security, safe CRUD roles and controlled RPC conventions;
- add request correlation, structured errors and health checks at service boundaries;
- prove one authenticated workspace and project resource through REST and the application.

**Exit gate:** a fresh checkout can be started predictably; GitHub authentication creates a user and workspace membership; an authenticated browser request and an external API request can read the same project through PostgREST; anonymous and cross-workspace access tests fail correctly.

### 2. Productionise the concept UI system

Bring the existing visual system into the application without building complete product screens:

- port and normalise the approved tokens, typography, icons, density and application chrome;
- harden the shadcn primitives and existing scientific components for keyboard use, focus, disabled, loading, empty, error and permission states;
- add the stable application shell: workspace navigation, project tree, top bar, central canvas and reusable right inspector;
- deepen `StatusBadge`, `PropertyList`, `RecordLink`, `NotebookBlock`, `ChartFrame`, `PlateMap`, `AuditTrail` and `ApprovalStepper` as composable, data-independent components;
- define responsive behaviour, including inspectors becoming sheets on narrow screens;
- keep a local component gallery for visual and interaction review.

**Exit gate:** the shell and core components reproduce the concept direction at production quality, meet the WCAG 2.2 AA baseline, and can be composed without screen-specific styling forks.

### 3. Notebook domain model and live document vertical slice

Build the first real ELN workflow around stable, addressable records and blocks:

- model workspaces, projects, folders, notebooks, experiments, blocks, links and revisions;
- define typed block payload schemas and forward-compatible versioning;
- implement the notebook record header, continuous document canvas and contextual inspector;
- support text, headings, checklists and linked-record blocks first;
- implement autosave, optimistic updates, conflict detection and durable change events;
- use PostgreSQL change records and notifications with replayable server-sent events for multi-tab liveness;
- expose notebooks, blocks and record links through approachable REST resources.

**Exit gate:** a user can create and edit an experiment notebook, reorder blocks, link records, reload without losing state and observe coherent changes in a second browser tab. Each block has a stable API identity, revision history and audit attribution.

### 4. Scientific sheet and calculation engine

Make the spreadsheet experience a first-class notebook block rather than an embedded file:

- add the Handsontable sheet block with scientific column types, units, validation, copy/paste, fill, import and export;
- create real PostgreSQL-backed data tables with explicit schemas and stable row identities;
- scope a HyperFormula workbook to each notebook and a calculation sheet to each sheet block;
- persist literals, formula definitions, dependencies, errors and optional cached results separately;
- support safe cross-sheet references, recalculation, circular-reference reporting and schema changes;
- add an API inspector that shows resource names, fields, types, endpoint paths and usable request examples next to the configured table;
- ensure direct REST edits, UI edits and recalculation produce the same liveness and audit events.

**Exit gate:** a user can configure a sheet, enter data and formulas, reference another notebook sheet, inspect the corresponding REST API, edit through that API and see the result update live in Handsontable with calculation provenance intact.

### 5. Complete the useful notebook loop

Expand the notebook from a technical vertical slice into a useful scientific record:

- protocol and reusable template blocks;
- chart blocks driven by saved dataset and transformation specifications;
- file and instrument-output attachments with a deliberate object-storage boundary;
- materials, sample, reagent and dataset links;
- plate-map blocks and notebook validation checks;
- experiment overview as a curated read view over the same notebook data;
- search indexing for records, block text, structured fields and relationships.

**Exit gate:** the Virus Stability concept can be recreated as a working record from real data, including its protocol, experimental design sheet, calculations, chart, linked samples and files, without bespoke data hidden in the screen.

### 6. Review, signatures and record integrity

Build review only after revisions and calculations have stable semantics:

- immutable submitted versions and meaningful text, table and formula diffs;
- anchored comments, reviewer checklists and resolution state;
- configurable approval steps and reviewer assignments;
- explicit signing intent, re-authentication, signature records and record locking;
- calculation, data-integrity and completeness checks against the submitted version;
- readable audit trail, lineage and exportable evidence;
- careful product language that supports regulated use without claiming compliance by feature presence.

**Exit gate:** a submitted experiment can be reviewed against a fixed version, returned for changes or signed and locked, and its full history can be reconstructed without mutable evidence.

### 7. Data, analysis and traceability workspaces

Compose the next product surfaces from the proven platform:

1. Samples and reagents registries, using TanStack Table with selected-record inspectors.
2. Dataset Explorer, using Handsontable only for editable modes and TanStack Table for query and review modes.
3. Analysis Studio, with saved transformations, chart specifications and accessible data alternatives.
4. Lineage Explorer, derived from real record links, transformations, revisions and approvals.
5. Knowledge Search and Template Library, using the same object and permission model.

**Exit gate:** these workspaces read and mutate the same REST-addressable objects used by notebooks, and no surface requires a parallel source of truth.

### 8. Planning and laboratory operations

Add the operational surfaces once the core record model has real usage to inform them:

- project and personal dashboards;
- freezer and storage maps;
- plate designer workflow;
- lab calendar and study planner;
- instrument run monitoring and ingestion;
- reports and report builder;
- workspace permissions and administrative configuration.

Each should begin with a narrow workflow and reuse the shell, inspectors, tables, record links, statuses and audit events already established.

**Exit gate:** the remaining concept screens are supported by shared domain capabilities and components, with integrations isolated behind stable interfaces.

### 9. Operational hardening and release readiness

Harden the product continuously, with a formal release gate after the principal workflows exist:

- backup, restore and migration rehearsal;
- observability, audit-event integrity and operational diagnostics;
- security and threat-model review, dependency scanning and secret handling;
- browser, accessibility, performance and large-dataset testing;
- offline and degraded-connection behaviour for active notebook edits;
- tenancy isolation and invitation controls before adding users beyond the initial owner;
- deployment documentation and reproducible environment promotion.

**Exit gate:** the application has evidence-backed recovery, security, accessibility and performance characteristics for its intended initial deployment.

## Decisions to lock before their phase starts

These decisions are deliberately deferred until the preceding vertical slice provides enough evidence:

- the precise block persistence and revision granularity before notebook implementation;
- the generated-table naming, schema migration and REST discovery contract before scientific sheets;
- the supported HyperFormula function set, calculation trust boundary and recalculation policy before formula work;
- the file and instrument-data storage boundary before attachments;
- the signature assurance level and validation obligations before regulated review claims;
- the order of operational workspaces after the first notebook workflows reveal actual daily priorities.

## Delivery rhythm

Each phase should be delivered as a narrow end-to-end slice with migrations, API contract tests, UI interaction tests and a demonstrable workflow. A phase is complete only when its exit gate works from a fresh environment; installing a dependency or rendering a static screen is not completion.

The roadmap should be revisited at every exit gate. Newly learned constraints may change later phases, but they should not weaken the destination or create a second source of truth.
