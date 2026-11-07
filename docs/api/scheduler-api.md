# Scheduler API

The lab scheduler places the parts of a multi-part experiment onto instruments
and people. It respects the working day, absences, each instrument's booking
rules (longest booking, furthest ahead, training), service status and the wait
between parts (an incubation). It proposes bookings; nothing is booked until
a person accepts the proposal.

## Say what each part needs

```
POST /api/db/rpc/set_part_plan
{ "p_part_id": "…", "p_hands_on_minutes": 60, "p_wait_after_minutes": 1440,
  "p_needs": [ { "resourceId": "<instrument id>", "minutes": 45 } ] }
```

`hands_on_minutes` is time a person is at the bench; `wait_after_minutes` is how
long to wait after the part before the next can start. `needs` replaces the part's
earlier list; each is an instrument and how many minutes it is used. Read them from
`part_plans` and `part_resource_needs`.

## Working hours

`set_scheduler_settings` (Settings, General): the time zone, `p_work_start_minute`
and `p_work_end_minute` (minutes after midnight, 540 is 09:00) and `p_work_days`
(ISO weekdays, 1 is Monday). Read from `scheduler_settings`. The default is
09:00 to 17:00, Monday to Friday, UTC.

## Ask for a plan

```
POST /api/db/rpc/request_schedule_proposal    { "p_record_id": "<experiment id>" }
```

Returns a proposal in `requested`. The planner picks it up within seconds, so
read it again until `status` is `proposed` (or `failed` with `error_message`).
`items` has one entry per slot:

```
{ "partId": "…", "partNumber": 2, "partTitle": "Read", "kind": "instrument" | "hands_on",
  "resourceId": "…", "resourceName": "Plate reader", "assigneeUserId": "…",
  "startsAt": "2026-11-10T09:30:00Z", "endsAt": "2026-11-10T10:15:00Z",
  "plannedOn": "2026-11-10",
  "conflicts": [ { "code": "not_qualified", "message": "…" } ] }
```

Conflict codes: `no_slot`, `no_working_day`, `max_booking_exceeded`,
`too_far_ahead`, `out_of_service`, `not_qualified` and `later_than_planned` (a
note, not a blocker). `conflict_count` counts the blockers. Earlier open proposals
for the experiment become `superseded`.

## Accept, dismiss, re-plan

```
POST /api/db/rpc/accept_schedule_proposal   { "p_proposal_id": "…" }
POST /api/db/rpc/dismiss_schedule_proposal  { "p_proposal_id": "…" }
POST /api/db/rpc/slip_experiment_part       { "p_part_id": "…", "p_days": 2 }
```

Accepting books each instrument slot as the person accepting (the booking rules
apply again then), cancels the bookings of an earlier accepted plan, and moves
each part to the day planned. It returns `{ proposalId, booked, skipped }`: a slot
that cannot be booked is listed in `skipped` with the reason, never hidden.
`slip_experiment_part` moves the part and the ones after it later and asks for a
new proposal (`reason: "slip"`).

Events: `schedule.proposed`, `schedule.accepted`, `schedule.dismissed`. In the
assistant: **Plan schedule** (`sheetbase.schedule.plan`) and **Accept and book**
(`sheetbase.schedule.accept`) cards. A pipeline step can ask for a plan with the
**Request a schedule** action (`request_schedule_proposal`).

In the app: the **Schedule** section of an experiment's Summary (when it has
parts), the **Schedule** week on each instrument, and **Working hours** in
Settings, General.
