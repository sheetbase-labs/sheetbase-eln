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
  instrumentId: string
  live: LiveSource[]
}
export type LiveSource = {
  kind: 'file' | 'network'
  path?: string
  host?: string
  port?: number
  feed?: string
  unit?: string
  fromStart?: boolean
}
export interface LiveReading {
  feed: string
  value: number
  unit?: string
  at?: string
}
export declare const CONFIG_FILE_NAME: string
export declare function parseArgs(
  argv: string[],
  env?: Record<string, string | undefined>,
  fileConfig?: Record<string, unknown>,
): AgentOptions
export declare function loadConfigFile(
  argv: string[],
  scriptDir: string,
): Promise<Record<string, unknown>>
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
export declare function splitFeedLabel(label: string): {
  feed: string
  unit: string
}
export declare function createLineParser(
  source?: { feed?: string; unit?: string },
  now?: () => number,
): { parse: (line: string) => LiveReading[] }
export declare function createTail(
  path: string,
  options?: { fromStart?: boolean },
): { poll: () => Promise<{ lines: string[]; header: string | null }> }
export declare const LIVE_BUFFER_LIMIT: number
export declare function createLiveSender(
  options: { url: string; instrumentId: string },
  deps: {
    ensureToken: (force?: boolean) => Promise<string>
    fetchImpl?: typeof fetch
    log: (line: string) => void
  },
): {
  push: (readings: LiveReading[]) => void
  flush: () => Promise<'idle' | 'sent' | 'retry' | 'dropped'>
  readonly pending: number
}
