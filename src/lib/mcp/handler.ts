import { z } from 'zod'

import { AI_OBJECT_REF_KINDS, assembleAiContext } from '../ai-context'
import type { AiContextActor, AiObjectRef } from '../ai-context'
import {
  DOMAIN_PROMPTS,
  DOMAIN_RESOURCES,
  MCP_SERVER_INSTRUCTIONS,
  findDomainPrompt,
  findDomainResource,
} from '../ai-knowledge'
import { proposeAgentOperation } from '../agent-operations'
import type { AgentOperation } from '../agent-operations'
import { listAgentTools } from '../agent-tool-catalogue'
import type { AgentToolEntry } from '../agent-tool-catalogue'
import type { Scope } from '../api-credential-scopes'
import type { DataClient } from '../data-client'
import { DataClientError } from '../data-client'
import { logger, redact } from '../logger'
import {
  JSON_RPC_ERRORS,
  JsonRpcError,
  MCP_PROTOCOL_VERSION,
  MCP_SERVER_NAME,
  MCP_SERVER_VERSION,
  failure,
  isJsonRpcNotification,
  isJsonRpcRequest,
  success,
} from './protocol'
import type {
  JsonRpcMessage,
  JsonRpcRequest,
  JsonRpcResponse,
} from './protocol'

/**
 * MCP server handler.
 *
 * Tools are the existing bounded catalogue (AUTO-PLUS-01/AUTO-04): reads call
 * canonical RPCs, drafts and mutations go through `propose_agent_operation`.
 * Nothing here reaches a table directly, and nothing here can sign, approve,
 * submit or execute on a person's behalf.
 *
 * The handler is pure with respect to transport: the HTTP route authenticates
 * the credential, mints a scoped client and passes both in. Tests call the
 * handler with a fake client, so no network or database is required.
 */

export const CONTEXT_TOOL_NAME = 'sheetbase.context.assemble'

export interface McpContext {
  workspaceId: string
  actor: AiContextActor
  scopes: Scope[]
  client: DataClient
  credentialId: string
}

interface McpTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  annotations: {
    title: string
    readOnlyHint: boolean
    destructiveHint: boolean
    idempotentHint: boolean
    openWorldHint: boolean
  }
}

interface McpToolResult {
  content: Array<{ type: 'text'; text: string }>
  structuredContent?: Record<string, unknown>
  isError?: boolean
}

const READ_SCOPES: Scope[] = [
  'projects:read',
  'datasets:read',
  'sheets:read',
  'models:read',
]

/**
 * The operation's own write scope, in addition to `agent_operations:write`.
 * The proposal RPC auto-executes a safe draft when the acting person holds
 * the capability, so a credential that lacks the underlying write scope must
 * not reach it: otherwise an `agent_operations:write`-only token could cause
 * a real schema or pipeline write through the owner's capabilities.
 */
const OPERATION_WRITE_SCOPE = {
  'dataset_schema.create': 'schema:write',
  'sheet_definition.create': 'schema:write',
  'sheet_definition.update_draft': 'schema:write',
  'pipeline_definition.create': 'pipelines:write',
  'pipeline_definition.create_version': 'pipelines:write',
  'pipeline_definition.update_draft': 'pipelines:write',
  'dataset_rows.commit': 'datasets:write',
} satisfies Record<AgentOperation['kind'], Scope>

const contextInputSchema = z
  .object({
    objectRefs: z
      .array(
        z
          .object({
            kind: z.enum(AI_OBJECT_REF_KINDS),
            id: z.string().uuid(),
            pinnedVersionId: z.string().uuid().nullish(),
            includeSampleRows: z.boolean().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(8),
    maxCharsTotal: z.number().int().min(1_000).max(24_000).optional(),
  })
  .strict()

function hasAnyReadScope(scopes: Scope[]): boolean {
  return READ_SCOPES.some((scope) => scopes.includes(scope))
}

/**
 * Every write scope an operation tool needs before it reaches the proposal
 * RPC. Direct operations name one scope. Workflow creation/advance is more
 * conservative: the first/next pinned operation may belong to any of the
 * three write families, so all three are required rather than guessing from
 * an opaque plan.
 */
function requiredWriteScopes(entry: AgentToolEntry): Scope[] {
  if (entry.operationKind) {
    return [OPERATION_WRITE_SCOPE[entry.operationKind]]
  }
  if (
    entry.name === 'sheetbase.agent.workflow_create' ||
    entry.name === 'sheetbase.agent.workflow_advance'
  ) {
    return ['schema:write', 'pipelines:write', 'datasets:write']
  }
  return []
}

function missingWriteScope(
  entry: AgentToolEntry,
  scopes: Scope[],
): Scope | null {
  return (
    requiredWriteScopes(entry).find((scope) => !scopes.includes(scope)) ?? null
  )
}

function toolAnnotations(entry: AgentToolEntry): McpTool['annotations'] {
  return {
    title: entry.name,
    readOnlyHint: entry.mode === 'read',
    destructiveHint: false,
    idempotentHint: entry.mode === 'read',
    openWorldHint: false,
  }
}

function toMcpTool(entry: AgentToolEntry): McpTool | null {
  try {
    return {
      name: entry.name,
      description: entry.description,
      inputSchema: z.toJSONSchema(entry.inputSchema, { io: 'input' }),
      annotations: toolAnnotations(entry),
    }
  } catch {
    // Fail closed: an unrepresentable schema is not offered rather than
    // offered with a permissive schema.
    return null
  }
}

function contextTool(): McpTool {
  return {
    name: CONTEXT_TOOL_NAME,
    description:
      'Assemble the permitted Sheetbase context for up to eight stable object ids. Read-only, RLS-scoped and budgeted; returns the exact sections and version pins the model would receive.',
    inputSchema: z.toJSONSchema(contextInputSchema, {
      io: 'input',
    }),
    annotations: {
      title: 'Assemble Sheetbase context',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }
}

function listTools(context: McpContext): McpTool[] {
  const catalogue = listAgentTools({ scopes: context.scopes })
    .filter((entry) => missingWriteScope(entry, context.scopes) === null)
    .map(toMcpTool)
    .filter((tool): tool is McpTool => tool !== null)
  return hasAnyReadScope(context.scopes)
    ? [contextTool(), ...catalogue]
    : catalogue
}

function textResult(value: unknown): McpToolResult {
  const text = value === undefined ? 'null' : JSON.stringify(value, null, 2)
  if (text.length > 1_000_000) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: 'The result is too large for one MCP response. Request a smaller limit or page with an offset.',
        },
      ],
    }
  }
  return {
    content: [{ type: 'text', text }],
    structuredContent:
      value !== null && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : { result: value },
  }
}

function toolError(message: string, code?: string): McpToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: message }],
    ...(code ? { structuredContent: { error: { code } } } : {}),
  }
}

function stringMeta(
  meta: Record<string, unknown> | undefined,
  key: string,
  fallback: string,
): string {
  const value = meta?.[key]
  return typeof value === 'string' && value.trim() !== ''
    ? value.trim().slice(0, 200)
    : fallback
}

function readToolArgs(
  name: string,
  data: Record<string, unknown>,
): Record<string, unknown> {
  switch (name) {
    case 'sheetbase.dataset_rows.query':
      return {
        p_dataset_id: data.datasetId,
        p_limit: data.limit ?? 200,
        p_offset: data.offset ?? 0,
      }
    case 'sheetbase.dataset_version_rows.query':
      return {
        p_dataset_version_id: data.versionId,
        p_limit: data.limit ?? 200,
        p_offset: data.offset ?? 0,
      }
    case 'sheetbase.sheet_instance_rows.query':
      return {
        p_instance_id: data.instanceId,
        p_limit: data.limit ?? 50,
        p_offset: data.offset ?? 0,
      }
    case 'sheetbase.search':
      return {
        p_query: data.query,
        p_limit: data.limit ?? 20,
      }
    default:
      throw new JsonRpcError(
        JSON_RPC_ERRORS.invalidParams,
        `No canonical invocation mapping exists for '${name}'.`,
      )
  }
}

function requiredScopeForRef(ref: AiObjectRef): Scope {
  if (ref.kind === 'dataset') return 'datasets:read'
  if (ref.kind === 'sheet') return 'sheets:read'
  if (ref.kind === 'record') return 'models:read'
  return 'projects:read'
}

async function callContextTool(
  args: Record<string, unknown>,
  context: McpContext,
): Promise<McpToolResult> {
  const parsed = contextInputSchema.safeParse(args)
  if (!parsed.success) {
    return toolError('Invalid arguments for sheetbase.context.assemble.')
  }
  for (const ref of parsed.data.objectRefs) {
    const missing = requiredScopeForRef(ref)
    if (!context.scopes.includes(missing)) {
      return toolError(`This credential lacks the required scope: ${missing}.`)
    }
  }
  const envelope = await assembleAiContext(context.client, context.actor, {
    workspaceId: context.workspaceId,
    objectRefs: parsed.data.objectRefs,
    ...(parsed.data.maxCharsTotal
      ? { budgets: { maxCharsTotal: parsed.data.maxCharsTotal } }
      : {}),
  })
  return textResult(envelope)
}

async function callCatalogueTool(
  entry: AgentToolEntry,
  args: Record<string, unknown>,
  context: McpContext,
  meta: Record<string, unknown> | undefined,
): Promise<McpToolResult> {
  if (entry.mode === 'read') {
    const result = await context.client.rpc<unknown>(
      entry.rpc,
      readToolArgs(entry.name, args),
    )
    return textResult(result)
  }

  const operation = args as unknown as AgentOperation
  const operationWorkspace =
    'workspaceId' in operation ? operation.workspaceId : undefined
  if (
    typeof operationWorkspace === 'string' &&
    operationWorkspace !== context.workspaceId
  ) {
    return toolError('The operation targets a different workspace.')
  }

  const missing = missingWriteScope(entry, context.scopes)
  if (missing) {
    return toolError(
      `This credential lacks the write scope required to propose this operation: ${missing}.`,
    )
  }

  const proposal = await proposeAgentOperation(context.client, {
    workspaceId: context.workspaceId,
    title: `Agent ${entry.mode}: ${entry.name}`.slice(0, 200),
    summary: entry.description.slice(0, 2_000),
    operation,
    provenance: {
      agentId: stringMeta(meta, 'agentId', 'sheetbase-mcp'),
      agentName: stringMeta(meta, 'clientName', 'Sheetbase MCP client'),
      tool: { name: entry.name, version: MCP_SERVER_VERSION },
      model: {
        provider: stringMeta(meta, 'modelProvider', 'mcp'),
        name: stringMeta(meta, 'modelName', 'client'),
        ...(stringMeta(meta, 'modelVersion', '')
          ? { version: stringMeta(meta, 'modelVersion', '') }
          : {}),
      },
      invocationId: stringMeta(meta, 'invocationId', crypto.randomUUID()),
    },
    idempotencyKey: stringMeta(
      meta,
      'idempotencyKey',
      crypto.randomUUID(),
    ).slice(0, 128),
  })
  return textResult(proposal)
}

async function callTool(
  params: Record<string, unknown>,
  context: McpContext,
): Promise<McpToolResult> {
  const name = params.name
  if (typeof name !== 'string' || name === '') {
    throw new JsonRpcError(
      JSON_RPC_ERRORS.invalidParams,
      'tools/call requires a tool name.',
    )
  }
  const rawArgs = params.arguments
  const args =
    rawArgs !== null && typeof rawArgs === 'object' && !Array.isArray(rawArgs)
      ? (rawArgs as Record<string, unknown>)
      : {}
  const meta =
    params._meta !== null &&
    typeof params._meta === 'object' &&
    !Array.isArray(params._meta)
      ? (params._meta as Record<string, unknown>)
      : undefined

  if (name === CONTEXT_TOOL_NAME) {
    if (!hasAnyReadScope(context.scopes)) {
      return toolError('This credential has no read scope.')
    }
    return callContextTool(args, context)
  }

  const entry = listAgentTools({ scopes: context.scopes }).find(
    (tool) => tool.name === name,
  )
  if (!entry) {
    return toolError('The tool is not available to this credential.')
  }
  const parsed = entry.inputSchema.safeParse(args)
  if (!parsed.success) {
    return toolError(
      'The arguments do not match the tool schema.',
      'invalid_arguments',
    )
  }
  try {
    return await callCatalogueTool(
      entry,
      parsed.data as Record<string, unknown>,
      context,
      meta,
    )
  } catch (error) {
    if (error instanceof DataClientError) {
      logger.warn(
        'ai.mcp.tool_failed',
        redact({
          tool: name,
          code: error.code,
          status: error.status,
          workspaceId: context.workspaceId,
        }),
      )
      return toolError('The canonical Sheetbase operation failed.', error.code)
    }
    if (error instanceof JsonRpcError) throw error
    logger.warn(
      'ai.mcp.tool_failed',
      redact({
        tool: name,
        errorName: error instanceof Error ? error.name : 'unknown',
        workspaceId: context.workspaceId,
      }),
    )
    return toolError('The tool could not complete.')
  }
}

async function dispatch(
  method: string,
  params: Record<string, unknown>,
  context: McpContext,
): Promise<unknown> {
  switch (method) {
    case 'initialize':
      return {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {
          tools: { listChanged: false },
          resources: { subscribe: false, listChanged: false },
          prompts: { listChanged: false },
        },
        serverInfo: {
          name: MCP_SERVER_NAME,
          title: 'Sheetbase ELN',
          version: MCP_SERVER_VERSION,
        },
        instructions: MCP_SERVER_INSTRUCTIONS,
      }
    case 'ping':
      return {}
    case 'tools/list':
      return {
        tools: listTools(context).map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: tool.annotations,
        })),
      }
    case 'tools/call':
      return callTool(params, context)
    case 'resources/list':
      return {
        resources: DOMAIN_RESOURCES.map((resource) => ({
          uri: resource.uri,
          name: resource.name,
          title: resource.title,
          description: resource.description,
          mimeType: resource.mimeType,
        })),
      }
    case 'resources/templates/list':
      return { resourceTemplates: [] }
    case 'resources/read': {
      const uri = params.uri
      if (typeof uri !== 'string') {
        throw new JsonRpcError(
          JSON_RPC_ERRORS.invalidParams,
          'resources/read requires a uri.',
        )
      }
      const resource = findDomainResource(uri)
      if (!resource) {
        throw new JsonRpcError(
          JSON_RPC_ERRORS.invalidParams,
          'The resource does not exist.',
        )
      }
      return {
        contents: [
          {
            uri: resource.uri,
            mimeType: resource.mimeType,
            text: resource.text,
          },
        ],
      }
    }
    case 'prompts/list':
      return {
        prompts: DOMAIN_PROMPTS.map((prompt) => ({
          name: prompt.name,
          title: prompt.title,
          description: prompt.description,
          arguments: prompt.arguments,
        })),
      }
    case 'prompts/get': {
      const name = params.name
      if (typeof name !== 'string') {
        throw new JsonRpcError(
          JSON_RPC_ERRORS.invalidParams,
          'prompts/get requires a name.',
        )
      }
      const prompt = findDomainPrompt(name)
      if (!prompt) {
        throw new JsonRpcError(
          JSON_RPC_ERRORS.invalidParams,
          'The prompt does not exist.',
        )
      }
      const rawArgs = params.arguments
      const args =
        rawArgs !== null &&
        typeof rawArgs === 'object' &&
        !Array.isArray(rawArgs)
          ? (rawArgs as Record<string, string>)
          : {}
      for (const argument of prompt.arguments) {
        const value = args[argument.name]
        if (
          argument.required &&
          (typeof value !== 'string' || value.trim() === '')
        ) {
          throw new JsonRpcError(
            JSON_RPC_ERRORS.invalidParams,
            `Missing required prompt argument: ${argument.name}`,
          )
        }
      }
      return {
        description: prompt.description,
        messages: [
          {
            role: 'user',
            content: { type: 'text', text: prompt.build(args) },
          },
        ],
      }
    }
    default:
      throw new JsonRpcError(
        JSON_RPC_ERRORS.methodNotFound,
        `Unknown method: ${method}`,
      )
  }
}

/** Handle one JSON-RPC message. Notifications produce no response. */
export async function handleMcpMessage(
  message: JsonRpcMessage,
  context: McpContext,
): Promise<JsonRpcResponse | null> {
  if (isJsonRpcNotification(message)) return null
  if (!isJsonRpcRequest(message)) {
    return failure(null, JSON_RPC_ERRORS.invalidRequest, 'Invalid Request')
  }
  // The guard above narrows at runtime; the explicit cast keeps the union
  // readable to TypeScript, which cannot discriminate the two shapes by a
  // shared literal field.
  const request = message as JsonRpcRequest
  try {
    const result = await dispatch(request.method, request.params ?? {}, context)
    return success(request.id, result)
  } catch (error) {
    if (error instanceof JsonRpcError) {
      return failure(request.id, error.code, error.message, error.data)
    }
    logger.warn(
      'ai.mcp.request_failed',
      redact({
        method: request.method,
        errorName: error instanceof Error ? error.name : 'unknown',
        workspaceId: context.workspaceId,
      }),
    )
    return failure(request.id, JSON_RPC_ERRORS.internal, 'Internal error')
  }
}

/** Handle a parsed HTTP body. MCP 2025-06-18 has no JSON-RPC batching. */
export async function handleMcpBody(
  body: unknown,
  context: McpContext,
): Promise<JsonRpcResponse | null> {
  if (Array.isArray(body)) {
    return failure(
      null,
      JSON_RPC_ERRORS.invalidRequest,
      'JSON-RPC batching is not supported by this protocol version.',
    )
  }
  if (!isJsonRpcRequest(body) && !isJsonRpcNotification(body)) {
    return failure(null, JSON_RPC_ERRORS.invalidRequest, 'Invalid Request')
  }
  return handleMcpMessage(body, context)
}
