/**
 * Minimal MCP JSON-RPC 2.0 protocol surface.
 *
 * The repository deliberately does not take the MCP SDK as a dependency:
 * there is no network install in this change, and the server only needs the
 * request/response subset below. The wire contract follows MCP 2025-06-18:
 * `initialize`, `tools/*`, `resources/*`, `prompts/*` and `ping`, returned as
 * `application/json` (Streamable HTTP permits a JSON response).
 */
import { z } from 'zod'

export const MCP_PROTOCOL_VERSION = '2025-06-18'
export const MCP_SERVER_NAME = 'sheetbase'
export const MCP_SERVER_VERSION = '1.0.0'

export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: string | number
  method: string
  params?: { [name: string]: z.JSONType }
}

export interface JsonRpcNotification {
  jsonrpc: '2.0'
  id?: never
  method: string
  params?: { [name: string]: z.JSONType }
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification

export interface JsonRpcSuccess {
  jsonrpc: '2.0'
  id: string | number
  result: unknown
}

export interface JsonRpcFailure {
  jsonrpc: '2.0'
  id: string | number | null
  error: {
    code: number
    message: string
    data?: unknown
  }
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure

export const JSON_RPC_ERRORS = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
} as const

export class JsonRpcError extends Error {
  readonly code: number
  readonly data?: z.JSONType

  constructor(code: number, message: string, data?: z.JSONType) {
    super(message)
    this.name = 'JsonRpcError'
    this.code = code
    this.data = data
  }
}

const requestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number()]),
  method: z.string(),
  params: z.record(z.string(), z.json()).optional(),
})

const notificationSchema = requestSchema.omit({ id: true }).passthrough()

export function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  return requestSchema.safeParse(value).success
}

export function isJsonRpcNotification(
  value: unknown,
): value is JsonRpcNotification {
  const parsed = notificationSchema.safeParse(value)

  return parsed.success && !('id' in parsed.data)
}

export function success<T>(id: string | number, result: T): JsonRpcSuccess {
  return { jsonrpc: '2.0', id, result }
}

export function failure(
  id: string | number | null,
  code: number,
  message: string,
  data?: z.JSONType,
): JsonRpcFailure {
  return {
    jsonrpc: '2.0',
    id,
    error: { code, message, ...(data !== undefined && { data }) },
  }
}
