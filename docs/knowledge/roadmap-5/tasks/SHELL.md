# Shell, search and platform

Six cross-cutting affordances. Planned at `10a84a42`, 11 October 2026. Read
[GUIDE.md](../GUIDE.md) and [FINDINGS.md](../FINDINGS.md) section 10. These touch
every route, so they are sequenced last and two of them need a decision first.

## R5-SHELL-01: every product route gets the adopted shell

**Outcome:** one shell everywhere — the icon rail at 1024–1279 and bottom tabs
below 768 on every product route, not only on the v3 allow-list. Priority P2,
effort M, low risk. No prerequisite.

**Current state and scope:** `src/routes/__root.tsx:243-249` selects the shell by
route id; anything outside the list gets the legacy shell, which has no icon rail
and no bottom tabs. Affected product routes include `/projects/$projectId/files`;
the rest are internal reference routes (`/docs/$name`, `/foundations`,
`/r/$identifier`, `/sheetbase-components`) that may stay as they are. Scope: move
the affected product routes onto the v3 shell, or record why each stays.

**Steps:**

1. Enumerate the routes outside the allow-list from source and classify each:
   product route, internal reference, or retired. Do not guess from the old
   retirement lists — inspect live consumers.
2. Migrate the product routes onto the v3 shell, one at a time, keeping each
   route's existing tests green and its header/tabs intact.
3. Record the internal reference routes and their reason for staying, so the
   next audit does not re-open them.
4. Once migrated, consider deriving shell selection from a route-tree convention
   rather than a hand-maintained list — only if it removes the list without
   ambiguity.

**Verification/exit:** a component test per migrated route asserting the v3
shell wrapper, plus one browser check at 1024 and 390 widths that the rail and
bottom tabs are present; `pnpm validate`. No route may lose its navigation or
its inspector slot in the move.

## R5-SHELL-02: the theme is applied at first paint

**Outcome:** the server-rendered HTML carries the correct theme, so the first
paint matches the person's choice. Priority P1, effort S, medium risk. No
prerequisite.

**Current state and scope:** the inline no-flash script exists, but the
preference is stored in `localStorage` (`sheetbase-theme`), which the server
cannot read, so the server always emits the light default and the class is
corrected on the client. The design uses a `sb-theme` cookie. Scope: move the
preference to a cookie the server can read, keep the client switch working, and
keep theme changes per device.

**Steps:**

1. Read the preference server-side (cookie) and emit the correct class in the
   root document; keep the inline script as the fallback for the system setting.
2. Keep writing the choice from the theme switch, and keep the system option
   meaning "follow the device".
3. Handle the signed-in case: the interface offers a per-device choice; do not
   silently overwrite a person's stored preference with a server default.

**Verification/exit:** a server-render test that the class matches the cookie,
including dark, system and absent; a browser check that switching theme does not
flash; `pnpm validate`. Confirm the CSP permits the inline script as currently
configured.

## R5-SHELL-03: capability flags have real keys and honest gap states

> **Outcome (implemented).** The mechanism is kept — registry, allow-list,
> roadmap map, route-context plumbing and `CapabilityGap` — but **no key is
> registered and nothing is gated**. The two keys this spec anticipated
> (`sampleMeasurements`, `experimentResults`) name shipped features, and gating
> them off by default made the product claim "not in this release yet" about
> features that are in this release while hiding two working surfaces from every
> fresh deployment. A flag is for a capability a deployment _does not have_;
> switching a shipped surface off is a preference and needs its own mechanism.
> `capabilityKeys` is therefore empty, with the parser and the key↔roadmap
> invariant still tested.

**Outcome:** an operator can state which optional capabilities this deployment
has, and the UI says so honestly where one is absent. Priority P1, effort M,
medium risk. No prerequisite.

**Current state and scope:** `src/lib/capabilities.ts:16` has
`capabilityKeys = []` and `:28` an empty `capabilityRoadmap`; the ported
`CapabilityGap` component has one live usage site
(`src/routes/settings/diagnostics.tsx:536`). The design demonstrates 11 gaps,
most of which are now genuinely built in the ELN — so the honest answer may be a
short list, not eleven. Scope: the key vocabulary, the deployment input, the
roadmap map for administrators, and the screens that should branch on a flag.

**Steps:**

1. List the capabilities that are genuinely optional per deployment, and record
   why each one is a flag rather than a feature. Anything that is simply not
   built yet uses the same component with an empty (never fake) alternative.
2. Give each key a name, a default (off), an environment input
   (`SHEETBASE_CAPABILITIES` already exists) and an entry in the roadmap map so
   an administrator sees what tracks it.
3. Use the flags where the interface does — for example a measurements or
   results surface whose capability is off — and keep counts and actions hidden
   while the entry stays visible.
4. Keep the distinction the component already documents: gap for "not in this
   deployment", empty state for "no data", danger banner for failure, denied
   notice for permission.

**Verification/exit:** unit tests for the allow-list parser and the default-off
baseline; component tests that a disabled flag renders the gap with at least one
real alternative link and no fake data; `pnpm validate`. The flag must never
gate a permission — RLS stays authoritative.

## R5-SHELL-04: search and pickers carry their designed scope and suggestions

**Outcome:** search can include archived work, suggests a corrected identifier,
and filters with the shared filter menu; the record picker offers recents.
Priority P2, effort M, medium risk. Depends on the SRCH-02 follow-on.

**Current state and scope:** `src/components/v3/search/search-palette.tsx` has
no archived scope or "Did you mean {id}?" suggestion; there is no shared
`FilterMenu` (lists use chips/checkboxes); the record picker's Recent group is
unbuilt and says so (`src/components/v3/record-picker/record-picker.tsx:14-19`),
and its items carry no project subtitle. Scope: search scope and suggestion,
the shared filter affordance, and picker recents.

**Steps:**

1. Add the archived scope through the canonical search boundary (a scope
   argument), never by filtering results in the browser, and label it clearly.
2. Add identifier suggestion using the existing resolver
   (`src/lib/identifier-resolution.ts`) so a mistyped ID offers a correction
   with its type.
3. Add the shared filter menu where a list already has filters, one screen at a
   time, keeping the chip path working.
4. Build picker recents from a real per-person record of recently used records —
   or keep the honest "Nothing recent" copy and record the deferral. Do not
   fabricate recents from a page of results.

**Verification/exit:** API/DB tests that the archived scope returns only
archived objects within permission; component tests for the suggestion and the
picker states; `pnpm validate`. A suggestion must never resolve to an object the
person cannot see.

## R5-SHELL-05: sign-in covers its designed states, or records why not

**Outcome:** the sign-in screen either supports the states the design shows
(password fallback, lockout, session expiry at signing) or states plainly which
of them the product does not offer. Priority P2, effort M, high risk. Depends on
an authentication decision.

**Current state and scope:** `src/routes/sign-in.tsx:96-155` is GitHub-only: no
email/password form, no attempts-left or lockout copy, no workspace line, and
the design's `password`/`sso-only` states render nothing. Scope: the sign-in
surface and its states — not a new identity provider.

**Decision required first:** whether the product offers any password or step-up
re-authentication path at all. REV-03 step-up already exists for signing; if
that is the only such path, this task is copy and state work, not a credential
store.

**Steps:**

1. Record the decision: which sign-in methods are supported, and what happens
   when a session expires mid-signing.
2. Implement the states that the decision allows — expired signing session,
   lockout, signed out — with copy that says what the person can do next.
3. Add the deployment/workspace line if the product has one; do not invent an
   organisation the deployment does not have.
4. Where a designed state is deliberately absent, record it in
   [FINDINGS.md](../FINDINGS.md) rather than rendering a dead form.

**Verification/exit:** component tests for each reachable state and for the
expired-signing return path; a test that a locked-out person cannot bypass the
lock through a direct URL; `pnpm validate`.

## R5-SHELL-06: pipeline code and artefact state are presented

**Outcome:** pipeline steps, code and artefact lifetime are readable rather than
dumped. Priority P3, effort S, low risk. No prerequisite.

**Current state and scope:** `src/routes/pipelines/$pipelineId/index.tsx:145`
renders plain `<pre><code>`; there is no "temporary artefact" marker, and steps
are a separate route rather than a `?step=n` parameter. Scope: presentation of
existing data.

**Steps:**

1. Render code with syntax highlighting using an existing dependency if one is
   already in the tree; otherwise record the deferral rather than adding a
   highlighter for its own sake.
2. Mark artefacts whose store is temporary, with the retention rule stated where
   the person can act on it.
3. Decide whether step navigation should be a parameter or stay a route. Keep
   whichever is already linkable; do not change it for cosmetic symmetry.

**Verification/exit:** component tests for the code block (empty, long,
non-UTF8-safe content), the artefact marker, and step navigation; `pnpm validate`.
Highlighting must not execute or interpret the code — it is text.
