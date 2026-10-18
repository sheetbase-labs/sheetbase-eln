# Fix brief for journey-fix streams

Work in your own worktree (branch off GWP/instrument-parser-journey). Read the
journey file for your stream first, then each cited code location before editing.

Setup (no pnpm — private packages can't install here):
  ln -s /home/user/workspace/repo/node_modules node_modules
  use node_modules/.bin/{tsc,vitest,eslint,prettier} directly.
  tsc will show unrelated prosemirror / sheetbase-components errors; ignore those, fix any in files you touch.

Rules
- Close the journey end to end: the user starts at the warning/empty state/disabled control and can finish the task using existing screens plus what you add. Prefer deep links with context, state-aware copy, naming the person who can act, and wiring up data-layer writes that exist but have no UI.
- General use matters, not only warnings: if tracing a journey shows the plain happy path is missing a control, add it.
- Re-verify each journey claim in code before fixing; if a claim is wrong, say so and skip.
- Reuse existing components/tokens (src/components/v3/ui). Match surrounding style. Follow .agent/design/design.md for copy and layout. British English.
- No migrations and no edits to package.json / lockfile / pnpm-workspace.yaml. If a fix needs a backend change, don't hack around it: record it under "Needs backend" in your report.
- Each fix gets a behavioural test through the public UI/data interface where a plausible regression would be missed; extend existing test files. Run the affected vitest files plus eslint and prettier --write on files you changed.
- Commit with /usr/bin/git (no trailers, no attribution), one commit per journey or tight group, message `fix(<area>): ...`. Do not push.
- Update the Verdict line of each journey you close in its journey file (`fixed in <short sha>`).
- Final report: journeys fixed / skipped (why) / needs backend, the branch name, test results.
