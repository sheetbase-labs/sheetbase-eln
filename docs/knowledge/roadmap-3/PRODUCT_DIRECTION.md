# Roadmap 3 — Product Direction

> **Status note, 2026-09-07:** this document states intended product outcomes, not acceptance evidence. Waves A–C have merged implementation; Wave D remains proposed/deferred. See [task status](tasks/README.md) and [current work](../NEXT.md).

## Purpose

Roadmap 3 deepens Sheetbase as a scientific workspace after Roadmap 2 establishes the canonical product, analysis, API, integration and automation foundations.

> **Mature Sheetbase for its own users. Make interoperability a property of the platform, not the reason for the roadmap.**

Sheetbase should feel increasingly complete to a scientist before it becomes increasingly broad as a platform.

## Product outcome

A scientist should be able to move from scientific context to structured data, analysis, relationships, reusable methods and trustworthy automation without leaving the coherent Notebook / Sheet / Dataset / Record model.

Roadmap 3 should make this proposition materially stronger:

> **Spreadsheet immediacy + scientific structure + context + provenance + reuse + analysis + automation + evidence.**

## Principles

1. **Everyday product depth first.** Navigation, spreadsheet interaction and Notebook authoring should become excellent before AI or extension breadth becomes the centre of attention.
2. **Science is represented explicitly.** Relationships, scientific entities, views and reusable structures should build on canonical Models, Records, Datasets, Sheets and Notebooks rather than side systems.
3. **One platform contract.** Browser, SDK, extensions, integrations, Pipelines and agents should use the same domain operations and identity/version semantics.
4. **Intelligence is embedded, not parallel.** AI should assist canonical workflows and never create a second scientific state model.
5. **Institutional controls are evidence-driven.** Organisation hierarchy and regulated controls should deepen when real deployment needs justify them.
6. **No speculative compatibility.** Sheetbase remains pre-release; superseded development paths should be removed rather than preserved without a current dependency.

## User outcomes by stage

### Product Depth

Scientists navigate confidently, work quickly in Sheets, compose Notebooks naturally and can reliably get back to relevant work.

### Scientific Depth

Scientific objects are connected, understandable and reusable. Users can see relationships and context without flattening science into generic tables.

### Open Platform

Developers can use stable SDK/event/extension surfaces without recreating Sheetbase business logic or shadow models.

### Intelligent Workspace

Assistance is contextual, permission-aware, provenance-aware and capable of safely operating through ordinary Sheetbase contracts.

### Institutionalise

Larger organisations can adopt Sheetbase with appropriate administration, evidence and operational controls without changing the fundamental scientist experience.

## Non-goals

Roadmap 3 is not primarily:

- a collection of vendor integrations;
- a generic AI/chat product;
- a workflow-engine rewrite;
- an organisation-chart project;
- an infrastructure programme detached from user outcomes;
- a second data model for SDKs, extensions or agents;
- a reason to reopen settled Roadmap 1/Core semantics without evidence of a defect.

## Relationship to Roadmap 2

Roadmap 2's active scope has closed and the Roadmap 3 entry condition has been
passed. The dependencies remain:

- Roadmap 2 **API-04/05** establish initial Python/TypeScript SDKs; Roadmap 3 `SDK-01` matures them.
- Roadmap 2 **API-06** establishes webhooks; Roadmap 3 `EVENT-01` matures the event platform.
- Roadmap 2 **AUTO-04/05** establish agent-authored operations and agentic scientific workflows; Roadmap 3 `AUTO-PLUS-01` matures those capabilities.
- GOV-02 remains deferred. ENT-ORG-01 has a proposed organisation ADR; its accepted-decision exit and downstream adoption gates remain outstanding.

Current execution priority is always defined by [`../NEXT.md`](../NEXT.md).
The intended outcomes above must not be read as proof of live model integration,
regulated-use validation or institutional deployment acceptance.
