# Dates, people and statuses

Each of these is written one way across the app, through one shared piece.

## Dates and times

Every date or time a person reads goes through `#/lib/format-date`:

| Function                             | Reads as                                           |
| ------------------------------------ | -------------------------------------------------- |
| `formatDate`                         | `25 Sep 2026`, or `25 Sep 2026, 09:40` with `time` |
| `formatDay`                          | `25 Sep`, or `Fri 25 Sep` with `weekday`           |
| `formatMonth`                        | `Sep`, or `Sep 2026` with `year`                   |
| `formatTime`                         | `09:40` on the person's own 12 or 24 hour clock    |
| `formatRange`                        | `25 Sep, 09:00–11:00` or `25 Sep – 2 Oct`          |
| `formatAgo`                          | `just now`, `6m ago`, `3h ago`, `2d ago`, `in 3h`  |
| `formatLongDay`                      | `Friday 25 September`, for headings                |
| `formatWeekday`                      | `Fri`, `Friday`, `Fri 25`                          |
| `formatListDate` (`#/lib/list-date`) | `09:40` today, `Yesterday`, `22 Sep`, `1 Oct 2025` |

They read on the person's display zone. Pass `timeZone` to read on another
(the server passes the zone it was given; a calendar day stored as midnight UTC
passes `'UTC'`), and `zone: true` for audit and signature times so the zone is
named.

`pnpm check:dates` (part of `pnpm check`, and a pre-commit hook) fails on a
date formatted anywhere else: `toLocaleDateString`, `toLocaleTimeString`,
`toLocaleString` with date options, `Intl.DateTimeFormat` with display options,
`formatInstant` called directly, an ISO string sliced for display, or a date
built from `getDate()` and a month list. A machine format that is never shown
(a file name, an export key) takes
`// date-format-ignore-next-line -- <why>` on the line above.

## People

A person is named with `Person` (`#/components/ui/person`): their face, then
their name. When it is the reader, pass their real name and `you`: the face
stays theirs and the name reads "You". A group of people is an `AvatarStack`,
whose faces are ringed so they stay readable where they overlap.

## Statuses

A stored status (`in_review`, `active`) is shown through `statusWord` and
`statusTone` in `#/lib/status-words`, so it reads "In review" beside the right
ring everywhere, never as its key. Kinds with their own lifecycle words
(samples, experiments) keep their own vocabulary; anything else falls back to
the shared one.
