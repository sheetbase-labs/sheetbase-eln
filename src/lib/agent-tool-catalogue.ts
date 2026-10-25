/**
 * AUTO-PLUS-01 — Bounded catalogue of agent-callable canonical operations.
 *
 * Agents discover and invoke a documented set of canonical Sheetbase
 * operations without private database access or UI automation. Every entry
 * documents the operation a normal client would call; the catalogue never
 * reimplements it:
 *
 * - Draft/mutate operation tools execute only through `propose_agent_operation`
 *   (AUTO-04), which runs the same canonical RPC a human client calls under
 *   the same workspace, capability, RLS, revision, and policy checks. The
 *   `permission` and `scopes` fields below *assert* the checks the server
 *   performs — the server remains the enforcer, this module duplicates no
 *   authorization logic.
 * - Read tools are the ordinary canonical read RPCs; they stay outside the
 *   proposal model, exactly as for normal clients.
 * - Human-only attestation (approve/decide, execute-as-human, resume,
 *   submit/sign/amend/checks) is listed in `UNAVAILABLE_AGENT_OPERATIONS`
 *   with reasons — explicitly unavailable, not merely absent.
 *
 * Catalogue invariants:
 *
 * 1. No private DB access: every mutation path goes through a canonical RPC.
 * 2. No UI automation: discovery is `listAgentTools`/`describeAgentTool`.
 * 3. No agent attestation: nothing here can sign, approve, or execute on
 *    behalf of a human.
 * 4. Same capabilities as normal clients: identical workspace/permission
 *    checks, enforced server-side.
 *
 * Single authority: `AGENT_OPERATION_TOOL_NAMES` is the one allowlist backing
 * both `AGENT_WORKFLOW_TOOLS` (agent-workflows.ts) and `GATEWAY_TOOLS`
 * (ai-gateway.ts). Those modules re-export it; the drift test in
 * `agent-tool-catalogue.test.ts` pins the agreement.
 */

import { z } from 'zod'

import type { Scope } from './api-credential-scopes'
import type { AgentOperationKind } from './agent-operations'
import { parameterUuidSchema } from './parameter'

/** Operation tools: the executable vocabulary shared with workflows/gateway. */
export const AGENT_OPERATION_TOOL_NAMES = [
  'sheetbase.dataset_schema.draft',
  'sheetbase.sheet_definition.draft',
  'sheetbase.sheet_definition.update_draft',
  'sheetbase.pipeline_definition.draft',
  'sheetbase.pipeline_definition.version_draft',
  'sheetbase.pipeline_definition.update_draft',
  'sheetbase.dataset_rows.commit',
] as const

export type AgentOperationToolName = (typeof AGENT_OPERATION_TOOL_NAMES)[number]

/**
 * Operation tools exposed only through MCP. They are deliberately kept out of
 * `AGENT_OPERATION_TOOL_NAMES`, so the in-app gateway and workflow vocabulary
 * cannot request them. The MCP handler lists the full catalogue.
 */
export const MCP_ONLY_OPERATION_TOOL_NAMES = [
  'sheetbase.notebook_block.insert',
  'sheetbase.record.create',
  'sheetbase.record.custom_fields.update',
  'sheetbase.sheet_instance.create',
  'sheetbase.template.instantiate',
  'sheetbase.workspace_ai_settings.update',
] as const

export type McpOnlyOperationToolName =
  (typeof MCP_ONLY_OPERATION_TOOL_NAMES)[number]

/** read: no state change. draft: proposes a durable operation, never applies it. mutate: changes durable state. */
export type AgentToolMode = 'read' | 'draft' | 'mutate'

export interface AgentToolError {
  /** Existing server error code (SB-code, SQLSTATE, or scope denial). */
  code: string
  meaning: string
}

export interface AgentToolCapability {
  /**
   * Credential scopes the caller must hold. The server checks these on the
   * canonical RPC; the catalogue only documents them for discovery filtering.
   */
  scopes: Scope[]
  /** Canonical permission the server asserts (member capability or policy gate). */
  permission: string
  /** Which actor check the server performs. */
  actor: 'workspace_write_actor' | 'workspace_actor'
  note: string
}

export interface AgentToolEntry {
  name: string
  mode: AgentToolMode
  description: string
  /** Operation kind, for draft/mutate operation tools. */
  operationKind?: AgentOperationKind
  /** Canonical RPC that performs the work (via propose for operation tools). */
  rpc: string
  /** Invocation path: the RPC agents actually call. */
  via: string
  capability: AgentToolCapability
  /** Zod input contract mirroring the server-side validation. */
  inputSchema: z.ZodType
  /** Errors the server can return for this tool (existing vocabulary). */
  errors: AgentToolError[]
}

export interface UnavailableOperation {
  name: string
  reason: string
}

const uuid = parameterUuidSchema
const workspaceId = uuid.describe(
  'Workspace UUID; must match the bearer token workspace.',
)
const key = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,59}$/)
  .describe('Definition key, unique per workspace.')
const name = z.string().min(1).max(200)
const description = z.string().max(2000).nullish()
const revision = z
  .number()
  .int()
  .positive()
  .describe('Optimistic-concurrency revision.')

const provenanceSchema = z
  .object({
    agentId: z.string().min(1).max(200),
    agentName: z.string().max(200).nullish(),
    tool: z.object({
      name: z.string().min(1).max(200),
      version: z.string().max(100).nullish(),
    }),
    model: z.object({
      provider: z.string().min(1).max(100),
      name: z.string().min(1).max(200),
      version: z.string().max(100).nullish(),
    }),
    invocationId: z.string().min(1).max(200),
  })
  .strict()
  .describe(
    'Required agent/tool/model/invocation attribution (AUTO-04 provenance).',
  )

/**
 * Shared error rows. Codes already exist server-side (0148 propose/decide/
 * execute, 0150 policy, 0152 workflows); the catalogue assigns the per-tool
 * subset, it does not invent codes.
 */
const ERR_WORKSPACE_ACTOR: AgentToolError = {
  code: '42501',
  meaning:
    'Caller is not a write actor of the target workspace, or lacks the required scope.',
}
const ERR_INVALID: AgentToolError = {
  code: '22023',
  meaning:
    'Input failed contract validation (shape, key format, length, lifecycle, or tool/operation mismatch).',
}
const ERR_STALE: AgentToolError = {
  code: 'SB001',
  meaning:
    'Optimistic-concurrency mismatch: proposal, target, or definition revision moved since preview.',
}
const ERR_IDEMPOTENCY_MISMATCH: AgentToolError = {
  code: '23505',
  meaning:
    'Idempotency key was already used for different content by the same actor.',
}
const ERR_ROW_VALIDATION: AgentToolError = {
  code: 'SB073',
  meaning: 'Canonical Dataset row batch validation rejected the rows.',
}
const ERR_ANCHOR: AgentToolError = {
  code: '23503',
  meaning:
    'afterBlockId is not a block in the target record, or the target record is not in the workspace.',
}
const ERR_DRAFT_UNAVAILABLE: AgentToolError = {
  code: '42501',
  meaning:
    'Target draft version is missing, outside the workspace, or no longer a draft.',
}
const ERR_BUDGET_EXHAUSTED: AgentToolError = {
  code: 'budget_exhausted',
  meaning:
    'Reported usage exceeded the durable token or cost budget; the workflow stops.',
}
const ERR_TERMINAL_STATE: AgentToolError = {
  code: 'SB001',
  meaning:
    'Workflow already reached a terminal state (succeeded, cancelled, budget_exhausted).',
}

/** Configuration payloads are validated in depth by the canonical validators
 * (`validate_sheet_definition_configuration`, `pipeline_config_errors`);
 * the catalogue asserts presence and defers to them. */
const opaqueConfiguration = z
  .record(z.string(), z.unknown())
  .describe('Canonical configuration; validated in depth by the owning RPC.')

const datasetSchemaFields = z
  .array(z.record(z.string(), z.unknown()))
  .max(200)
  .describe('Schema field inputs (DatasetSchemaFieldInput[]).')

const datasetCommitRows = z
  .array(z.record(z.string(), z.unknown()))
  .min(1)
  .max(1000)
  .describe(
    'Dataset commit rows (DatasetCommitRow[]); updates stay human_required.',
  )

function operationEntry(entry: AgentToolEntry): AgentToolEntry {
  return entry
}

const OPERATION_TOOLS: AgentToolEntry[] = [
  operationEntry({
    name: 'sheetbase.dataset_schema.draft',
    mode: 'draft',
    description:
      'Draft a Dataset Schema definition via proposal. Safe draft: auto-executes only with schema:write, otherwise waits for human approval.',
    operationKind: 'dataset_schema.create',
    rpc: 'create_dataset_schema_definition',
    via: 'propose_agent_operation',
    capability: {
      scopes: ['agent_operations:write'],
      permission: 'schema.edit',
      actor: 'workspace_write_actor',
      note: 'Proposing needs agent_operations:write. Automatic execution additionally requires schema:write; the server checks both.',
    },
    inputSchema: z
      .object({
        kind: z.literal('dataset_schema.create'),
        workspaceId,
        key,
        name,
        description,
        fields: datasetSchemaFields,
      })
      .strict(),
    errors: [ERR_WORKSPACE_ACTOR, ERR_INVALID, ERR_IDEMPOTENCY_MISMATCH],
  }),
  operationEntry({
    name: 'sheetbase.sheet_definition.draft',
    mode: 'draft',
    description:
      'Draft a Sheet Definition via proposal. Safe draft: auto-executes only with schema:write, otherwise waits for human approval.',
    operationKind: 'sheet_definition.create',
    rpc: 'create_sheet_definition',
    via: 'propose_agent_operation',
    capability: {
      scopes: ['agent_operations:write'],
      permission: 'schema.edit',
      actor: 'workspace_write_actor',
      note: 'Proposing needs agent_operations:write. Automatic execution additionally requires schema:write; the server checks both.',
    },
    inputSchema: z
      .object({
        kind: z.literal('sheet_definition.create'),
        workspaceId,
        key,
        name,
        description,
        configuration: opaqueConfiguration,
      })
      .strict(),
    errors: [ERR_WORKSPACE_ACTOR, ERR_INVALID, ERR_IDEMPOTENCY_MISMATCH],
  }),
  operationEntry({
    name: 'sheetbase.sheet_definition.update_draft',
    mode: 'draft',
    description:
      'Update an existing Sheet Definition draft version via proposal. The target must still be a draft in the same workspace.',
    operationKind: 'sheet_definition.update_draft',
    rpc: 'update_sheet_definition_draft',
    via: 'propose_agent_operation',
    capability: {
      scopes: ['agent_operations:write'],
      permission: 'schema.edit',
      actor: 'workspace_write_actor',
      note: 'Proposing needs agent_operations:write. Automatic execution additionally requires schema:write; the server checks both.',
    },
    inputSchema: z
      .object({
        kind: z.literal('sheet_definition.update_draft'),
        versionId: uuid,
        expectedRevision: revision,
        configuration: opaqueConfiguration,
      })
      .strict(),
    errors: [
      ERR_WORKSPACE_ACTOR,
      ERR_DRAFT_UNAVAILABLE,
      ERR_STALE,
      ERR_INVALID,
      ERR_IDEMPOTENCY_MISMATCH,
    ],
  }),
  operationEntry({
    name: 'sheetbase.pipeline_definition.draft',
    mode: 'draft',
    description:
      'Draft a Pipeline Definition via proposal. Creates the definition shell; versions are drafted separately.',
    operationKind: 'pipeline_definition.create',
    rpc: 'create_pipeline_definition',
    via: 'propose_agent_operation',
    capability: {
      scopes: ['agent_operations:write'],
      permission: 'pipelines.manage',
      actor: 'workspace_write_actor',
      note: 'Server asserts the pipelines.manage capability; proposing needs agent_operations:write.',
    },
    inputSchema: z
      .object({
        kind: z.literal('pipeline_definition.create'),
        workspaceId,
        key,
        name,
        description,
      })
      .strict(),
    errors: [ERR_WORKSPACE_ACTOR, ERR_INVALID, ERR_IDEMPOTENCY_MISMATCH],
  }),
  operationEntry({
    name: 'sheetbase.pipeline_definition.version_draft',
    mode: 'draft',
    description:
      'Draft a new version of an active Pipeline Definition via proposal. The definition revision is pinned optimistically.',
    operationKind: 'pipeline_definition.create_version',
    rpc: 'create_pipeline_definition_version',
    via: 'propose_agent_operation',
    capability: {
      scopes: ['agent_operations:write'],
      permission: 'pipelines.manage',
      actor: 'workspace_write_actor',
      note: 'Server asserts the pipelines.manage capability; proposing needs agent_operations:write.',
    },
    inputSchema: z
      .object({
        kind: z.literal('pipeline_definition.create_version'),
        workspaceId,
        definitionId: uuid,
        expectedDefinitionRevision: revision,
        configuration: opaqueConfiguration,
      })
      .strict(),
    errors: [
      ERR_WORKSPACE_ACTOR,
      ERR_STALE,
      ERR_INVALID,
      ERR_IDEMPOTENCY_MISMATCH,
    ],
  }),
  operationEntry({
    name: 'sheetbase.pipeline_definition.update_draft',
    mode: 'draft',
    description:
      'Update an existing Pipeline Definition draft version via proposal. The target version must still be a draft.',
    operationKind: 'pipeline_definition.update_draft',
    rpc: 'update_pipeline_definition_version_draft',
    via: 'propose_agent_operation',
    capability: {
      scopes: ['agent_operations:write'],
      permission: 'pipelines.manage',
      actor: 'workspace_write_actor',
      note: 'Server asserts the pipelines.manage capability; proposing needs agent_operations:write.',
    },
    inputSchema: z
      .object({
        kind: z.literal('pipeline_definition.update_draft'),
        workspaceId,
        versionId: uuid,
        expectedRevision: revision,
        configuration: opaqueConfiguration,
      })
      .strict(),
    errors: [
      ERR_WORKSPACE_ACTOR,
      ERR_DRAFT_UNAVAILABLE,
      ERR_STALE,
      ERR_INVALID,
      ERR_IDEMPOTENCY_MISMATCH,
    ],
  }),
  operationEntry({
    name: 'sheetbase.dataset_rows.commit',
    mode: 'mutate',
    description:
      'Commit Dataset rows via proposal. Consequential write: runs immediately only under a matching delegation policy plus datasets:write (create/append only); updates always need human approval.',
    operationKind: 'dataset_rows.commit',
    rpc: 'commit_dataset_row_batch',
    via: 'propose_agent_operation',
    capability: {
      scopes: ['agent_operations:write'],
      permission: 'record.create',
      actor: 'workspace_write_actor',
      note: 'Proposing needs agent_operations:write. Delegated execution additionally requires datasets:write plus a matching enabled policy; the server checks all three.',
    },
    inputSchema: z
      .object({
        kind: z.literal('dataset_rows.commit'),
        datasetId: uuid,
        expectedRevision: revision,
        rows: datasetCommitRows,
      })
      .strict(),
    errors: [
      ERR_WORKSPACE_ACTOR,
      ERR_ROW_VALIDATION,
      ERR_STALE,
      ERR_INVALID,
      ERR_IDEMPOTENCY_MISMATCH,
    ],
  }),
  operationEntry({
    name: 'sheetbase.notebook_block.insert',
    mode: 'draft',
    description:
      'Insert one block into a Notebook record via proposal. Consequential content write: always requires human approval. Use the record’s current structureVersion as expectedRevision.',
    operationKind: 'notebook_block.insert',
    rpc: 'insert_block',
    via: 'propose_agent_operation',
    capability: {
      scopes: ['agent_operations:write'],
      permission: 'record.create',
      actor: 'workspace_write_actor',
      note: 'Proposing needs agent_operations:write; MCP additionally requires projects:write. The server checks record.create and the record structure revision.',
    },
    inputSchema: z
      .object({
        kind: z.literal('notebook_block.insert'),
        recordId: uuid.describe('Notebook record UUID.'),
        afterBlockId: uuid
          .nullish()
          .describe('Block to insert after; omit or null to append.'),
        block: z
          .object({
            type: z.string().min(1).max(48),
            payload: z.record(z.string(), z.unknown()),
            payloadSchemaVersion: z.number().int().min(1).optional(),
          })
          .strict(),
        expectedRevision: revision.describe(
          'The record structureVersion the proposal was built against.',
        ),
      })
      .strict(),
    errors: [
      ERR_WORKSPACE_ACTOR,
      ERR_INVALID,
      ERR_ANCHOR,
      ERR_STALE,
      ERR_IDEMPOTENCY_MISMATCH,
    ],
  }),
  operationEntry({
    name: 'sheetbase.record.create',
    mode: 'draft',
    description:
      'Create one record in a project via proposal. Consequential content write: always requires human approval. Use a workspace project for experiments, samples and materials; protocol templates may be workspace-scoped.',
    operationKind: 'record.create',
    rpc: 'create_record',
    via: 'propose_agent_operation',
    capability: {
      scopes: ['agent_operations:write'],
      permission: 'record.create',
      actor: 'workspace_write_actor',
      note: 'Proposing needs agent_operations:write; MCP additionally requires projects:write. The server checks record.create and project/workspace membership.',
    },
    inputSchema: z
      .object({
        kind: z.literal('record.create'),
        workspaceId,
        projectId: uuid
          .nullish()
          .describe('Workspace project; null only for a protocol template.'),
        recordKind: z.string().min(1).max(48),
        title: z.string().min(1).max(200),
        status: z.string().min(1).max(32).optional(),
        tags: z.array(z.string().min(1).max(40)).max(20).optional(),
        properties: z.record(z.string(), z.unknown()).optional(),
      })
      .strict(),
    errors: [ERR_WORKSPACE_ACTOR, ERR_INVALID, ERR_IDEMPOTENCY_MISMATCH],
  }),
  operationEntry({
    name: 'sheetbase.record.custom_fields.update',
    mode: 'draft',
    description:
      'Update one record’s custom fields via proposal. Consequential content write: always requires human approval and the current metadata version.',
    operationKind: 'record.custom_fields.update',
    rpc: 'update_record_custom_fields',
    via: 'propose_agent_operation',
    capability: {
      scopes: ['agent_operations:write'],
      permission: 'record.create',
      actor: 'workspace_write_actor',
      note: 'Proposing needs agent_operations:write; MCP additionally requires models:write. The server checks the metadata revision and record lock/archive state.',
    },
    inputSchema: z
      .object({
        kind: z.literal('record.custom_fields.update'),
        recordId: uuid,
        expectedMetadataVersion: revision.describe(
          'The record metadata version the proposal was built against.',
        ),
        values: z.record(z.string(), z.unknown()),
      })
      .strict(),
    errors: [
      ERR_WORKSPACE_ACTOR,
      ERR_INVALID,
      ERR_STALE,
      ERR_IDEMPOTENCY_MISMATCH,
    ],
  }),
  operationEntry({
    name: 'sheetbase.sheet_instance.create',
    mode: 'draft',
    description:
      'Create one Sheet Instance from a published Definition Version via proposal. Consequential content write: always requires human approval.',
    operationKind: 'sheet_instance.create',
    rpc: 'create_sheet_instance_from_definition',
    via: 'propose_agent_operation',
    capability: {
      scopes: ['agent_operations:write'],
      permission: 'record.create',
      actor: 'workspace_write_actor',
      note: 'Proposing needs agent_operations:write; MCP additionally requires sheets:write. The published Definition Version and every source must be readable and in the workspace.',
    },
    inputSchema: z
      .object({
        kind: z.literal('sheet_instance.create'),
        workspaceId,
        name: z.string().min(1).max(200),
        description: z.string().max(2_000).nullish(),
        sourceDefinitionVersionId: uuid,
        projectId: uuid.nullish(),
        notebookRecordId: uuid.nullish(),
        state: z.record(z.string(), z.unknown()),
        parameterInputs: z.record(z.string(), z.unknown()).optional(),
      })
      .strict(),
    errors: [ERR_WORKSPACE_ACTOR, ERR_INVALID, ERR_IDEMPOTENCY_MISMATCH],
  }),
  operationEntry({
    name: 'sheetbase.template.instantiate',
    mode: 'draft',
    description:
      'Instantiate one active protocol template into a project via proposal. Consequential content write: always requires human approval. Legacy notebook template records use their version RPC and are not offered here.',
    operationKind: 'template.instantiate',
    rpc: 'instantiate_template',
    via: 'propose_agent_operation',
    capability: {
      scopes: ['agent_operations:write'],
      permission: 'record.create',
      actor: 'workspace_write_actor',
      note: 'Proposing needs agent_operations:write; MCP additionally requires projects:write. The template must be an active protocol template in the workspace.',
    },
    inputSchema: z
      .object({
        kind: z.literal('template.instantiate'),
        templateRecordId: uuid,
        targetProjectId: uuid,
        targetKind: z.enum(['experiment', 'protocol_template']),
        title: z.string().max(200).nullish(),
      })
      .strict(),
    errors: [ERR_WORKSPACE_ACTOR, ERR_INVALID, ERR_IDEMPOTENCY_MISMATCH],
  }),
  {
    name: 'sheetbase.workspace_ai_settings.update',
    mode: 'draft',
    description:
      'Propose a workspace AI settings change (enablement, provider profile, model role, cloud-egress consent and per-call limits). Always requires owner approval; never executes automatically.',
    operationKind: 'workspace_ai_settings.update',
    rpc: 'update_workspace_ai_settings',
    via: 'propose_agent_operation',
    capability: {
      scopes: ['agent_operations:write', 'admin:write'],
      permission: 'workspace.admin',
      actor: 'workspace_write_actor',
      note: 'Personal owner token only. The proposal is always human_required; approval and execution re-check the owner capability in a human session.',
    },
    inputSchema: z
      .object({
        kind: z.literal('workspace_ai_settings.update'),
        workspaceId,
        enabled: z.boolean(),
        providerProfile: z.string().min(1).max(80).nullish(),
        model: z.enum(['sheetbase-assist-1', 'sheetbase-summarise-1']),
        cloudEgressEnabled: z.boolean(),
        maxTokensPerCall: z.number().int().min(1).max(100_000),
        maxCostMicrousdPerCall: z.number().int().min(0).max(10_000_000),
      })
      .strict(),
    errors: [ERR_WORKSPACE_ACTOR, ERR_INVALID],
  },
]

const LIFECYCLE_TOOLS: AgentToolEntry[] = [
  {
    name: 'sheetbase.agent.propose',
    mode: 'draft',
    description:
      'Propose one canonical operation with provenance. Validates, previews, evaluates policy, and may auto-execute safe drafts.',
    rpc: 'propose_agent_operation',
    via: 'propose_agent_operation',
    capability: {
      scopes: ['agent_operations:write'],
      permission: 'workspace write actor',
      actor: 'workspace_write_actor',
      note: 'Server requires the workspace write actor; credentials additionally need agent_operations:write.',
    },
    inputSchema: z
      .object({
        workspaceId,
        title: z.string().min(1).max(200),
        summary: z.string().min(1).max(2000),
        operation: z.record(z.string(), z.unknown()),
        provenance: provenanceSchema,
        idempotencyKey: z.string().min(1).max(128),
      })
      .strict(),
    errors: [
      ERR_WORKSPACE_ACTOR,
      ERR_INVALID,
      ERR_IDEMPOTENCY_MISMATCH,
      ERR_ROW_VALIDATION,
    ],
  },
  {
    name: 'sheetbase.agent.workflow_create',
    mode: 'draft',
    description:
      'Create a bounded 2–20 step sequential workflow plan and propose its first pinned operation.',
    rpc: 'create_agent_workflow',
    via: 'create_agent_workflow',
    capability: {
      scopes: ['agent_operations:write'],
      permission: 'workspace write actor',
      actor: 'workspace_write_actor',
      note: 'Server requires the workspace write actor; credentials additionally need agent_operations:write.',
    },
    inputSchema: z
      .object({
        workspaceId,
        goal: z.string().min(1).max(2000),
        plan: z.record(z.string(), z.unknown()),
        budget: z.record(z.string(), z.unknown()),
        initialUsage: z.record(z.string(), z.unknown()),
        provenance: provenanceSchema,
        idempotencyKey: z.string().min(1).max(128),
      })
      .strict(),
    errors: [ERR_WORKSPACE_ACTOR, ERR_INVALID, ERR_IDEMPOTENCY_MISMATCH],
  },
  {
    name: 'sheetbase.agent.workflow_advance',
    mode: 'draft',
    description:
      'Observe the current proposal at the expected revision and move to the next pinned step. Never approves or executes.',
    rpc: 'advance_agent_workflow',
    via: 'advance_agent_workflow',
    capability: {
      scopes: ['agent_operations:write'],
      permission: 'workspace write actor',
      actor: 'workspace_write_actor',
      note: 'Observation only: rejection, failure, or cancellation pauses the workflow for a human.',
    },
    inputSchema: z
      .object({ workflowId: uuid, expectedRevision: revision })
      .strict(),
    errors: [ERR_WORKSPACE_ACTOR, ERR_STALE, ERR_TERMINAL_STATE],
  },
  {
    name: 'sheetbase.agent.workflow_report_usage',
    mode: 'mutate',
    description:
      'Report incremental token/cost usage. Overrunning a durable budget stops the workflow and cancels the pending proposal.',
    rpc: 'report_agent_workflow_usage',
    via: 'report_agent_workflow_usage',
    capability: {
      scopes: ['agent_operations:write'],
      permission: 'workspace write actor',
      actor: 'workspace_write_actor',
      note: 'Positive increments only; at least one of tokens/cost must be greater than zero.',
    },
    inputSchema: z
      .object({
        workflowId: uuid,
        expectedRevision: revision,
        tokens: z.number().int().min(0),
        costMicrousd: z.number().int().min(0),
      })
      .strict(),
    errors: [ERR_WORKSPACE_ACTOR, ERR_INVALID, ERR_STALE, ERR_BUDGET_EXHAUSTED],
  },
  {
    name: 'sheetbase.agent.workflow_cancel',
    mode: 'mutate',
    description:
      'Cancel remaining steps and a pending/approved current proposal with a reason. Completed workflows fail closed.',
    rpc: 'cancel_agent_workflow',
    via: 'cancel_agent_workflow',
    capability: {
      scopes: ['agent_operations:write'],
      permission: 'workspace write actor or owner writer',
      actor: 'workspace_write_actor',
      note: 'Credentials or a workspace writer may cancel; completed and already-cancelled workflows fail closed.',
    },
    inputSchema: z
      .object({
        workflowId: uuid,
        expectedRevision: revision,
        reason: z.string().min(1).max(1000),
      })
      .strict(),
    errors: [ERR_WORKSPACE_ACTOR, ERR_INVALID, ERR_STALE, ERR_TERMINAL_STATE],
  },
]

const READ_TOOLS: AgentToolEntry[] = [
  {
    name: 'sheetbase.dataset_rows.query',
    mode: 'read',
    description:
      'Query live Dataset rows with bounded windows. Read-only grounding for agents; outside the proposal model.',
    rpc: 'query_dataset_rows',
    via: 'query_dataset_rows',
    capability: {
      scopes: ['datasets:read'],
      permission: 'dataset read',
      actor: 'workspace_actor',
      note: 'Ordinary canonical read; same RLS as normal clients.',
    },
    inputSchema: z
      .object({
        datasetId: uuid,
        limit: z.number().int().min(1).max(1000).nullish(),
        offset: z.number().int().min(0).nullish(),
      })
      .strict(),
    errors: [ERR_WORKSPACE_ACTOR, ERR_INVALID],
  },
  {
    name: 'sheetbase.dataset_version_rows.query',
    mode: 'read',
    description:
      'Read rows from an immutable Dataset Version snapshot. Read-only grounding for agents.',
    rpc: 'query_dataset_version_rows',
    via: 'query_dataset_version_rows',
    capability: {
      scopes: ['datasets:read'],
      permission: 'dataset read',
      actor: 'workspace_actor',
      note: 'Historical projection; versions are immutable.',
    },
    inputSchema: z
      .object({
        versionId: uuid,
        limit: z.number().int().min(1).max(1000).nullish(),
        offset: z.number().int().min(0).nullish(),
      })
      .strict(),
    errors: [ERR_WORKSPACE_ACTOR, ERR_INVALID],
  },
  {
    name: 'sheetbase.sheet_instance_rows.query',
    mode: 'read',
    description:
      'Query Sheet Instance composition rows. Read-only grounding for agents.',
    rpc: 'query_sheet_instance_rows',
    via: 'query_sheet_instance_rows',
    capability: {
      scopes: ['sheets:read'],
      permission: 'sheet read',
      actor: 'workspace_actor',
      note: 'Ordinary canonical read; same RLS as normal clients.',
    },
    inputSchema: z
      .object({
        instanceId: uuid,
        limit: z.number().int().min(1).max(200).nullish(),
        offset: z.number().int().min(0).max(10000).nullish(),
      })
      .strict(),
    errors: [ERR_WORKSPACE_ACTOR, ERR_INVALID],
  },
  {
    name: 'sheetbase.search',
    mode: 'read',
    description:
      'Full-text search over workspace records. Read-only grounding for agents.',
    rpc: 'search',
    via: 'search',
    capability: {
      scopes: ['projects:read'],
      permission: 'project read',
      actor: 'workspace_actor',
      note: 'Ordinary canonical read; same RLS as normal clients.',
    },
    inputSchema: z
      .object({
        query: z.string().min(1).max(500),
        limit: z.number().int().min(1).max(100).nullish(),
      })
      .strict(),
    errors: [ERR_WORKSPACE_ACTOR, ERR_INVALID],
  },
]

/** The full bounded catalogue: operation tools + lifecycle RPCs + canonical reads. */
export const AGENT_TOOL_CATALOGUE: readonly AgentToolEntry[] = [
  ...OPERATION_TOOLS,
  ...LIFECYCLE_TOOLS,
  ...READ_TOOLS,
]

/**
 * Human-only operations, explicitly unavailable to agents with reasons.
 * Agents cannot sign or attest on behalf of humans (AUTO+ boundary).
 */
export const UNAVAILABLE_AGENT_OPERATIONS: readonly UnavailableOperation[] = [
  {
    name: 'decide_agent_operation',
    reason:
      'Approval/rejection is a human session act; credentials cannot approve or execute human_required proposals.',
  },
  {
    name: 'execute_agent_operation',
    reason:
      'Execution of an approved proposal requires a human session; agents never execute on behalf of humans.',
  },
  {
    name: 'resume_agent_workflow',
    reason:
      'Resuming a paused workflow revalidates pinned work as a human; agent credentials are excluded fail-closed.',
  },
  {
    name: 'create_agent_operation_policy',
    reason:
      'Delegation policies are created by workspace owners/stewards in a human session.',
  },
  {
    name: 'disable_agent_operation_policy',
    reason: 'Disabling delegation is an owner/steward human-session act.',
  },
  {
    name: 'submit_record_revision',
    reason:
      'Submission is human attestation; denied to external credentials of either kind.',
  },
  {
    name: 'sign_revision',
    reason:
      'Signature is human attestation; denied to external credentials of either kind.',
  },
  {
    name: 'run_revision_checks',
    reason:
      'Review checks run in the human attestation path; not agent-callable.',
  },
  {
    name: 'amend_record_revision',
    reason: 'Amendment is human attestation; not agent-callable.',
  },
  {
    name: 'publish_dataset_schema_version',
    reason:
      'Schema publication is a steward lifecycle act outside the agent draft vocabulary; adding it needs an explicit policy decision.',
  },
  {
    name: 'publish_pipeline_definition_version',
    reason:
      'Pipeline publication is a human lifecycle act outside the agent draft vocabulary.',
  },
  {
    name: 'delete_record',
    reason:
      'Destructive deletes are outside the bounded catalogue; adding one needs an explicit policy decision.',
  },
  {
    name: 'arbitrary_rpc',
    reason:
      'Agents may only invoke catalogue entries; arbitrary RPC calls are fail-closed.',
  },
  {
    name: 'direct_table_write',
    reason:
      'Agents have no private DB access; writes go through canonical RPCs via proposals.',
  },
  {
    name: 'ui_automation',
    reason:
      'Agents discover via listAgentTools/describeAgentTool and invoke via RPCs, never via UI automation.',
  },
]

export interface AgentToolFilter {
  /** Restrict to modes. */
  mode?: AgentToolMode | AgentToolMode[]
  /**
   * Capability filtering for the caller: only entries whose required scopes
   * are all held by the caller are returned. Entries requiring no scope are
   * always returned. Unavailable operations are never listed.
   */
  scopes?: Scope[]
}

/**
 * Discovery entry point for agents: list the bounded catalogue, optionally
 * filtered by mode and by the caller's capabilities. No private DB access,
 * no UI automation — this function is the discovery surface.
 */
export function listAgentTools(filter: AgentToolFilter = {}): AgentToolEntry[] {
  const modes =
    filter.mode === undefined
      ? undefined
      : Array.isArray(filter.mode)
        ? filter.mode
        : [filter.mode]
  return AGENT_TOOL_CATALOGUE.filter((entry) => {
    if (modes && !modes.includes(entry.mode)) return false
    if (
      filter.scopes &&
      !entry.capability.scopes.every((scope) => filter.scopes!.includes(scope))
    )
      return false
    return true
  })
}

/** Describe one catalogue entry by name, or null when unknown/unavailable. */
export function describeAgentTool(name: string): AgentToolEntry | null {
  return AGENT_TOOL_CATALOGUE.find((entry) => entry.name === name) ?? null
}

/** True when the name is explicitly unavailable (with reason), false when catalogue-listed or unknown. */
export function unavailableReason(name: string): string | null {
  return (
    UNAVAILABLE_AGENT_OPERATIONS.find((entry) => entry.name === name)?.reason ??
    null
  )
}
