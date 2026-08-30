# Prompt — EVENT

Work only on the assigned EVENT task in `tasks/EVENT.md` after Roadmap 2 API-06 is complete and root `NEXT.md` activates it. Read the initial webhook implementation, Pipeline/event-trigger model, public API contracts and audit/event semantics first.

Use one canonical domain-event vocabulary across webhooks and automation where practical. Events are not audit/evidence authority. Preserve stable IDs, workspace isolation, replay/idempotency and fail-closed delivery behaviour.

Meet the assigned exit criterion with delivery/replay/failure and consumer-isolation tests. Do not start the next EVENT task implicitly.