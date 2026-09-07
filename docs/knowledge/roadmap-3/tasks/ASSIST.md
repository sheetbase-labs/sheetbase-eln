# ASSIST — Embedded Scientific Assistance

**Status (2026-09-07):** ASSIST-01..03 bounded implementation merged on `main` (#156..158). Deterministic explanations, draft/proposal interfaces and guided actions must not be presented as live model-backed assistance; AI-03 remains stub-backed. Real-provider usefulness/grounding and workflow-speed acceptance remain to be demonstrated. See the [reconciled status index](README.md) and [`../../NEXT.md`](../../NEXT.md).

## Programme goal

Embed useful assistance into canonical scientific workflows rather than centring the product on a generic chatbot.

## ASSIST-01 — Contextual Help & Explain

### Goal

Provide grounded assistance that explains the current Sheetbase object/workflow.

### Scope

- explain fields, validation failures, provenance, versions and workflow state;
- cite relevant Sheetbase objects/docs where possible;
- context-specific entry points in Notebook, Sheet, Dataset, Record and analysis surfaces;
- no direct mutation.

### Exit

Users can ask for explanations in-context and receive grounded, permission-safe answers linked to the underlying Sheetbase state.

## ASSIST-02 — Drafting & Transformation Assistance

### Goal

Help users draft scientific narrative/configuration without bypassing canonical review/validation.

### Scope

- draft Notebook text/summaries;
- suggest structured transformations or field mappings;
- propose chart/analysis configuration;
- preview changes before commit;
- clearly mark generated suggestions.

### Exit

Assistance can produce useful drafts/proposals that users can inspect and accept through ordinary Sheetbase operations, with no hidden state mutation.

## ASSIST-03 — Guided Scientific Workflows

### Goal

Provide step-aware assistance across multi-object workflows.

### Scope

- understand current task/object context;
- surface next supported actions and missing prerequisites;
- use canonical APIs/tools for any executed action;
- permission/provenance/audit behaviour identical to manual operations;
- evaluate representative workflows.

### Exit

Users can complete selected scientific workflows faster with embedded guidance while every executed change remains an ordinary canonical Sheetbase operation.

## Boundaries

- Assistance is not authoritative scientific judgement.
- No invisible writes or model-specific permission bypass.
- Human review/signature boundaries remain unchanged.
