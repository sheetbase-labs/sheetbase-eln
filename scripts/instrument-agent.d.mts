/** The agent is a standalone plain-JavaScript script; its shape is declared here for its tests. */
export declare const SCOPES: string[]
export declare const DEFAULT_EXTENSIONS: string[]
export interface AgentOptions {
  url: string
  credential: string
  connector: string
  dir: string
  extensions: string[]
  settleSeconds: number
  intervalSeconds: number
  once: boolean
  parser: string
}
export declare function parseArgs(
  argv: string[],
  env?: Record<string, string | undefined>,
): AgentOptions
export declare function tokenExpiry(token: string): number
export declare function contentTypeFor(fileName: string): string
export declare function createAgent(
  options: AgentOptions,
  deps?: {
    fetch?: typeof fetch
    log?: (line: string) => void
    now?: () => number
  },
): {
  scan: () => Promise<{
    sent: number
    failed: number
    retry: number
    waiting: number
  }>
  ensureToken: (force?: boolean) => Promise<string>
}
