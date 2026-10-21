# 0056. Pipeline execution: sandbox login, run queue, signed manifest

- **Status:** accepted
- **Date:** 2026-10-21
- **Tickets:** AUTO-02 (hardening)
- **Update:** supersedes the session-role sandbox and inline execution described in [ADR-0042](0042-deterministic-pipelines.md).

## Context

A review of the pipelines subsystem found three weaknesses behind an otherwise
well-reasoned design.

1. ADR-0042 treats the static SQL filter as defence in depth and the
   `pipeline_worker` role as the boundary. The role was not a boundary: the
   execution connection logged in as a PostgreSQL superuser and entered the role
   with `SET LOCAL ROLE`, which the same session can undo
   (`set_config('role', 'none', false)`), after which `query_to_xml` reads any
   table. The regex denylist was the real boundary, and a quoted schema name
   passes it.
2. Manual runs executed inline in a browser request, and scheduled and event
   runs in an in-process `setInterval` sweep. A closed tab, a restart or a second
   replica left a run hanging or running twice.
3. A run left no tamper-evident record of what it consumed and produced.

## Decision

1. **Transform SQL runs on its own connection as `pipeline_sandbox`**, a login
   role with no grants and no role memberships, so there is nothing to reset to.
   The orchestration connection keeps the run's authority and never executes
   untrusted SQL. Inputs reach the sandbox by value. The static filter stays for
   authoring feedback. `REVOKE EXECUTE` on the XML and introspection functions was
   considered and rejected: those functions are granted to `PUBLIC` in
   `pg_catalog`, the migration role cannot revoke them, and with no grants they
   read nothing. A real SQL parser was likewise unnecessary once the role is the
   boundary.
2. **Runs are jobs in a Postgres queue** (`internal.pipeline_run_jobs`), inserted
   by a trigger in the transaction that starts the run and claimed by workers with
   `FOR UPDATE SKIP LOCKED` under a heartbeat lease. Requests, the webhook and the
   sweep only enqueue. Postgres is already the system of record and gives
   enqueue-with-the-run atomicity that an external broker cannot.
3. **Runs in one workspace execute one at a time.** Concurrent output phases
   deadlock on the workspace row (display-id assignment), so a workspace
   advisory lock serialises them and the queue defers the loser.
4. **A succeeded run writes an immutable, signed, hash-chained manifest** in the
   transaction that completes it. Ed25519 was chosen over an HMAC so an auditor
   verifies with a public key and the file alone.

## Consequences

- A deployment must provision the `pipeline_sandbox` login and set
  `PIPELINE_SANDBOX_DATABASE_URL`; without it SQL steps fail closed.
- Run status is unchanged: a queued run is `running` until a worker finishes it.
  The queue state is read separately.
- Throughput within one workspace is bounded to one run at a time. Lifting that
  needs the output phase's workspace row lock removed first.
- Manifests exist only for succeeded runs and do not capture side effects.
- The orchestration connection is still the application role (a superuser in the
  shipped compose files). Moving it to a least-privilege role is separate work.
