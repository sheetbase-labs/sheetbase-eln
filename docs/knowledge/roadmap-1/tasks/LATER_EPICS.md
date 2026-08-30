# Later Automation Epics

**Status:** Intentionally not implementation-ready.

All Core Data Workspace epics (CORE-01 through CORE-06) now have dedicated granular task files in this directory. This file is retained only for the later automation programme.

---

## AUTO-01 — Pipeline Foundation

### Goal

Introduce versioned typed transformations only after Model/Dataset/Sheet semantics are stable.

### Required outcomes

- Pipeline Definition separate from Pipeline Run;
- shared typed parameters and schema expectations;
- immutable/pinned inputs where required;
- versioned implementation reference;
- configured transform implementation first where useful;
- SQL/Python execution boundary;
- immutable run status/log/provenance;
- Dataset outputs and Dataset Versions;
- draft/publish/run permissions;
- retries/idempotency/side-effect semantics explicitly designed;
- reuse materialisation/provenance concepts rather than create a parallel output model.

### Do not

Start with a visual DAG editor. Do not turn Analysis Studio into a separate Pipeline engine. Do not allow arbitrary privileged SQL through the public API.

### Exit gate

A versioned transformation consumes pinned input Dataset Versions and reproducibly produces a traceable output Dataset/version.

---

## AUTO-02 — Agent-authored Operations

### Goal

Allow AI to propose useful transformations/configuration through normal Sheetbase contracts.

### Required outcomes

- natural-language intent becomes a structured proposed plan;
- plan validated against schemas and capabilities;
- user-visible diff/impact;
- agent-authored schema/Pipeline changes begin as drafts;
- approval policy before consequential writes where required;
- execution uses ordinary mutation/Pipeline interfaces;
- provenance records agent/model/tool context appropriate to reconstruction;
- no secret agent-only database path.

### Preferred interaction pattern

```text
intent
  -> structured plan
  -> permission/schema validation
  -> user-visible impact
  -> approval
  -> normal execution
  -> recorded evidence
```

### Exit gate

An agent can propose a useful data transformation, a user can inspect/approve it, and execution produces the same core evidence as a human-authored Pipeline.
