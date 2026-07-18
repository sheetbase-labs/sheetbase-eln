# Sheetbase implementation TODO

This is the executable companion to [ROADMAP.md](./ROADMAP.md). It turns the roadmap into implementation-sized tickets for a developer who is new to the project. Work in dependency order, and finish one vertical slice before opening several adjacent layers at once.

## How to use this file

- A ticket is complete only when every checkbox under it is complete and its behaviour can be demonstrated from a fresh local environment.
- Read `PRODUCT.md`, `DESIGN.md`, the relevant mockup, and the matching component in `Concepts/sheetbase-ui-system-v2` before changing a user-facing workflow.
- Preserve the mockup and concept-system direction. Improve incomplete behaviour and component contracts without casually redesigning the product.
- Prefer a thin end-to-end path through database, permissions, API, application and tests over building an entire layer with nothing usable above it.
- Add a migration for every durable schema change. Never edit an already-applied migration to make a later change.
- Keep PostgreSQL and row-level security authoritative. Application checks may improve errors, but they must not be the only access-control boundary.
- Run focused tests while developing and `pnpm validate` before marking a ticket complete.
- Record a short architectural decision when a ticket settles a durable contract that a future developer might otherwise reverse accidentally.
- Do not claim regulatory compliance. Implement capabilities and evidence honestly, then validate the configured process separately.

## Definition of done for every ticket

- [ ] The user-visible outcome or API behaviour described by the ticket works.
- [ ] Loading, empty, success, recoverable-error and permission-denied states are handled where applicable.
- [ ] Keyboard operation, focus visibility, labels and screen-reader semantics have been considered for UI work.
- [ ] Database changes include migrations, constraints and rollback or recovery notes.
- [ ] API changes include authentication, authorisation, validation and stable error behaviour.
- [ ] Automated tests cover the successful path and the most important failure or isolation path.
- [ ] Developer documentation and environment examples are updated when setup or behaviour changed.
- [ ] `pnpm validate` passes from the repository root.

---

## Phase 0 — Foundation and working conventions

### FND-001 — Preserve the product baseline

**Blocked by:** Nothing.

- [x] Keep the original mockups and concept UI system in the repository as reference material.
- [x] Document the product audience, boundaries, design direction and accessibility baseline.
- [x] Establish the TanStack Start, React, PostgreSQL, Drizzle, TanStack Query, TanStack DB, TanStack Table, Tailwind and shadcn foundation.
- [x] Add formatting, linting, type-checking, testing and production-build commands.
- [x] Confirm the clean scaffold passes the full validation command.

### FND-002 — Document repository working conventions

**Blocked by:** FND-001.

- [x] Explain the production/source/reference directory boundaries in the README.
- [x] Document naming rules for database objects, REST resources, domain identifiers and event types.
- [x] Document when to use TanStack Table and when to use Handsontable.
- [x] Document the expected migration workflow, including generation, review, application and fresh-database verification.
- [x] Document the testing layers: unit, component, database integration, API contract and browser workflow tests.
- [x] Add a brief decision-record convention and a location for durable architectural decisions.
- [x] Verify a new developer can find the start, test, migrate and validation commands without reading source code.

### FND-003 — Add reproducible test-data conventions

**Blocked by:** FND-002.

- [x] Define stable fixture identities for the initial user, workspace, project and Virus Stability example.
- [x] Separate minimal test fixtures from richer demonstration seed data.
- [x] Make seed operations idempotent so rerunning them does not duplicate records.
- [x] Ensure tests create and clean up isolated data without depending on demonstration seeds.
- [x] Document how to reset only the local development database safely.
- [x] Add a verification that a fresh database can be migrated and seeded in one documented flow.

---

## Phase 1 — Runtime, identity and authenticated REST API

### API-001 — Run PostgreSQL and PostgREST as local services

**Blocked by:** FND-002.

- [x] Add PostgREST to the local service composition using a pinned version.
- [x] Give PostgREST a health check and make its database dependency explicit.
- [x] Keep database credentials, JWT secrets and exposed schemas in environment configuration rather than source code.
- [x] Bind development ports clearly and avoid exposing privileged database credentials to the browser.
- [x] Add documented commands to start, stop, inspect and recreate the local services.
- [x] Confirm PostgreSQL data survives a normal service restart.
- [x] Confirm the PostgREST health endpoint becomes ready only after PostgreSQL is ready.

### API-002 — Establish database roles and exposed schemas

**Blocked by:** API-001.

- [x] Define separate database roles for migrations, PostgREST connection pooling, anonymous requests, authenticated users and narrowly controlled service operations.
- [x] Define which schemas PostgREST exposes and keep internal implementation schemas hidden.
- [x] Remove broad default privileges and grant only the access each role needs.
- [x] Establish a convention for safe CRUD tables, read-only views and mutation RPCs.
- [x] Ensure anonymous requests cannot enumerate private tables or schema details beyond the intended API surface.
- [x] Add integration tests proving privileged and unprivileged roles have different capabilities.
- [x] Document how claims from a request become PostgreSQL session settings available to row-level-security policies.

### API-003 — Create the identity and workspace schema

**Blocked by:** API-002, FND-003.

- [x] Add durable user, account, session and verification tables required by Better Auth using its supported schema conventions.
- [x] Add workspaces and workspace memberships with explicit owner/member roles and lifecycle timestamps.
- [x] Use stable primary keys, uniqueness constraints and foreign keys that prevent orphaned memberships.
- [x] Decide how deleted or disabled users and workspaces are represented without destroying audit history.
- [x] Add the initial project table with workspace ownership, human-readable title, stable identifier, status and timestamps.
- [x] Add database-generated timestamps and update behaviour consistently.
- [x] Create minimal seed data for integration tests without bypassing production constraints.
- [x] Verify migrations apply to an empty database and the schema matches the migration history.

### AUTH-001 — Integrate Better Auth with GitHub

**Blocked by:** API-003.

- [x] Add Better Auth and its Drizzle adapter using the project database connection.
- [x] Configure the GitHub provider through validated server-only environment variables.
- [x] Add documented GitHub OAuth callback URLs for local development.
- [x] Implement sign-in, callback, session lookup and sign-out routes using TanStack Start integration patterns.
- [x] Allow GitHub sign-up while the product is single-user, without hard-coding the initial user's email or GitHub identifier.
- [x] Handle denied consent, missing email, provider errors and expired state with understandable recovery messages.
- [x] Ensure authentication cookies use appropriate HTTP-only, secure and same-site settings for each environment.
- [x] Add tests for session creation, session expiry and unauthenticated access without making live GitHub calls.
- [x] Document the manual steps needed to create the GitHub OAuth application.

### AUTH-002 — Bootstrap the first workspace owner

**Blocked by:** AUTH-001.

- [x] On the first successful sign-up, create an initial workspace and owner membership in one transaction.
- [x] Make repeat callbacks and retries idempotent so they cannot create duplicate workspaces or memberships.
- [x] Define the behaviour for later sign-ups while open registration remains enabled.
- [x] Keep the membership model compatible with invitation-only registration later.
- [x] Route a signed-in user with no valid workspace to a recoverable bootstrap flow.
- [x] Add tests for first-user bootstrap, repeat sign-in and partial-failure rollback.
- [x] Display the active workspace and signed-in identity in a minimal authenticated page.

### AUTH-003 — Issue short-lived PostgREST claims for browser requests

**Blocked by:** AUTH-002, API-002.

- [x] Define the minimal JWT claim set: subject, workspace context, database role, session identity and expiry.
- [x] Keep the signing secret and token creation on the server.
- [x] Exchange a valid application session for a short-lived PostgREST token only inside the server-side API boundary.
- [x] Forward authenticated browser CRUD requests through a same-origin internal proxy rather than exposing the application session to PostgREST directly.
- [x] Reject missing, expired or workspace-mismatched sessions before forwarding.
- [x] Preserve safe query parameters and HTTP semantics while preventing arbitrary upstream targeting.
- [x] Return a consistent, non-sensitive error envelope for authentication and upstream failures.
- [x] Add contract tests proving claims reach PostgreSQL session settings correctly.

### AUTH-004 — Enforce workspace isolation with row-level security

**Blocked by:** AUTH-003, API-003.

- [x] Enable row-level security on every workspace-owned table.
- [x] Add policies for reading and writing only records belonging to the active membership and workspace claim.
- [x] Ensure inserts cannot choose a different workspace than the authenticated context.
- [x] Ensure updates cannot move records between workspaces.
- [x] Define owner-only operations separately from ordinary member operations.
- [x] Force row-level security where table ownership could otherwise bypass it in normal API use.
- [x] Test reads, inserts, updates and deletes using two workspaces and multiple roles.
- [x] Test that missing or malformed claims return no private data.

### API-004 — Deliver the first authenticated project vertical slice

**Blocked by:** AUTH-004.

- [x] Expose projects through PostgREST with stable field names and predictable filtering.
- [x] Add any controlled project mutation RPCs that cannot safely be represented as direct CRUD.
- [x] Build a minimal project list and create-project interaction in the authenticated application.
- [x] Fetch and mutate through TanStack Query using the same-origin authenticated API boundary.
- [x] Show useful loading, empty, validation and permission states.
- [x] Add optimistic creation only if rollback and duplicate prevention are reliable.
- [x] Prove that a project created through REST appears in the application and vice versa.
- [x] Add API contract, RLS isolation and component interaction tests.

### API-005 — Add scoped external API credentials

**Blocked by:** API-004.

- [x] Define API credential records with workspace ownership, a display prefix, hashed secret material, scopes, creation time, last-used time and revocation time.
- [x] Show the full credential only once at creation and never store or log it in recoverable plaintext.
- [x] Exchange a valid credential for short-lived PostgREST claims with narrower capabilities than the credential's scopes.
- [x] Support revocation and make revoked credentials fail immediately.
- [x] Add an initial read/write projects scope to prove scope enforcement without inventing the entire future vocabulary.
- [x] Rate-limit or otherwise protect credential exchange from unbounded guessing.
- [x] Add tests for creation, successful use, wrong secret, wrong scope, expiry and revocation.
- [x] Document a command-line example that reads the same project visible in the UI.

### API-006 — Add service health, errors and request diagnostics

**Blocked by:** API-004.

- [x] Provide liveness and readiness checks that distinguish application health from database and PostgREST readiness.
- [x] Define a request or correlation identifier propagated through the application, PostgREST boundary and logs.
- [x] Map database validation, permission, conflict and unavailable-service failures to stable public error categories.
- [x] Keep secrets, tokens, cookies, formula contents and sensitive scientific payloads out of logs by default.
- [x] Add structured server logging with useful request context and documented severity conventions.
- [x] Test that expected user errors do not appear as unclassified server failures.
- [x] Add a short troubleshooting section for common local startup and authentication failures.

### API-007 — Automate the Phase 1 fresh-environment proof

**Blocked by:** AUTH-004, API-005, API-006.

- [x] Add one repeatable command or test target that starts from an empty test database, applies migrations and creates fixtures.
- [x] Prove anonymous project access fails.
- [x] Prove a browser-session-equivalent claim can create and read a project.
- [x] Prove a scoped external credential can read the same project.
- [x] Prove a second workspace cannot read or mutate it.
- [x] Ensure the proof cleans up only resources it created.
- [x] Document the expected output and make failures identify the broken boundary.

---

## Phase 2 — Production UI system and application shell

### UI-001 — Reconcile design tokens and fonts

**Blocked by:** FND-001.

- [x] Compare production tokens with `DESIGN.md`, the brand guide mockup and the concept system.
- [x] Add Instrument Sans for headings and Inter for body, controls and data with reliable local or hosted loading behaviour.
- [x] Preserve the approved blue, scientific neutrals, semantic statuses and ordered chart palette.
- [x] Define compact and comfortable density tokens without shrinking text below the design baseline.
- [x] Confirm light and dark themes maintain equivalent hierarchy and readable contrast.
- [x] Add tabular-number and scientific-value typography utilities.
- [x] Add a visual review page showing colours, typography, spacing, radii and focus rings.
- [x] Check common token combinations against WCAG 2.2 AA contrast expectations.

### UI-002 — Harden core shadcn primitives

**Blocked by:** UI-001.

- [x] Bring over only the primitives needed by the next tickets, using the source-owned shadcn convention.
- [x] Reconcile concept variants for buttons, badges, fields, dialogs, sheets, menus, tabs, tables, tooltips and command surfaces.
- [x] Provide consistent sizes, focus treatment, disabled state, destructive confirmation and icon labelling.
- [x] Ensure overlays trap and restore focus correctly and close through expected keyboard controls.
- [x] Ensure form controls expose labels, descriptions and validation errors programmatically.
- [x] Add component tests for keyboard interaction and the most important variants.
- [x] Avoid screen-specific variants until at least two real consumers justify them.

### UI-003 — Build the stable application shell

**Blocked by:** UI-002, AUTH-002.

- [x] Implement the left workspace and project-navigation plane shown in the mockups.
- [x] Implement the compact top bar with breadcrumbs, search affordance, primary action area and account access.
- [x] Reserve the centre for the active work and the right edge for an optional contextual inspector.
- [x] Keep left navigation and inspector widths stable on desktop while allowing the centre to grow.
- [x] Make navigation collapsible without losing the active project and record context.
- [x] Convert the inspector to a modal sheet on narrower screens.
- [x] Preserve browser navigation, deep links and route-level loading behaviour.
- [x] Add skip navigation and sensible landmark semantics.
- [x] Test keyboard navigation, zoom, long project names and narrow desktop widths.

### UI-004 — Build reusable record headers and inspectors

**Blocked by:** UI-003.

- [ ] Implement a compact record header with type, status, identifier, owner, dates, contributors and actions.
- [ ] Allow fields to disappear cleanly when a record type does not provide them.
- [ ] Implement reusable inspector sections with tabs, property lists, linked records, files, checks, activity and comments.
- [ ] Keep the selected record or row reflected in the URL where deep linking is useful.
- [ ] Make inspector content scroll independently without hiding its identity and close controls.
- [ ] Include skeleton, no-selection, unavailable-record and permission-denied states.
- [ ] Test long identifiers, long units, many tags and translated or user-provided text.

### UI-005 — Productionise scientific status and relationship components

**Blocked by:** UI-002.

- [ ] Replace hard-coded demonstration data in `StatusBadge`, `PropertyList` and `RecordLink` with explicit reusable inputs.
- [ ] Define status vocabulary by domain rather than assuming every record uses the same state machine.
- [ ] Ensure status is communicated by text and shape or icon as well as colour.
- [ ] Make record links work as actual links while preserving auxiliary actions and keyboard use.
- [ ] Support missing, deleted and permission-restricted linked records honestly.
- [ ] Add compact and comfortable variants only where the mockups demonstrate a need.
- [ ] Add tests for accessible names, focus and status rendering.

### UI-006 — Productionise notebook and visualisation frames

**Blocked by:** UI-002.

- [ ] Turn `NotebookBlock` into a composable visual frame without embedding notebook persistence inside it.
- [ ] Support selected, editing, dragging, invalid, locked, loading and read-only states.
- [ ] Keep drag handles and action menus discoverable to mouse and keyboard users.
- [ ] Turn `ChartFrame` into a reusable frame with title, subtitle, provenance, live/snapshot state, legend, accessible alternative and actions.
- [ ] Turn `PlateMap` into a semantic grid with row and column labels, legend, missing-value treatment and keyboard selection.
- [ ] Ensure all three components work in full-width canvases and narrower notebook columns.
- [ ] Add interaction and accessibility tests without tying the components to sample data.

### UI-007 — Productionise audit and approval components

**Blocked by:** UI-002.

- [ ] Make `AuditTrail` accept real typed events, actors, timestamps, targets and pagination or continuation.
- [ ] Make `ApprovalStepper` accept a workflow definition and current immutable review state.
- [ ] Distinguish pending, active, completed, rejected, returned and unavailable steps.
- [ ] Provide complete text for screen readers rather than relying on connector graphics.
- [ ] Handle long histories and many approval steps without making inspectors unusable.
- [ ] Keep display components separate from the commands that mutate review state.
- [ ] Add tests for ordering, state labels and missing actor data.

### UI-008 — Establish the component gallery and visual review gate

**Blocked by:** UI-003, UI-004, UI-005, UI-006, UI-007.

- [ ] Create a development-only catalogue route or component environment that uses production components.
- [ ] Show default, dense, dark, loading, empty, error, disabled, locked and permission states.
- [ ] Include realistic scientific values, long names, units, identifiers and large counts.
- [ ] Add automated accessibility checks for the catalogue where practical.
- [ ] Add stable screenshots for the highest-value component compositions.
- [ ] Document how reviewers compare changes with the mockups and concept system.
- [ ] Confirm the catalogue is excluded or access-controlled appropriately in production.

---

## Phase 3 — Notebook domain and live document

### ELN-001 — Lock the record, notebook and block vocabulary

**Blocked by:** API-007, UI-008.

- [ ] Write a short domain decision describing workspaces, projects, folders, notebooks, experiments, records, sections, blocks and links.
- [ ] Decide whether an experiment owns a notebook or is one kind of notebook-backed record, and use that language consistently.
- [ ] Define which objects have stable public identifiers in addition to database primary keys.
- [ ] Define block types, shared block metadata and type-specific payload ownership.
- [ ] Define soft deletion, archival and restoration semantics.
- [ ] Define revision boundaries for metadata, block structure and block content.
- [ ] Review the model against the Experiment Notebook, Protocol Template and Report Builder mockups.

### ELN-002 — Create the notebook persistence schema

**Blocked by:** ELN-001.

- [ ] Add folders, notebook-backed records, blocks, block ordering and record-link tables.
- [ ] Add workspace ownership, stable identifiers, timestamps, actor attribution and optimistic-concurrency versions.
- [ ] Store typed block payloads with a schema version and validate them at the application boundary.
- [ ] Use constraints to prevent duplicate ordering positions, dangling links and cross-workspace relationships.
- [ ] Define an ordering strategy that supports insertion and reordering without rewriting every block on routine edits.
- [ ] Add indexes for project navigation, notebook loading, block ordering and linked-record lookup.
- [ ] Apply row-level security and test isolation for every new table.
- [ ] Add representative notebook fixtures using the Virus Stability example.

### ELN-003 — Expose notebook records and blocks through REST

**Blocked by:** ELN-002.

- [ ] Expose safe reads and straightforward writes through PostgREST.
- [ ] Add controlled RPCs for multi-row operations such as creating a record with initial blocks or moving a block atomically.
- [ ] Require expected-version values for mutations where silent overwrites would lose work.
- [ ] Return enough information for the client to reconcile created identifiers, order and versions.
- [ ] Define stable error categories for invalid payload, stale version, missing link and permission denial.
- [ ] Add contract tests for create, load, edit, reorder, link, archive and restore operations.
- [ ] Include command-line examples that make the notebook-to-API mapping obvious.

### ELN-004 — Build the experiment notebook route and record header

**Blocked by:** ELN-003, UI-004.

- [ ] Add a deep-linkable project and experiment notebook route.
- [ ] Load record metadata, blocks and inspector context through route-aware query patterns.
- [ ] Render the approved compact record header and continuous central document canvas.
- [ ] Keep the active project, record status and ownership visible while scrolling.
- [ ] Handle missing, archived and permission-restricted notebooks.
- [ ] Provide a useful first-run empty notebook rather than a blank white page.
- [ ] Add route, loading and error-boundary tests.

### ELN-005 — Implement basic typed block rendering and insertion

**Blocked by:** ELN-004, UI-006.

- [ ] Implement read and edit behaviour for heading, rich text, checklist and linked-record blocks.
- [ ] Add an insertion control and keyboard-accessible block picker using familiar labels.
- [ ] Validate block payloads before mutation and preserve unsupported future block types as readable placeholders.
- [ ] Give every block a stable selection target and URL or anchor where comments and review can refer to it later.
- [ ] Support block duplication and deletion with appropriate confirmation and undo where safe.
- [ ] Avoid storing transient editor state as scientific content.
- [ ] Add component and API integration tests for each initial block type.

### ELN-006 — Implement block ordering and keyboard movement

**Blocked by:** ELN-005.

- [ ] Add pointer drag-and-drop with a clear insertion indicator and scrolling behaviour.
- [ ] Provide keyboard commands or menu actions that achieve the same moves.
- [ ] Persist a move atomically and reject moves based on stale notebook structure.
- [ ] Roll back optimistic movement clearly if the server rejects it.
- [ ] Preserve focus and selection after a move.
- [ ] Test moving first, middle and last blocks and concurrent conflicting moves.

### LIVE-001 — Create durable workspace change events

**Blocked by:** ELN-003.

- [ ] Add an append-only change table with workspace, sequence, entity, operation, record identity, actor, client identity and timestamp.
- [ ] Generate events transactionally with durable notebook and project mutations.
- [ ] Publish lightweight PostgreSQL notifications that point to durable events rather than containing the full source of truth.
- [ ] Make event ordering and replay boundaries explicit.
- [ ] Prevent clients from writing or forging audit/change events directly.
- [ ] Add retention and cleanup placeholders without deleting data needed by active replay clients.
- [ ] Test transaction rollback, ordering and workspace isolation.

### LIVE-002 — Deliver replayable server-sent events

**Blocked by:** LIVE-001, AUTH-003.

- [ ] Add an authenticated SSE endpoint scoped to the active workspace.
- [ ] Support reconnection from a last-seen event identifier.
- [ ] Replay missed durable events before switching to live notifications.
- [ ] Send heartbeats and close connections whose sessions are no longer valid.
- [ ] Bound replay requests and return a recoverable reset instruction if the requested history is unavailable.
- [ ] Avoid leaking event metadata from other workspaces.
- [ ] Add tests for initial connection, replay, reconnect, expiry and isolation.

### LIVE-003 — Connect TanStack Query and TanStack DB to live events

**Blocked by:** LIVE-002, ELN-005.

- [ ] Define query-backed collections for projects, records, blocks and links where they improve reactive composition.
- [ ] Include a stable client identity on mutations so the client can reconcile its own echoed events.
- [ ] Invalidate or patch only the collections affected by each event type.
- [ ] Preserve optimistic changes until confirmed and roll them back on conflict or rejection.
- [ ] Avoid duplicate application when an event is replayed or received twice.
- [ ] Expose connection and stale-data status without distracting from normal notebook work.
- [ ] Test two-tab editing, reconnect after missed events and duplicate delivery.

### ELN-007 — Add autosave and conflict handling

**Blocked by:** LIVE-003.

- [ ] Autosave edited block content after a short, visible debounce without saving every keystroke separately.
- [ ] Show saving, saved, offline/stale and failed states truthfully.
- [ ] Include the expected server version and client identity with each save.
- [ ] When versions conflict, preserve both the local draft and server value and offer a comprehensible resolution path.
- [ ] Do not silently overwrite a newer remote edit.
- [ ] Retry transient failures with bounds and leave permanent validation failures attached to the affected block.
- [ ] Warn before navigation only when unsaved work genuinely remains at risk.
- [ ] Test rapid edits, slow responses, transient failure, stale version and tab closure.

### ELN-008 — Complete the first live-notebook acceptance proof

**Blocked by:** ELN-006, ELN-007.

- [ ] Create an experiment notebook through the UI.
- [ ] Add, edit, reorder and link the initial block types.
- [ ] Reload and confirm content, order and identifiers are stable.
- [ ] Open a second tab and confirm saved changes arrive without a full-page reload.
- [ ] Trigger a controlled conflict and confirm neither version is silently lost.
- [ ] Read the same notebook and blocks through an external API credential.
- [ ] Confirm audit/change attribution identifies the acting user and client.
- [ ] Automate the stable portions of this workflow as browser and API tests.

---

## Phase 4 — Handsontable and HyperFormula

### DATA-001 — Lock the scientific table contract

**Blocked by:** ELN-008.

- [ ] Decide how user-configured tables map to PostgreSQL schemas and PostgREST resource names.
- [ ] Define stable table, column and row identities independently from mutable display names.
- [ ] Define supported column types, nullability, defaults, units, validation and categorical constraints.
- [ ] Define safe schema evolution for adding, renaming, reordering, converting and retiring columns.
- [ ] Define which changes use direct CRUD and which require transactional RPCs.
- [ ] Define how formulas relate to literal source columns and calculated outputs.
- [ ] Review the contract against Dataset Explorer, notebook sheets and the `db-api` precedent.

### DATA-002 — Create metadata and generated-table management

**Blocked by:** DATA-001.

- [ ] Add metadata for scientific tables, columns, display order, types, units, validation and owning notebook block.
- [ ] Add controlled database functions for creating and evolving physical data tables safely.
- [ ] Quote and validate generated identifiers so user-facing names cannot become SQL injection surfaces.
- [ ] Keep generated resources inside explicitly managed schemas and grants.
- [ ] Apply workspace isolation to generated rows and prevent cross-workspace joins through exposed resources.
- [ ] Make metadata and physical-schema changes transactional wherever PostgreSQL permits.
- [ ] Record schema-change events and actor attribution.
- [ ] Add tests for creation, common alterations, invalid identifiers, partial failure and isolation.

### DATA-003 — Expose scientific tables through authenticated REST

**Blocked by:** DATA-002, API-005.

- [ ] Make newly created tables discoverable through a stable Sheetbase metadata endpoint.
- [ ] Expose permitted row CRUD through PostgREST without requiring a custom endpoint per table.
- [ ] Apply scope and row-level-security rules consistently to browser and external clients.
- [ ] Return column type, unit, validation and relationship metadata separately from raw rows.
- [ ] Support pagination, filtering, ordering and safe bulk operations.
- [ ] Define optimistic-concurrency behaviour using stable row identities and update timestamps or versions.
- [ ] Add command-line examples and contract tests for create, read, update, delete, filter and conflict.

### SHEET-001 — Add the Handsontable dependency and licence boundary

**Blocked by:** UI-006, DATA-003.

- [ ] Add Handsontable through the package manager using the approved commercial licence.
- [ ] Keep licence configuration outside committed secrets while making local setup explicit.
- [ ] Load the grid only on the client and avoid server-rendering assumptions that break TanStack Start.
- [ ] Establish a wrapper component that owns Sheetbase styling, accessibility notes and integration conventions.
- [ ] Match grid typography, borders, selection and controls to the concept system rather than accepting default vendor styling.
- [ ] Provide a clear failure state when licence or client initialisation fails.
- [ ] Add a small isolated rendering test and document any browser-test-only behaviour.

### SHEET-002 — Build a read/write PostgreSQL-backed sheet block

**Blocked by:** SHEET-001, ELN-005.

- [ ] Add a typed sheet block that points to scientific-table metadata rather than embedding all data in its block payload.
- [ ] Load columns and paged rows through the authenticated API boundary.
- [ ] Map scientific column types, units and validation to suitable Handsontable editors and renderers.
- [ ] Persist cell edits with stable row and column identities.
- [ ] Batch paste and fill operations so they are atomic enough to avoid half-applied scientific edits.
- [ ] Reconcile optimistic edits with live events and report conflicts at the affected cells or rows.
- [ ] Support read-only and locked-record modes without relying on visual styling alone.
- [ ] Add tests for text, number, category, date, null, validation failure, paste and conflict.

### SHEET-003 — Add table configuration and schema evolution UI

**Blocked by:** SHEET-002.

- [ ] Let a user name a sheet and configure columns with label, type, unit, required state, default and validation.
- [ ] Preview destructive consequences before converting or retiring populated columns.
- [ ] Keep display-name changes separate from stable API identifiers and explain the difference.
- [ ] Require explicit confirmation for changes that can invalidate formulas or API clients.
- [ ] Show migration progress and recoverable failures without leaving metadata out of sync with PostgreSQL.
- [ ] Update the grid and API metadata live after successful schema changes.
- [ ] Add tests for adding, renaming, reordering and safely rejecting incompatible conversion.

### CALC-001 — Lock the HyperFormula trust and persistence model

**Blocked by:** DATA-001.

- [ ] Define one HyperFormula workbook per notebook and one calculation sheet per sheet block.
- [ ] Define durable formula syntax, locale, function allow-list and version compatibility policy.
- [ ] Decide which values are literals, formula definitions, calculated results and persisted result caches.
- [ ] Define recalculation triggers for UI edits, REST edits, schema changes and notebook loading.
- [ ] Define cross-sheet reference semantics using stable identities despite renamed display labels.
- [ ] Define circular references, errors, volatile functions and unsupported functions as explicit user-visible states.
- [ ] Define whether server-side recalculation is required before results can be trusted outside the browser.
- [ ] Record the decision before implementing formula persistence.

### CALC-002 — Integrate HyperFormula into the sheet block

**Blocked by:** CALC-001, SHEET-002.

- [ ] Add HyperFormula using the approved commercial licence and documented licence configuration.
- [ ] Build the notebook workbook from persisted sheet metadata, literals and formula definitions.
- [ ] Keep Handsontable display coordinates translated to stable row, column and sheet identities.
- [ ] Persist formula definitions separately from displayed calculated values.
- [ ] Recalculate affected dependencies after literal or formula edits.
- [ ] Show formula text, calculated result, error and dependency status clearly.
- [ ] Ensure reloading the notebook reconstructs the same workbook and results.
- [ ] Test arithmetic, ranges, supported scientific functions, errors, blanks and reload.

### CALC-003 — Support cross-sheet formulas and dependency changes

**Blocked by:** CALC-002, SHEET-003.

- [ ] Allow formulas to reference other sheet blocks in the same notebook using approachable display names.
- [ ] Persist stable referenced identities so renaming a sheet does not silently break formulas.
- [ ] Recalculate downstream cells when a source sheet changes through the UI or REST API.
- [ ] Detect and display circular dependencies spanning more than one sheet.
- [ ] Prevent deletion or incompatible schema change without explaining affected formulas.
- [ ] Provide a dependency inspection view suitable for later lineage work.
- [ ] Test rename, reorder, source deletion attempt, cross-sheet error and REST-originated change.

### CALC-004 — Add trustworthy result caching and external reads

**Blocked by:** CALC-003.

- [ ] Store optional calculated-result caches with formula version, input revision and calculation status.
- [ ] Mark caches stale whenever relevant literals, formulas or schemas change.
- [ ] Ensure API consumers can distinguish literal values, formulas, current calculated values and stale or unavailable results.
- [ ] Prevent stale caches from being presented as authoritative current calculations.
- [ ] Define and implement the recalculation worker or controlled recalculation path selected in CALC-001.
- [ ] Record calculation completion or failure as durable events without logging sensitive full datasets.
- [ ] Test current, stale, failed and recalculated states through both UI and REST.

### DATA-004 — Build the approachable API inspector

**Blocked by:** DATA-003, SHEET-003.

- [ ] Add an inspector for a selected sheet showing its API resource, stable identifier and human-facing name.
- [ ] Show fields, PostgreSQL/REST types, units, nullability and validation in language a scientist can follow.
- [ ] Show authenticated request examples for listing, filtering, inserting and updating rows.
- [ ] Distinguish browser-session access from external API-credential access.
- [ ] Provide copy controls that never expose secrets in the page.
- [ ] Link visible grid columns and rows to their API names and stable identities.
- [ ] Explain formula definitions and calculated-result fields without implying cached results are source data.
- [ ] Test examples against the real API contract so documentation cannot drift silently.

### DATA-005 — Add CSV and spreadsheet interchange

**Blocked by:** SHEET-003.

- [ ] Import CSV with encoding, delimiter, header and type-detection preview before writing data.
- [ ] Let the user map incoming columns to existing or new schema fields.
- [ ] Report row-level validation failures without silently discarding data.
- [ ] Make imports transactional or explicitly resumable, with duplicate handling chosen by the user.
- [ ] Export current data and metadata with stable scientific notation and units.
- [ ] Decide the first supported XLSX scope and document unsupported workbook features honestly.
- [ ] Record import/export provenance and actor attribution.
- [ ] Add fixture-based tests for valid, malformed, large, duplicate and partially invalid files.

### DATA-006 — Complete the sheet-and-formula acceptance proof

**Blocked by:** CALC-004, DATA-004, DATA-005.

- [ ] Add two sheet blocks to a Virus Stability notebook.
- [ ] Configure real PostgreSQL columns with identifiers, types, units and validation.
- [ ] Paste or import representative raw data through Handsontable.
- [ ] Add formulas that calculate within one sheet and reference the second sheet.
- [ ] Update a literal through an external API credential and observe the grid and dependent result update live.
- [ ] Rename a display label and confirm stable API and formula identities remain valid.
- [ ] Trigger validation, conflict, circular-reference and stale-calculation states and confirm each is understandable.
- [ ] Automate the stable workflow as database, API and browser acceptance tests.

---

## Phase 5 — A complete scientific notebook workflow

### SCI-001 — Add samples, reagents and protocol record foundations

**Blocked by:** ELN-008.

- [ ] Define minimal configurable schemas for samples, reagents and protocols without baking biotech-specific fields into global infrastructure.
- [ ] Add stable identifiers, project/workspace ownership, statuses, links and audit attribution.
- [ ] Expose safe CRUD and controlled lifecycle operations through REST.
- [ ] Add record pickers and inspector summaries for linking these objects into notebook blocks.
- [ ] Prevent invalid cross-workspace links and preserve references to archived records.
- [ ] Add fixtures and isolation tests using the Virus Stability example.

### SCI-002 — Build protocol and materials notebook blocks

**Blocked by:** SCI-001, ELN-005.

- [ ] Add a protocol-reference block with version and approval status.
- [ ] Add ordered procedure steps with completion, notes and timestamps separated from the reusable protocol definition.
- [ ] Add materials lists linked to sample and reagent records with quantities and units.
- [ ] Preserve the exact protocol version used by an experiment even after the template changes.
- [ ] Surface unavailable, expired or low-stock materials without rewriting historical observations.
- [ ] Add tests for linking, version pinning, step completion and archived materials.

### SCI-003 — Add files and object-storage abstraction

**Blocked by:** ELN-008.

- [ ] Decide and document the initial object-storage service and local-development substitute.
- [ ] Store file metadata, ownership, checksums, media type, size and storage key in PostgreSQL.
- [ ] Upload through authenticated, bounded flows without proxying unbounded files through inappropriate application memory.
- [ ] Validate allowed types and sizes while treating client-provided filenames as untrusted metadata.
- [ ] Link files to records and blocks with provenance and actor attribution.
- [ ] Support download, missing-object, quarantined and deleted states.
- [ ] Add tests for successful upload, oversized file, checksum mismatch, cross-workspace access and missing storage object.

### SCI-004 — Build chart specifications and chart blocks

**Blocked by:** DATA-006, UI-006.

- [ ] Define a saved chart specification referencing stable datasets, fields, filters, transformations and display settings.
- [ ] Support the initial line, scatter and bar charts needed by the mockups before expanding the chart catalogue.
- [ ] Keep statistical overlays and error-bar definitions explicit and reproducible.
- [ ] Render charts inside `ChartFrame` using the approved palette and scientific number formatting.
- [ ] Provide accessible legends, descriptions and tabular alternatives.
- [ ] Distinguish a live chart from a frozen chart included in a submitted revision.
- [ ] Add tests for missing fields, empty datasets, log-scale invalid values and stale calculations.

### SCI-005 — Build the working PlateMap block

**Blocked by:** SCI-001, UI-006.

- [ ] Define plate dimensions, well identity, assignment roles, sample links, replicates, volumes and validation metadata.
- [ ] Support 96-well plates first while keeping the model extensible to approved future formats.
- [ ] Render row and column labels, legend, selection and missing values accessibly.
- [ ] Show the selected well in the shared inspector pattern.
- [ ] Validate duplicate assignments, required controls and volume constraints.
- [ ] Persist plate edits atomically enough to avoid partial layouts.
- [ ] Add tests for keyboard navigation, selection, validation and linked samples.

### SCI-006 — Add reusable notebook and protocol templates

**Blocked by:** SCI-002, DATA-006.

- [ ] Define template identity, type, version, validation status and ownership.
- [ ] Instantiate notebooks and protocols from a fixed template version without sharing mutable content accidentally.
- [ ] Preserve links between created records and their source template version.
- [ ] Support draft, validated, archived and permission-restricted templates.
- [ ] Build the minimal Template Library list, filters, preview inspector and use-template action.
- [ ] Test instantiation, later template edits, archived templates and cross-workspace isolation.

### SCI-007 — Build Experiment Overview from notebook data

**Blocked by:** SCI-002, SCI-003, SCI-004, SCI-005.

- [ ] Compose objective, hypothesis, materials, observations, procedures, tables, charts, plates, files, links and tasks into the approved read-oriented overview.
- [ ] Read from the same notebook blocks and linked records rather than duplicating overview content.
- [ ] Let users choose which blocks appear in the overview while retaining notebook order and provenance.
- [ ] Keep record identity, links, checks, files and comments available in the inspector.
- [ ] Render locked or historical versions without live-edit controls.
- [ ] Add responsive, empty-section and permission-state tests.

### SCI-008 — Add initial scientific search

**Blocked by:** SCI-001, SCI-003, SCI-006.

- [ ] Index record metadata, permitted notebook text, structured fields, file metadata and record relationships.
- [ ] Keep search results filtered by the same workspace and record permissions as direct access.
- [ ] Return typed results with matched context and stable deep links.
- [ ] Add filters for project, type, status, owner and date.
- [ ] Show a result preview in the shared inspector without leaking restricted fields.
- [ ] Define indexing delay and stale-result behaviour honestly.
- [ ] Add tests for permissions, archived records, updated text and mixed result types.

### SCI-009 — Reproduce the Virus Stability notebook end to end

**Blocked by:** SCI-007, SCI-008.

- [ ] Create the concept experiment using ordinary UI and API capabilities rather than special seed-only rendering.
- [ ] Include objective, materials, protocol, procedure progress, scientific sheets, HyperFormula calculations, chart, plate map, files and linked records.
- [ ] Confirm the overview is composed from the underlying notebook record.
- [ ] Confirm search can retrieve the experiment and its permitted linked objects.
- [ ] Confirm every major visible object has an approachable REST representation.
- [ ] Capture a browser acceptance test and a concise demonstration checklist.

---

## Phase 6 — Review, signatures and integrity

### REV-001 — Lock revision and submission semantics

**Blocked by:** SCI-009.

- [ ] Define the exact immutable content included in a submitted revision: metadata, block order, block payloads, linked versions, table snapshots, formulas, calculated state and files.
- [ ] Define what remains live outside a revision, such as later inventory state.
- [ ] Define draft, submitted, changes-requested, approved, rejected and locked transitions.
- [ ] Define which transitions require comments, assigned roles or re-authentication.
- [ ] Define how withdrawn submissions and superseding revisions remain visible in history.
- [ ] Review the model against Review & Approvals, Review Inbox and compliance language in `PRODUCT.md`.

### REV-002 — Create immutable submitted revisions

**Blocked by:** REV-001.

- [ ] Add revision, submission and frozen-content persistence with actor and timestamp attribution.
- [ ] Create a submitted revision transactionally so it cannot mix content from different moments.
- [ ] Store checksums or equivalent integrity evidence for immutable revision content.
- [ ] Prevent ordinary CRUD from modifying submitted evidence.
- [ ] Keep later draft edits separate and clearly identified.
- [ ] Expose revision metadata and frozen content through permission-controlled REST resources.
- [ ] Test submission during concurrent edits, retry, immutability and cross-workspace isolation.

### REV-003 — Build meaningful version diffs

**Blocked by:** REV-002.

- [ ] Compare record metadata, block insertion/removal/order, text, checklist state, links, table cells, formulas and files.
- [ ] Use stable identities so moves are not misreported as delete-and-add when avoidable.
- [ ] Distinguish added, removed and modified values without relying only on colour.
- [ ] Allow reviewers to focus by change type and navigate between changes.
- [ ] Handle large table diffs with summaries and on-demand detail.
- [ ] Preserve scientific notation, units and formula text exactly.
- [ ] Add fixture-based tests for each change type and unchanged content.

### REV-004 — Add anchored comments and resolutions

**Blocked by:** REV-002.

- [ ] Allow comments on a revision, block, table region or specific diff where the target has a stable identity.
- [ ] Store comment author, timestamp, target, thread and resolution state.
- [ ] Prevent later document changes from silently moving a comment to unrelated content.
- [ ] Support replies, mentions, resolution and reopening with appropriate permissions.
- [ ] Deliver comment events through the existing live event channel.
- [ ] Show unavailable targets and deleted users honestly.
- [ ] Add permission, anchoring, live-update and resolution tests.

### REV-005 — Add reviewer checklists and data-integrity checks

**Blocked by:** REV-002, CALC-004.

- [ ] Define configurable reviewer checklist items and required completion rules.
- [ ] Run completeness, schema, formula, stale-result and required-link checks against the frozen revision.
- [ ] Distinguish blocking failures, warnings and informational checks.
- [ ] Store the check definition version, inputs and result with the review evidence.
- [ ] Prevent live data changes from rewriting a historical check result.
- [ ] Allow reviewers to inspect the evidence behind each result.
- [ ] Add tests for pass, warning, failure and changed check definitions.

### REV-006 — Build the review inbox

**Blocked by:** REV-002, UI-004.

- [ ] List assigned and relevant reviews using TanStack Table with status, priority, submitter, dates and current step.
- [ ] Add filters, saved views and selected-review inspector behaviour from the mockup.
- [ ] Keep selection and filters deep-linkable where useful.
- [ ] Provide empty, overdue, withdrawn and permission-changed states.
- [ ] Ensure bulk actions appear only when they are safe and genuinely supported.
- [ ] Add query, keyboard and permission tests.

### REV-007 — Build the Review & Approvals workspace

**Blocked by:** REV-003, REV-004, REV-005, REV-006, UI-007.

- [ ] Present selected versions side by side with navigable text, table and formula diffs.
- [ ] Keep anchored comments and reviewer checklist context visible without obscuring the changed content.
- [ ] Show approval steps, assigned reviewers, integrity checks and revision identity in the inspector.
- [ ] Provide request-changes, reject and approve actions with explicit consequences.
- [ ] Prevent actions against a superseded, withdrawn or already-completed review.
- [ ] Test keyboard navigation, large diffs, stale action attempts and permission loss.

### SIGN-001 — Define and implement initial electronic signatures

**Blocked by:** REV-007.

- [ ] Define the initial signature meaning and assurance level without labelling it compliant by default.
- [ ] Require the signer to review the target revision identity and stated signing meaning.
- [ ] Re-authenticate or otherwise verify current signing intent according to the chosen assurance level.
- [ ] Store signer identity, meaning, timestamp, revision integrity reference and relevant authentication evidence.
- [ ] Make signature evidence immutable and independently readable.
- [ ] Reject signing when required checks, permissions or workflow steps are incomplete.
- [ ] Add tests for valid signing, expired session, changed revision, duplicate action and unauthorised signer.

### SIGN-002 — Lock approved records and expose complete history

**Blocked by:** SIGN-001.

- [ ] Lock the approved revision and prevent ordinary mutation of its scientific evidence.
- [ ] Allow a new draft or amendment only through an explicit, traceable workflow.
- [ ] Show lock state consistently in notebook, overview, API and exports.
- [ ] Build a readable timeline of creation, edits, submissions, comments, checks, signatures and amendments.
- [ ] Ensure audit records cannot be edited through ordinary application or API roles.
- [ ] Export review and signature evidence in a stable machine-readable form.
- [ ] Test attempted mutation, amendment, audit ordering and evidence export.

### REV-008 — Complete the review acceptance proof

**Blocked by:** SIGN-002.

- [ ] Submit the working Virus Stability experiment as a fixed revision.
- [ ] Create a later draft change and verify the submitted version remains unchanged.
- [ ] Review text, table and formula differences.
- [ ] Add and resolve an anchored comment.
- [ ] Run reviewer and calculation checks against the submitted evidence.
- [ ] Approve, sign and lock the revision.
- [ ] Reconstruct the complete history and verify prohibited mutations fail through UI and REST.
- [ ] Automate the stable path as browser, API and database tests.

---

## Phase 7 — Data, analysis and traceability workspaces

### REG-001 — Build the reusable registry composition

**Blocked by:** SCI-001, UI-004.

- [ ] Create the standard registry composition: compact header, summary metrics, filters, saved views, TanStack Table and selected-record inspector.
- [ ] Support server-side pagination, filtering, sorting and grouping without loading entire registries into the browser.
- [ ] Keep columns, density and scientific formatting under Sheetbase control.
- [ ] Add column visibility and saved-view persistence scoped to the user and workspace.
- [ ] Support keyboard row navigation and accessible table headers.
- [ ] Add loading, empty, no-results, partial-data and permission states.
- [ ] Test large result counts and selection persistence across refreshes.

### REG-002 — Deliver Samples Registry

**Blocked by:** REG-001.

- [ ] Implement the concept columns, grouping, status filters and summary metrics using real sample records.
- [ ] Show identity, quantities, units, storage, barcode, chain of custody, linked experiments, files and notes in the inspector.
- [ ] Add create, edit, receive, consume, transfer, archive and restore operations as controlled mutations where multi-record integrity matters.
- [ ] Prevent impossible negative quantities and untraceable location changes.
- [ ] Record custody and quantity events with actor attribution.
- [ ] Add tests for filtering, transfer, consumption, low-stock state and isolation.

### REG-003 — Deliver Reagents Registry

**Blocked by:** REG-001.

- [ ] Implement reagent categories, suppliers, catalogue and lot identity, expiry, quantity, storage and status.
- [ ] Show certificates, documents, usage, linked protocols, supplier details and recent orders in the inspector.
- [ ] Add receive, consume, quarantine and archive workflows with auditable quantity changes.
- [ ] Calculate low-stock and expiry attention from configured thresholds rather than manual badges.
- [ ] Preserve historical supplier and lot details used by experiments.
- [ ] Add tests for receive, consume, expiry, low-stock and quarantine behaviour.

### DATA-007 — Deliver Dataset Explorer

**Blocked by:** REG-001, DATA-006, SCI-004.

- [ ] Add data, schema, relationships and lineage tabs over real scientific-table metadata.
- [ ] Use TanStack Table for paged query and review views and Handsontable only when editing is enabled.
- [ ] Support filters, grouping, sorting, field selection, joins and calculated-column specifications within defined safe limits.
- [ ] Show the selected row, lineage, linked records and transformations in the inspector.
- [ ] Save named views and preserve their query specifications.
- [ ] Show a chart preview built from the same saved specification model as Analysis Studio.
- [ ] Add contract and browser tests for large datasets, invalid transformations and permission-limited joins.

### ANALYSIS-001 — Deliver Analysis Studio

**Blocked by:** DATA-007, SCI-004.

- [ ] Build data-source, chart-type, axis, grouping, normalisation, aggregation and statistical-overlay controls from typed specifications.
- [ ] Recalculate previews without mutating source datasets.
- [ ] Save reproducible analysis views with owner, version and source revisions.
- [ ] Support export with explicit format, dimensions, theme and provenance metadata.
- [ ] Provide the data table that underlies every chart and preserve accessible alternatives.
- [ ] Handle missing columns, stale sources, invalid log values and excessive result size clearly.
- [ ] Test reproducibility by rebuilding a saved chart from its stored specification.

### LINEAGE-001 — Deliver Lineage Explorer

**Blocked by:** ANALYSIS-001, REV-008.

- [ ] Derive graph edges from real record links, dataset transformations, figures, reviews and approvals.
- [ ] Support upstream, downstream and relationship-type filtering.
- [ ] Provide graph, timeline and table representations of the same lineage.
- [ ] Keep selected-node details, transformation history and actions in the inspector.
- [ ] Preserve permission boundaries by hiding or safely redacting inaccessible nodes and edges.
- [ ] Make keyboard and non-visual navigation possible through the table representation.
- [ ] Add tests for cycles, missing records, restricted nodes and large neighbourhoods.

### SEARCH-001 — Deliver Knowledge Search

**Blocked by:** SCI-008, LINEAGE-001.

- [ ] Add typed result tabs, saved queries, recent searches and semantic suggestions only where their provenance is clear.
- [ ] Rank exact identifiers and structured matches predictably before fuzzy suggestions.
- [ ] Show record preview, linked-record summary and safe quick actions in the inspector.
- [ ] Preserve filter and query state in shareable URLs without embedding secrets.
- [ ] Never reveal restricted snippets through counts, suggestions or relationship graphs.
- [ ] Add relevance fixtures and permission-regression tests.

### TPL-001 — Complete Template Library

**Blocked by:** SCI-006, REG-001.

- [ ] Add grid and list views, filters, favourites, validation status and ownership.
- [ ] Show template version, author, usage, linked records, approvals and actions in the inspector.
- [ ] Add duplicate, export and archive actions with permission and dependency checks.
- [ ] Generate preview thumbnails from actual template content rather than unrelated static images.
- [ ] Keep use-template operations pinned to the selected version.
- [ ] Add tests for filters, permissions, archived versions and instantiation.

---

## Phase 8 — Planning and laboratory operations

### OPS-001 — Deliver personal and project dashboards

**Blocked by:** REV-008, SEARCH-001.

- [ ] Build My Work from real assignments, reviews, tasks, recent edits, mentions, deadlines and pinned records.
- [ ] Build Project Dashboard from real experiment, sample, dataset, protocol, milestone and activity summaries.
- [ ] Ensure every metric links to the records that produce it and defines its time boundary.
- [ ] Avoid duplicating source state into dashboard-only tables.
- [ ] Add empty and single-user states that remain useful before collaboration expands.
- [ ] Test metric correctness, permission filtering and time-zone handling.

### OPS-002 — Deliver Freezer & Storage Map

**Blocked by:** REG-002.

- [ ] Model sites, rooms, storage units, shelves, racks, boxes and positions with capacity and environment metadata.
- [ ] Prevent double occupation and impossible moves transactionally.
- [ ] Render occupancy, status and selection using accessible colour-plus-text treatment.
- [ ] Show box contents, environment, chain of custody, movements, links and files in the inspector.
- [ ] Add barcode lookup and controlled sample-move workflows.
- [ ] Test concurrent moves, capacity, quarantine, missing positions and custody history.

### OPS-003 — Deliver Plate Designer

**Blocked by:** SCI-005, REG-002.

- [ ] Add assignment tools, replicate patterns, fill direction, grouping, randomisation and auto-fill.
- [ ] Keep automatic layouts previewable and reversible before saving.
- [ ] Validate controls, replicates, concentrations, volumes and instrument constraints.
- [ ] Show selected-well details, linked records, notes, validation and history in the inspector.
- [ ] Import sample assignments from CSV with mapping and validation preview.
- [ ] Test deterministic randomisation seeds, undo, validation and concurrent edits.

### OPS-004 — Deliver Lab Calendar

**Blocked by:** SCI-001, OPS-001.

- [ ] Model resources, bookings, participants, linked records, required samples and locations with explicit time zones.
- [ ] Build day, week and month views with filtering by team, instrument, project and location.
- [ ] Detect overlapping bookings and resource availability transactionally.
- [ ] Show selected booking details, participants, linked experiment, samples, notes and actions in the inspector.
- [ ] Support create, edit, duplicate and cancel workflows with notifications as a later integration boundary.
- [ ] Test daylight-saving transitions, recurring or duplicated bookings, conflicts and permission changes.

### OPS-005 — Deliver Study Planner

**Blocked by:** OPS-004, OPS-001.

- [ ] Model tasks, workstreams, milestones, dependencies, assignments, resources and deliverables.
- [ ] Provide timeline, calendar, list, workload and resource views over one task model.
- [ ] Detect circular dependencies and resource overbooking.
- [ ] Show selected-task detail, protocol, samples, conflicts and approval requirements in the inspector.
- [ ] Keep timeline edits transactional and accessible through equivalent form controls.
- [ ] Test dependency movement, milestones, conflicts and time-zone boundaries.

### OPS-006 — Deliver Instrument Run Monitor

**Blocked by:** OPS-003, SCI-003.

- [ ] Define an instrument adapter boundary and implement one qPCR demonstration adapter.
- [ ] Model instruments, runs, stages, telemetry, plate snapshots, QC checks, raw files and linked records.
- [ ] Treat incoming instrument data as append-only observations with source timestamps and ingestion status.
- [ ] Show live progress, telemetry, plate state, queue and selected-run inspector from the concept.
- [ ] Handle disconnection, delayed data, duplicate events, failed runs and partial files honestly.
- [ ] Add replayable fixture streams so development and tests do not require a real instrument.
- [ ] Test ingestion idempotency, ordering, failure recovery and workspace isolation.

### OPS-007 — Deliver Report Builder

**Blocked by:** ANALYSIS-001, REV-008, SCI-003.

- [ ] Define ordered report sections that can reference frozen text, tables, charts, files and record metadata.
- [ ] Make section order and source revision explicit and reproducible.
- [ ] Build preview, validation and export flows without silently substituting live data for frozen evidence.
- [ ] Reuse template, review and approval capabilities where appropriate.
- [ ] Record report generation inputs, version, actor and output checksum.
- [ ] Support an accessible HTML or PDF-ready representation and verify rendered output.
- [ ] Test missing sources, stale live references, locked revisions and deterministic regeneration.

### ADMIN-001 — Deliver workspace permissions and administration

**Blocked by:** AUTH-004, SIGN-002.

- [ ] Add invitations and optionally switch registration from open to invitation-only before additional users are onboarded.
- [ ] Build user, role, project access, session and activity views using the shared registry and inspector patterns.
- [ ] Add role and access changes through explicit controlled mutations with self-lockout protection.
- [ ] Expose review workflow, signature policy, audit retention and integration settings without presenting unvalidated compliance claims.
- [ ] Add session revocation and account suspension with immediate enforcement.
- [ ] Export audit information subject to owner permissions and bounded query limits.
- [ ] Test invitation expiry, role changes, removed access, session revocation and last-owner protection.

---

## Phase 9 — Operational hardening and release readiness

### REL-001 — Establish deployment environments and secrets

**Blocked by:** API-007.

- [ ] Define development, test, staging and production configuration boundaries.
- [ ] Store secrets in an appropriate secret manager and keep rotation procedures documented.
- [ ] Build immutable application artifacts and pin service dependencies.
- [ ] Run migrations as an explicit deployment step with failure visibility.
- [ ] Add readiness gates so traffic does not reach incompatible application and database versions.
- [ ] Document environment promotion and rollback decisions.
- [ ] Verify a staging deployment from a clean artifact.

### REL-002 — Add backup, restore and migration rehearsal

**Blocked by:** REL-001, SCI-003.

- [ ] Define backup scope for PostgreSQL, object storage, configuration and encryption material.
- [ ] Automate encrypted backups with retention and failure alerting.
- [ ] Restore into an isolated environment and verify record, file and audit integrity.
- [ ] Rehearse forward migrations on a production-like copy and document rollback or roll-forward procedures.
- [ ] Measure recovery point and recovery time rather than assuming them.
- [ ] Ensure restore testing cannot overwrite active environments.
- [ ] Schedule periodic restore rehearsals before wider use.

### REL-003 — Complete security and threat-model review

**Blocked by:** AUTH-004, API-005, SCI-003, SIGN-002.

- [ ] Threat-model browser sessions, OAuth, API credentials, PostgREST claims, RLS, generated tables, uploads, SSE and signatures.
- [ ] Review cross-workspace isolation with adversarial database and API tests.
- [ ] Review SQL injection risks around generated schemas, filters, joins and RPC parameters.
- [ ] Review CSRF, XSS, open redirects, SSRF, file handling, secret logging and dependency supply chain.
- [ ] Add dependency and secret scanning to the quality pipeline.
- [ ] Resolve high-risk findings or explicitly block release on them.
- [ ] Record accepted residual risks with an owner and review date.

### REL-004 — Establish accessibility acceptance

**Blocked by:** UI-008, ELN-008, DATA-006, REV-008.

- [ ] Run automated accessibility checks across shell, notebook, sheets, review and registry workflows.
- [ ] Manually test keyboard-only operation, focus order, overlays, drag alternatives and error recovery.
- [ ] Test representative screen-reader paths for notebook editing, table navigation, charts and review.
- [ ] Verify 200% zoom, narrow desktop layout, long content and reduced motion.
- [ ] Provide accessible data alternatives for charts, plates, timelines and lineage graphs.
- [ ] Track exceptions with severity, owner and remediation plan; do not silently waive the WCAG 2.2 AA baseline.

### REL-005 — Establish performance and scale acceptance

**Blocked by:** DATA-007, ELN-008.

- [ ] Define representative notebook, table, registry, event and file sizes from intended use rather than tiny fixtures.
- [ ] Measure notebook load, grid interaction, formula recalculation, search, registry query and SSE replay.
- [ ] Keep pagination and virtualisation boundaries explicit so large datasets are not loaded accidentally.
- [ ] Add database query analysis and indexes for measured bottlenecks.
- [ ] Test slow networks, transient disconnection and reconnect behaviour.
- [ ] Set initial budgets and fail repeatable performance tests on material regressions.
- [ ] Document limits the product cannot yet support.

### REL-006 — Establish observability and operational response

**Blocked by:** API-006, REL-001.

- [ ] Collect structured application, PostgREST, database, worker and ingestion diagnostics with correlation identifiers.
- [ ] Add metrics for error rate, latency, authentication failures, SSE connections, event lag, calculation failures and job backlogs.
- [ ] Alert on conditions that require action rather than every transient anomaly.
- [ ] Build diagnostics that can identify a failed request without exposing scientific content or secrets.
- [ ] Document runbooks for unavailable database, failed migration, OAuth outage, event backlog, calculation failure and object-storage outage.
- [ ] Test alert delivery and at least one runbook in staging.

### REL-007 — Complete release acceptance

**Blocked by:** REL-002, REL-003, REL-004, REL-005, REL-006. Before starting, the release owner must also list the exact product tickets included in this release and confirm that each is complete.

- [ ] Provision a fresh staging environment from documented configuration.
- [ ] Apply all migrations and load only approved demonstration data.
- [ ] Run the authentication, API isolation, notebook, sheet/formula and review acceptance proofs selected for the release.
- [ ] Restore a backup and compare critical record, file and audit integrity.
- [ ] Confirm unresolved security, accessibility and data-integrity findings are within the agreed release boundary.
- [ ] Record exact artifact versions, migration state and validation evidence.
- [ ] Produce concise deployment, rollback and operator handoff instructions.

---

## Deferred decisions and explicit non-goals

- [ ] Do not add enterprise SSO until multi-user demand and deployment requirements justify it; GitHub authentication is the initial path.
- [ ] Do not build a universal LIMS or manufacturing execution system inside the notebook model.
- [ ] Do not reduce every structured workflow to Handsontable; use it only where spreadsheet-like editing is the scientist's actual task.
- [ ] Do not store formula results without their formulas, inputs and calculation state.
- [ ] Do not build AI-generated scientific conclusions as an authoritative workflow. Any future AI assistance must be attributable and reviewable.
- [ ] Do not claim 21 CFR Part 11 or other compliance solely because audit, signature or locking features exist.
- [ ] Do not implement all 22 concept screens before the live notebook and scientific-sheet acceptance proofs are complete.

## Current frontier

The first unblocked implementation work is:

1. FND-002 — Document repository working conventions.
2. API-001 — Run PostgreSQL and PostgREST as local services.
3. UI-001 — Reconcile design tokens and fonts can proceed independently once the team is ready to start UI-system productionisation.

The recommended main path is FND-002, FND-003, API-001 and then the remaining Phase 1 tickets in dependency order. UI-001 may run alongside Phase 1, but complete UI screens should wait for authenticated project data and the stable shell.
