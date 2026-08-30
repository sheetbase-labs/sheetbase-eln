# 0004. A personal workspace for every sign-up

- **Status:** accepted
- **Date:** 2026-07-18
- **Ticket:** AUTH-002

## Context

While registration is open (single-user phase), each new GitHub sign-up
needs somewhere to work. Later phases add invitations and multi-user
workspaces; the bootstrap choice made now must not fight that future.

## Decision

- Every successful sign-up creates a personal workspace plus an owner
  membership in one transaction, via a Better Auth `user.create.after`
  database hook.
- Bootstrap is idempotent (`bootstrapWorkspaceForUser`): repeat OAuth
  callbacks, retries and the manual recovery action converge to one
  workspace and one membership per user. Uniqueness constraints, not hope,
  provide the guarantee.
- A signed-in user with no workspace (bootstrap hook failed mid-sign-up is
  impossible — the hook rolls user creation back on failure — but a removed
  membership or legacy row can produce it) lands on a recoverable bootstrap
  screen that reruns the same function.
- Membership stays a general model: workspace + user + role. Invitations
  later add members to existing workspaces without changing bootstrap.

## Consequences

- Sign-up and workspace creation are atomic: no user without an attempted
  workspace, no orphaned workspace.
- "Owner" is per-workspace, so the multi-user future needs no remodel — only
  an invitation path and an owner-transfer rule.
- Slugs derive from the user id (`ws-<userId>`), so they are stable across
  retries and never collide between users.
