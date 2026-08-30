---
title: Searching Sheetbase Knowledge with qmd
status: canonical
last_reviewed: 2026-08-30
---

# Searching Sheetbase Knowledge with qmd

Sheetbase includes a project-local qmd configuration at [`.qmd/index.yml`](../../../.qmd/index.yml) for searching `docs/knowledge/**/*.md`.

qmd is optional: agents must still be able to work by reading files directly. When available, use it to discover relevant knowledge before opening the authoritative documents in full.

## Why qmd

qmd provides local Markdown search with:

- fast BM25 keyword search;
- optional vector semantic search;
- hybrid search with reranking;
- structured JSON/file output for agents;
- an MCP server for clients that support MCP.

The index remains local; it is a retrieval aid, not a new source of truth.

## Install

Requires Node 22+ (already consistent with Sheetbase's development baseline).

```bash
npm install -g @tobilu/qmd
```

Or use qmd through another supported installation method.

## First-time project setup

Run qmd from the repository root. qmd trust-gates project-local configuration, so review and approve the committed configuration first:

```bash
qmd trust
qmd update
```

The committed `.qmd/index.yml` defines one collection:

```text
sheetbase-knowledge
  path: docs/knowledge
  pattern: **/*.md
```

It also supplies context for Roadmaps 1–3, decisions, product, architecture, history, concepts and references so results are easier for agents to interpret.

After substantial knowledge-base changes, refresh the index:

```bash
qmd update
```

For semantic/hybrid search, generate/update embeddings:

```bash
qmd embed
```

BM25 search does not require embeddings.

For unattended CI/agent environments, use qmd's documented trust mechanism rather than disabling or bypassing project trust casually.

## Recommended agent workflow

### 1. Start with keyword search

Use BM25 first because it is fast and deterministic:

```bash
qmd search -c sheetbase-knowledge "Sheet write-back provenance"
qmd search -c sheetbase-knowledge "API-04 Python SDK"
qmd search -c sheetbase-knowledge "retired scientific tables"
```

For structured output:

```bash
qmd search -c sheetbase-knowledge --json -n 10 "Dataset Version evidence"
```

### 2. Use hybrid search when wording is uncertain

If the relevant concept may be described with different terminology:

```bash
qmd query -c sheetbase-knowledge "how are exploratory columns promoted into governed schema?"
```

Hybrid search uses semantic retrieval and reranking and therefore requires qmd's local models/embeddings.

### 3. Retrieve the full documents

Search results are discovery, not evidence. After finding candidate files, read the complete relevant source:

```bash
qmd get "qmd://sheetbase-knowledge/architecture/sheets.md" --full
qmd get "qmd://sheetbase-knowledge/decisions/0020-sheet-definitions-instances-and-template-reuse.md" --full
```

For multiple related documents:

```bash
qmd multi-get "qmd://sheetbase-knowledge/roadmap-2/tasks/*.md"
```

Do not make architectural or review judgements from snippets alone.

## Search patterns for PR reviews

A useful review search normally includes several independent queries rather than one broad query:

```bash
qmd search -c sheetbase-knowledge "<task-id>"
qmd search -c sheetbase-knowledge "<canonical concept being changed>"
qmd search -c sheetbase-knowledge "retired <related old concept>"
qmd search -c sheetbase-knowledge "<permission/evidence/versioning concern>"
```

Then open the current roadmap task, relevant ADRs, architecture document and any retired-approach entry in full.

## Search patterns for proposals

Before proposing a new feature, search for:

```text
user problem
canonical concept
similar historical concept
existing roadmap item
rejected/retired approach
relevant competitor lesson
```

This helps avoid creating a second product concept for something Sheetbase already represents.

## MCP use

qmd exposes an MCP server:

```bash
qmd mcp
```

Agents/editors that support MCP can connect to it and use qmd's query/get/multi-get tools directly. Scope searches to the `sheetbase-knowledge` collection when other qmd collections are configured on the same machine.

## Authority rules

qmd ranking does **not** determine authority.

When results conflict, use the knowledge-base precedence rules:

1. executable server contract / accepted ADR;
2. current canonical product/design/roadmap/subsystem contract;
3. cross-cutting synthesis;
4. historical conversation, concept, mockup, competitor or superseded planning material.

A highly ranked historical document must not override a later canonical decision.

## When qmd is unavailable

Do not block work. Use the same workflow with repository search/file reads:

- start at `docs/knowledge/README.md`;
- inspect the relevant roadmap/task;
- search filenames/text for affected concepts;
- read candidate documents in full.

qmd improves discovery; it does not replace repository literacy.
