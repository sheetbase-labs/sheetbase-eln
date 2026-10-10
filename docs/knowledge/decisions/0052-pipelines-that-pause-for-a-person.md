# 0052. Pipelines that pause for a person

- **Status:** accepted
- **Date:** 2026-09-27
- **Ticket:** Roadmap 4, PIPE-02 (DEC-08)
- **Amends:** ADR-0046 python and governed ELN pipeline actions

## Context

ADR-0046 makes pipelines autonomous: ordered SQL/Python steps and ELN actions
run in one serialized transaction, and "human confirmations, signatures and
attestations remain human steps; a pipeline cannot fabricate a session or
confirmation". The v3 design adds a run that pauses for a person
(`canvas/PipelineRunWaiting.dc.html`): the run imported rows with units missing
and will not guess them, so it asks a named person to confirm units before
carrying on. The run keeps its pinned input snapshot while it waits, records the
decision under the person's name, and deletes its temporary data afterwards.

The open question is how a run leaves the single-transaction model, and what
happens when nobody answers. The product decision is that the default stays
fully autonomous and that **the pipeline author configures the no-answer
behaviour**, not a global policy.

## Decision

1. **Autonomy is the default.** A pipeline with no human-confirmation step runs
   start to finish without pausing; DEC-08 adds no mandatory pause.
2. **Opt-in confirm step.** A pipeline author may mark a step as requiring a
   person. Only then does the run commit its work so far, record a prompt and
   stop in a new `waiting` status. The pipeline may still propose values; a
   person confirms anything that changes recorded data.
3. **Prompt record.** A `pipeline_run_prompts` row holds the run, the step, the
   form schema, the people asked, the proposal, the answer, who answered and
   when, and the expiry. The pinned inputs and versions are retained for the
   run while it waits.
4. **Resumption is a human session.** The person answers through the canonical
   RPC under their own session and claims. The decision is recorded under their
   name in the affected record's history, with the exact run, step and input
   versions. The run then resumes from the step and re-establishes the original
   actor for the remaining automated steps.
5. **No-answer behaviour is the author's choice, per step.** The author
   configures one of:
   - **stop and re-ask** (default): the run stops without applying the
     proposal, and the next scheduled run asks again;
   - **apply the proposal**: the proposed change is applied and attributed to
     the **pipeline**, never to a person (suitable for non-evidence steps);
   - **fail the run**: the run fails and is reported.
6. **Temporary data is bounded.** Work committed while waiting is temporary and
   is deleted at run end, or after the configured timeout (default 24 h). The
   expiry job applies the author's no-answer behaviour.
7. **Human-only boundary preserved.** A pipeline can never fabricate a session,
   confirmation or signature. Even when the author chooses "apply the
   proposal", no human signature or attestation is produced; the change is
   attributed to the pipeline.

## Consequences

- Runs gain a `waiting` status and a prompt table; the single-transaction model
  applies to each segment between pauses, and resumption runs as the accepting
  person for the confirmed step and the original actor afterwards.
- A fully automatic pipeline is unchanged; the `waiting` machinery is inert
  unless a step opts in.
- The author's no-answer choice is part of the published pipeline version, so a
  run's behaviour is reproducible from the version it cites.
- Temporary data and prompts are deleted at the configured timeout; the
  decision, if made, survives in the record history.

## Alternatives considered

- **Mandatory human step for all pipelines.** Rejected: it removes the autonomy
  ADR-0046 gives.
- **A global no-answer policy.** Rejected by the product owner: the pipeline
  author decides per step, because the right behaviour depends on what the step
  means.
- **Let a pipeline confirm its own recorded change.** Rejected: it would
  fabricate a human confirmation and break ADR-0046's attestation boundary.
