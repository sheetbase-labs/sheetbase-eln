# 0054. A booking's subject is the instrument

- **Status:** accepted
- **Date:** 2026-10-11
- **Ticket:** Roadmap 5, R5-CONFIG-06
- **Relates to:** ADR-0037 canonical dataset storage; migration `0366` (LAB-06.3 booking qualification and calibration checks); `0050` (OPS-004 lab calendar); `0051` (OPS-005 study planner)

## Context

Schedule books `api.calendar_resources`; the instrument registry lists
`api.instruments`. The only connection between them is a convention: a resource
"represents" an instrument when its `metadata` carries `instrumentId`.

That convention is optional, and the seeded data does not use it. The single
bookable resource in the demo workspace ("Ambr 250") has `metadata = {}`, while
the registry holds two instruments (`INS-0007` Plate reader PR-01, `INS-0008`
Ambr 250). Four things follow, all observed in the running product:

1. **A registered instrument cannot be booked.** Nothing authors its resource.
2. **A booking is not an instrument identity.** It cannot link to
   `/instruments/$id`, and the instrument inspector's "next booking"
   (R5-CONFIG-02) can never find one.
3. **A safety check silently does not run.** Migration `0366` gates LAB-06.3's
   qualification and calibration guard on `IF v_resource.metadata ? 'instrumentId'`.
   With the key absent, booking "Ambr 250" accepts an unqualified booker and an
   overdue calibration.
4. **The design has one entity.** app-3's Schedule uses the same instrument list
   for its grid and its dialog, with `INS-…` identities, and links each row to
   `/instruments/$instrumentId`. The port split that into two tables and left the
   link optional.

## Decision

1. **An instrument's calendar resource is derived, not authored.** Every
   instrument has exactly one `api.calendar_resources` row whose `id` **is** the
   instrument id, `resource_type = 'instrument'`, and whose name, location and
   active/retired status are kept in step by a trigger on `api.instruments`. The
   row is created with the instrument and retired with it. No screen and no seed
   authors an instrument resource by hand.

2. **A booking's `resource_id` is the instrument id** for instrument bookings.
   A booking therefore identifies its instrument directly: the Schedule grid and
   its day view link to `/instruments/$id`, and the inspector's next booking is a
   plain join rather than a convention.

3. **The instrument rules are unconditional.** `create_booking` applies, for any
   resource of type `instrument`: the instrument must exist in the workspace,
   must not be retired, the booker must hold a current qualification, and the
   latest calibration must not be overdue (`SB115`, `SB116`; a retired
   instrument refuses with the existing inactive-resource code). No metadata key
   gates any of them.

4. **`api.calendar_resources` stays.** The study planner links planned work to
   calendar resources (`api.study_task_resources.calendar_resource_id`, OPS-005),
   and a room or bench is a legitimate future resource. Instruments are one
   _kind_ of resource; their rows are generated rather than entered.

5. **Seeds create instruments, not resources.** The design and month seeds
   register instruments through `create_instrument` and book them by instrument
   id; they never insert an instrument resource directly.

## Consequences

- Registering an instrument makes it bookable immediately; retiring it removes it
  from the booking picker and refuses new bookings while keeping its history.
- A booking's instrument is queryable with `join api.instruments i on i.id = b.resource_id`
  — no `metadata` parsing in any reader.
- Instrument resources cannot drift from the registry: the trigger owns them, and
  a hand-written row for an instrument is overwritten or refused rather than
  trusted.
- `metadata.instrumentId` is retained on generated rows for compatibility with
  anything that still reads it, but nothing depends on it for correctness.
- The generic calendar model keeps its shape: `resource_type`, `capacity`,
  `timezone`, `project_id` and the booking RPC family are unchanged, so the
  planner and any non-instrument resource keep working.
- Migration note: existing bookings are repointed by matching the resource name
  to an instrument in the same workspace. A booking whose resource matches no
  instrument must fail the migration loudly rather than be orphaned or guessed.
