/**
 * Minimal MCP JSON-RPC 2.0 protocol surface.
 *
 * The repository deliberately does not take the MCP SDK as a dependency:
 * there is no network install in this change, and the server only needs the
 * request/response subset below. The wire contract follows MCP 2025-06-18:
 * `initialize`, `tools/*`, `resources/*`, `prompts/*` and `ping`, returned as
 * `application/json` (Streamable HTTP permits a JSON response).
 */

export const MCP_PROTOCOL_VERSION = '2025-06-18'
export const MCP_SERVER_NAME = 'sheetbase'
export const MCP_SERVER_VERSION = '1.0.0'

export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: string | number
  method: string
  params?: Record<string, unknown>
}

export interface JsonRpcNotification {
  jsonrpc: '2.0'
  method: string
  params?: Record<string, unknown>
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
  readonly data?: unknown

  constructor(code: number, message: string, data?: unknown) {
    super(message)
    this.name = 'JsonRpcError'
    this.code = code
    this.data = data
  }
}

export function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  if (value === null || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    record.jsonrpc === '2.0' &&
    typeof record.method === 'string' &&
    (typeof record.id === 'string' || typeof record.id === 'number')
  )
}

export function isJsonRpcNotification(
  value: unknown,
): value is JsonRpcNotification {
  if (value === null || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    record.jsonrpc === '2.0' &&
    typeof record.method === 'string' &&
    !('id' in record)
  )
}

export function success(id: string | number, result: unknown): JsonRpcSuccess {
  return { jsonrpc: '2.0', id, result }
}

export function failure(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcFailure {
  return {
    jsonrpc: '2.0',
    id,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  }
}
