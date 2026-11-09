# Feature folders

Each area of the lab registers what it adds to the integration surfaces in a
folder of its own, `src/features/<name>/`. Nothing outside the folder needs an
edit, so two features built at the same time do not touch the same file and do
not conflict.

Shared lists used to be the cause. The event catalogue, the operation registry,
the API tables, the assistant's card list and button words, the agent action
groups and the SDKs' event lists were each one file that every feature added to.
Parallel builds collided on all of them. Those lists now read a generated index
of the feature folders instead.

## The folder

```
src/features/<name>/
  feature.ts            export const feature = defineFeature({...})
  operations.ts         defineOperations([...])     (optional; any file name)
  api-tables.ts         token-readable tables        (optional; any file name)
  assistant.ts          export const assistant = defineAssistant<Action, Tool>()({...})
  assistant.server.ts   export const assistantServer = defineAssistantServer({...})
  copy.ts               export const copy = {...}   read as t('features.<name>.…')
```

Only `feature.ts` is required. `scripts/generate-features.mjs` writes the
indexes that gather the folders (`src/features/*.gen.ts`). The indexes are
git-ignored like the route tree. `pnpm generate`, typecheck, the test layers,
the dev server and the build all write them first, so a new folder shows up
without any other step.

### `feature.ts`

```ts
export const feature = defineFeature({
  name: 'freezers', // the folder name
  operations: FREEZER_OPERATIONS, // API, SDK, MCP, pipeline actions, assistant names, their events
  events: [...], // catalogue events not declared on an operation
  eventLabels: { 'freezer.renamed': 'A freezer is renamed' },
  labTables: FREEZER_TABLES, // tables tokens may read (lab:read)
  notExposed: { freezer_secret: 'Why tokens may not reach it.' },
  agentArea: { area: 'Freezers', match: /freezer/ },
  agentMayDelete: ['delete_freezer_shelf'], // a delete agents may do behind a confirmation
  assistantReadTools: ['sheetbase.freezers.read'],
})
```

`feature.ts` is loaded everywhere, including the browser and the build
scripts. Keep it to declarations: operations, tables and events, never code
with side effects. Give an event with no core family
`consumers: WEBHOOK_SSE_PIPELINE` to let pipelines start on it.

`agentArea` puts the feature's actions in a group of their own on the agent
permissions page. It is tried after the built-in groups. Set `beforeCore: true`
when its keys would otherwise land in one of them.

### `assistant.ts` and `assistant.server.ts`

The browser half says which card actions are the feature's, runs one when the
person presses the button (load the code lazily), and names the copy key that
holds each card's `apply`, `applying` and `applied` words. The server half
offers the model its read tools and proposal tools and answers them. Both
plug into the assistant's dispatch, the card union types and the card's
words. See `src/features/notebook/` for a feature with read tools and cards.

### SQL

A feature's migration adds rows to the shared registries instead of rewriting
a shared function:

| What                                 | Registry                                       |
| ------------------------------------ | ---------------------------------------------- |
| Webhook event names                  | `INSERT INTO internal.webhook_event_names`     |
| Steward reporting views              | `SELECT internal.register_reporting_view(...)` |
| Pipeline trigger events              | `INSERT INTO internal.pipeline_trigger_events` |
| Pipeline actions the database checks | `INSERT INTO internal.pipeline_actions`        |
| Deletes agents may do                | `INSERT INTO internal.agent_allowed_deletes`   |

### Docs

Document the feature's tables and actions in a page of its own under
`docs/api/`. The guard tests look for every name in any page there.

## Tests

`src/features/features.test.ts` checks that every folder is in the indexes,
that its operations reach the registry, and that every card's words are in the
copy catalogue. The surface tests (operations, event catalogue, integration
coverage, SDK vocabulary) cover feature entries the same way as built-in ones.
Tests derive their totals from the collected entries, so no count needs
updating.
