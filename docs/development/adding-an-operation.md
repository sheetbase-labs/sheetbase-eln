# Adding an operation, or a block

Two things are declared once and everything else is generated from them: an
**operation** (something the lab can do) and a **block** (a notebook block
type).

## Operations

Declare the operation in `src/lib/operations/declarations/` (a new file per area
is fine; add it to `CORE_OPERATIONS` in `registry.ts`). One declaration gives:

| Surface          | What is generated                                                                                      | Where it is read                            |
| ---------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| Public API       | token allowlist entry, OpenAPI path, docs/api row, Python and TypeScript SDK methods (through OpenAPI) | `lab-api-surface.ts` (`LAB_RPCS`)           |
| MCP              | the action on `sheetbase.lab.act`, with the same agent permission as any lab action                    | `mcp/lab.ts`                                |
| Assistant        | the tool name, as a confirm card for a write or an answer for a read                                   | `agent-tool-catalogue.ts`                   |
| Agent vocabulary | the draft tools the gateway and workflows allow (`vocabulary: 'operation'`)                            | `AGENT_OPERATION_TOOL_NAMES`                |
| Pipelines        | the pipeline action, arguments typed from the inputs                                                   | `pipelines/actions.ts` (`PIPELINE_ACTIONS`) |
| Webhooks and SSE | the catalogue entry for each event the operation produces                                              | `event-catalogue.ts`                        |

```ts
{
  name: 'rename_freezer',            // also the SQL function name
  label: 'Rename a freezer',
  summary: 'Rename a freezer',       // setting a summary puts it on the API
  description: 'Gives a freezer a new name. Returns the freezer.',
  kind: 'write',                     // 'read' answers, 'write' shows a card
  inputs: [
    input('p_freezer_id', 'uuid'),
    input('p_name', 'text'),
    input('p_note', 'text', false, true), // optional, may be null
  ],
  result: 'row:storage_locations',
  assistant: { tool: 'sheetbase.freezer.rename' },
  pipeline: {},                       // offer it as a pipeline action
  events: [{ name: 'freezer.renamed', family: 'storage', summary: '…', producer: { entityType: 'storage_location', operation: 'update' } }],
}
```

What a declaration does **not** generate:

1. **The SQL function** (a timestamp-named migration, `pnpm db:new`). The
   integration guard test fails if an `api.*` function is neither declared nor
   listed in `integration-exemptions.ts`.
2. **The assistant resolver**, when the card needs its own lookup or wording.
   The tool name is listed for you; the resolver and card are code, as before.
3. **The docs prose.** `operationDocStub(op)` prints a section to paste into
   the right `docs/api` page; the guard test fails if `lab-api.md` does not
   mention a declared operation.

Run `pnpm openapi:generate` and commit what it changes (OpenAPI and the Python
SDK). The operation tests check that every declared event is in the catalogue
and every API entry is on the allowlist.

Operations declared with `api: 'elsewhere'` have their API entry written by
hand in the core API contracts. Most pipeline-only operations are like this
today; give one a `summary` to move its API entry onto the declaration.

### Extensions

An extension adds operations at runtime with
`registerOperations(source, operations, workspaceId)` and removes them with
`unregisterOperations`. Anything that must include them reads the lists through
functions (`pipelineActions(workspaceId)`, `assistantProposeToolNames`,
`agentOperationToolNames`, `listOperations`), not the frozen constants, which
are the built-in snapshot. A registration that reuses a built-in name or tool is
refused.

## Blocks

Declare the block in `src/lib/blocks/declarations.ts`: its type, whether the
editor handles it (`editable`), starting payload, summary, validator and, when
the `+` and `/` menus offer it, a `picker` entry. The `BlockType` union, the
allow-list, the insert catalogue and `validateBlock` are derived from the list.

You still write three things by hand: the validator in
`src/lib/blocks/validators.ts`, the editor and preview bodies in the notebook
components, and a migration widening `chk_blocks_type`. The registry parity
test checks the declarations against the latest widening migration.
