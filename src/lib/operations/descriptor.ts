/**
 * Operation descriptors: one declaration per thing the lab can do, from which
 * every integration surface is generated.
 *
 * An operation is a named action (or lookup) on lab data: archive a record,
 * receive a reagent, commit rows to a dataset. Declaring it once here gives it:
 *
 * - the public API entry: the token allowlist, the OpenAPI document, the
 *   docs/api page row and, through OpenAPI, the Python and TypeScript SDKs
 *   (`labRpcsFromOperations`, read by `lab-api-surface.ts`);
 * - the MCP action, through the same list (`sheetbase.lab.act`);
 * - the assistant tool name, as a confirm card for a write or an answer for a
 *   read (`assistantToolsFrom`);
 * - the agent operation vocabulary the gateway and workflows allow
 *   (`agentOperationToolsFrom`);
 * - the pipeline action (`pipelineActionsFrom`);
 * - the webhook events it produces (`eventEntriesFrom`).
 *
 * What a descriptor does not generate is behaviour. The RPC it calls is a SQL
 * function, and an assistant card with its own wording or lookup is still a
 * resolver in code. The tests check that every name a descriptor lists is
 * backed by one, so a declaration cannot promise a surface that is not there.
 *
 * This module is browser safe and imports no application code at runtime, so
 * the surfaces it feeds can all import it without a cycle.
 */
import type { EventCatalogueEntry, EventFamily } from '../event-catalogue'
import type { LabField, LabRpc, LabType } from '../lab-api-surface'
import type {
  PipelineActionArgument,
  PipelineActionArgumentType,
  PipelineActionDefinition,
} from '../pipelines/actions'

/** Input types, the same vocabulary the lab API and OpenAPI use. */
export type OperationInputType = LabType

export interface OperationInput {
  /** The parameter name, such as `p_record_id`. */
  name: string
  type: OperationInputType
  /** Not null and no default: the call fails without it. */
  required: boolean
  /** The caller may pass an explicit null. Only pipelines distinguish it. */
  nullable?: boolean
  /** One line for the docs and for agents. Falls back to the shared notes. */
  description?: string
  /** Filled in by the server, never by the caller (an idempotency key). */
  server?: 'idempotency' | 'workspace'
}

/** A webhook event an operation produces. Names are added, never renamed. */
export interface OperationEvent {
  name: string
  family: EventFamily
  summary: string
  /** The internal change this event is produced from. */
  producer: {
    entityType: string
    operation: string
    when?: { key: string; equals?: string; notEquals?: string }
  }
  notes?: string
}

export interface OperationAssistant {
  /** The tool name, `sheetbase.<area>.<verb>`. */
  tool: string
  /**
   * `card` asks the person to confirm before anything is written; `answer`
   * returns the result in the reply. Defaults from `kind`.
   */
  presentation?: 'card' | 'answer'
  /**
   * Which allowlist the tool belongs to. `propose` and `read` are the in-app
   * assistant's; `operation` is the draft vocabulary the gateway and the agent
   * workflows share. Defaults from `presentation`.
   */
  vocabulary?: 'propose' | 'read' | 'operation'
}

export interface OperationPipeline {
  /** Defaults to the operation's label. */
  label?: string
  /** Defaults to the operation's description. */
  description?: string
  /** The proposal kind this becomes when a step proposes it instead of running it. */
  proposalKind?: string
}

export interface OperationDescriptor {
  /** Unique key. Also the RPC name unless `rpc` says otherwise. */
  name: string
  /** What a scientist would call it. */
  label: string
  /** What it does, in a sentence or two. Used by the API docs and by agents. */
  description: string
  /** `write` changes something; `read` only looks. */
  kind: 'read' | 'write'
  /** The token scope that may run it. Defaults from `kind`. */
  scope?: 'lab:read' | 'lab:write'
  inputs: readonly OperationInput[]
  /**
   * What it returns: `row:<table>`, `rows:<col>=<type>,…`, `list:text`,
   * `json`, `void` or a scalar type. Defaults to `json`.
   */
  result?: string
  /** The SQL function behind it, when it is not `name`. */
  rpc?: string
  /**
   * `lab` generates the public API entry (allowlist, OpenAPI, docs, MCP,
   * agent permissions). `elsewhere` means the API entry is declared by hand in
   * the core API contracts or `lab-api-surface.ts`; the other surfaces are
   * still generated. Defaults to `lab` when `summary` is set, else `elsewhere`.
   */
  api?: 'lab' | 'elsewhere'
  /** The one-line summary the API lists the action under. */
  summary?: string
  assistant?: OperationAssistant
  pipeline?: OperationPipeline
  events?: readonly OperationEvent[]
  /** Which docs/api page documents it. Defaults to `lab-api.md`. */
  docsPage?: string
  /**
   * Set for an operation an extension adds, so core code can tell where it
   * came from and remove it with the extension.
   */
  source?: string
}

/** Declares an operation and keeps its literal types for derived lists. */
export function defineOperation<const T extends OperationDescriptor>(
  descriptor: T,
): T {
  return descriptor
}

/** `defineOperation` for every entry of a list, keeping literal types. */
export function defineOperations<
  const T extends readonly OperationDescriptor[],
>(descriptors: T): T {
  return descriptors
}

/** Shorthand for an input. */
export const input = (
  name: string,
  type: OperationInputType,
  required = true,
  nullable = false,
): OperationInput => ({ name, type, required, nullable })

export const operationRpc = (op: OperationDescriptor): string =>
  op.rpc ?? op.name

export const operationScope = (
  op: OperationDescriptor,
): 'lab:read' | 'lab:write' =>
  op.scope ?? (op.kind === 'read' ? 'lab:read' : 'lab:write')

export const operationPresentation = (
  op: OperationDescriptor,
): 'card' | 'answer' =>
  op.assistant?.presentation ?? (op.kind === 'read' ? 'answer' : 'card')

export const operationVocabulary = (
  op: OperationDescriptor,
): 'propose' | 'read' | 'operation' =>
  op.assistant?.vocabulary ??
  (operationPresentation(op) === 'answer' ? 'read' : 'propose')

// ---------------------------------------------------------------------------
// Generators. Each is a pure function of a list of descriptors.
// ---------------------------------------------------------------------------

/** The public API entries for operations that declare `api: 'lab'`. */
export function labRpcsFromOperations(
  operations: readonly OperationDescriptor[],
): Record<string, LabRpc> {
  const out: Record<string, LabRpc> = {}
  for (const op of operations) {
    if (!op.summary || op.api === 'elsewhere') continue
    out[operationRpc(op)] = {
      summary: op.summary,
      description: op.description,
      scope: operationScope(op),
      params: op.inputs.map((field): LabField => [
        field.name,
        field.type,
        field.required ? 1 : 0,
      ]),
      result: op.result ?? 'json',
    }
  }
  return out
}

/** Parameter notes the operations add to the shared notes the API docs use. */
export function paramNotesFromOperations(
  operations: readonly OperationDescriptor[],
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const op of operations)
    for (const field of op.inputs)
      if (field.description && !(field.name in out))
        out[field.name] = field.description
  return out
}

const PIPELINE_TYPES: Partial<
  Record<OperationInputType, PipelineActionArgumentType>
> = {
  uuid: 'uuid',
  'uuid[]': 'uuid[]',
  ts: 'timestamptz',
  text: 'text',
  bool: 'boolean',
  date: 'date',
  int: 'integer',
  bigint: 'bigint',
  num: 'numeric',
  json: 'jsonb',
  'text[]': 'text[]',
}

/** The pipeline actions for operations that declare a `pipeline` half. */
export function pipelineActionsFrom(
  operations: readonly OperationDescriptor[],
): PipelineActionDefinition[] {
  const out: PipelineActionDefinition[] = []
  for (const op of operations) {
    if (!op.pipeline) continue
    out.push({
      operation: op.name,
      rpc: operationRpc(op),
      label: op.pipeline.label ?? op.label,
      description: op.pipeline.description ?? op.description,
      arguments: op.inputs.map((field): PipelineActionArgument => {
        const type = PIPELINE_TYPES[field.type]
        if (!type)
          throw new Error(
            `${op.name}.${field.name}: a pipeline action cannot take ${field.type}.`,
          )
        return {
          name: field.name,
          type,
          required: field.required,
          nullable: field.nullable ?? false,
          ...(field.server ? { server: field.server } : {}),
        }
      }),
      proposalKind: op.pipeline.proposalKind,
    })
  }
  return out
}

/** The assistant tool names of one vocabulary, in declaration order. */
export function assistantToolsFrom(
  operations: readonly OperationDescriptor[],
  vocabulary: 'propose' | 'read' | 'operation',
): string[] {
  return operations
    .filter((op) => op.assistant && operationVocabulary(op) === vocabulary)
    .map((op) => (op.assistant as OperationAssistant).tool)
}

/** Catalogue entries for the events operations produce. */
export function eventEntriesFrom(
  operations: readonly OperationDescriptor[],
  consumers: EventCatalogueEntry['consumers'],
): EventCatalogueEntry[] {
  return operations.flatMap((op) =>
    (op.events ?? []).map((event): EventCatalogueEntry => ({
      name: event.name,
      family: event.family,
      summary: event.summary,
      producer: event.producer,
      wireName: event.name,
      status: 'stable',
      introducedIn: 'lab-01',
      consumers,
      ...(event.notes ? { notes: event.notes } : {}),
    })),
  )
}

/** A docs/api stub for an operation: what a new page or section starts from. */
export function operationDocStub(op: OperationDescriptor): string {
  const rows = op.inputs
    .map(
      (field) =>
        `| \`${field.name}\` | ${field.type} | ${field.required ? 'yes' : 'no'} | ${field.description ?? ''} |`,
    )
    .join('\n')
  const events = (op.events ?? [])
    .map((event) => `- \`${event.name}\`: ${event.summary}`)
    .join('\n')
  return [
    `### \`${operationRpc(op)}\``,
    '',
    op.summary ?? op.label,
    '',
    op.description,
    '',
    `Scope: \`${operationScope(op)}\`. Returns \`${op.result ?? 'json'}\`.`,
    '',
    '| Parameter | Type | Required | Notes |',
    '|---|---|---|---|',
    rows,
    ...(events ? ['', 'Events:', '', events] : []),
    '',
  ].join('\n')
}
