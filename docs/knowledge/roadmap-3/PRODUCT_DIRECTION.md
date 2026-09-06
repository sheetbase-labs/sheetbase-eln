# Roadmap 3 — Product Direction

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

Roadmap 2 must finish before Roadmap 3 becomes the active execution programme.

In particular:

- Roadmap 2 **API-04/05** establish initial Python/TypeScript SDKs; Roadmap 3 `SDK-01` matures them.
- Roadmap 2 **API-06** establishes webhooks; Roadmap 3 `EVENT-01` matures the event platform.
- Roadmap 2 **AUTO-04/05** establish agent-authored operations and agentic scientific workflows; Roadmap 3 `AUTO-PLUS-01` matures those capabilities.
- GOV-02 remains deferred and becomes `ENT-ORG-01` only when organisation modelling is justified and the required ADR is accepted.

Until Roadmap 2 closes, current execution priority remains defined by `../NEXT.md`.
