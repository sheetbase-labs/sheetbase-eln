---
id: subtask-189
title: MOB-01.2 — / renders Today on phones (bookings, needs-you items)
type: subtask
status: done
priority: medium
created: "2026-09-27"
updated: "2026-10-10"
parent: task-187
tags:
  - MOB-01.2
  - MOB
---

# MOB-01.2 — / renders Today on phones (bookings, needs-you items)

Step 2 of 2 in [MOB-01](../../tasks/MOB.md#mob-01--phone-shell); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: implemented. On a phone the Home inspector is a sheet behind a tap, so today's bookings were invisible; src/routes/index.tsx now renders a md:hidden 'Your bookings' section as page content (time, title, location, and a Full schedule link), which is the first thing a bench user needs. In the inbox, a review or signing item now states the constraint instead of silently shrinking: reviewNeedsLargerScreen() marks review_requested and witness_requested, recordLink() names the record page, and the item's Actions render 'Open record' plus 'Reviewing and signing need a larger screen. Open the record here, or continue on a desktop' on phones while the desktop keeps the review surface. Verified in the running app at 390px: 'Your bookings / Full schedule / Nothing scheduled today.' rendered as page content and was absent at 900px. The inbox note is covered by tests/routes/inbox.test.tsx (13 cases); a live check of the note needs an inbox item, which the fixture workspace does not have. The /inbox compact list itself was already present.
