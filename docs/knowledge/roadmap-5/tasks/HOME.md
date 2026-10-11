# Home

One gap: the home screen has no quiet state. Planned at `10a84a42`,
11 October 2026. Read [GUIDE.md](../GUIDE.md) and
[FINDINGS.md](../FINDINGS.md) section 8.

## R5-HOME-01: a quiet home says what is next

**Outcome:** a workspace with nothing waiting on the person reads as a calm,
useful page instead of empty panels. Priority P2, effort M, low risk. No
prerequisite.

**Current state and scope:** `src/routes/index.tsx` is review, recents and
first-run oriented (`:553` awaiting review, `:477`/`:618` continue working,
`:690` your projects, `:854` recent activity, `:107` first-run steps). The
design's quiet home adds an all-clear banner ("Nothing is waiting on you"), a
"Coming up next 2 weeks" list, "Pick something up", per-project approval
progress bars, and a Today / Start something / Team activity inspector. Scope:
the home screen's quiet and near-quiet states, over data the ELN already serves
(work items, bookings, approvals, favourites). Do not add a second work-item
query if `api.my_work_items` or the shell counts already answer it.

**Steps:**

1. Define the quiet condition precisely (no assigned work items, nothing due,
   no unread notifications) from the existing counts, and confirm it against a
   real empty workspace rather than a fixture.
2. Add the all-clear banner and the "Coming up" list from real schedule and
   approval data, each entry stating why it is there and linking to its object.
3. Add per-project approval progress from the project's own record counts, and
   "Pick something up" from the person's projects and recent work.
4. Fix the inspector contract while there: the design distinguishes
   Today / Start something / Team activity; the ELN's inspector must show
   something useful (or nothing) in each state and must not render an empty
   panel.

**Verification/exit:** component tests for the quiet state, the near-quiet state
(one item due) and the busy state, using real read models; a browser check at
phone width that the banner, list and inspector do not overflow and remain
keyboard reachable; `pnpm validate`. The quiet state must be reachable by a real
workspace, not only by mocking empty data.
