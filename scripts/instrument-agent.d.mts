/** The agent is a standalone plain-JavaScript script; its shape is declared here for its tests. */
import type { z } from 'zod'

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
  robot: RobotOptions | null
}

export interface RobotOptions {
  driver: 'opentrons' | 'file'
  address?: string
  dir?: string
  intervalSeconds?: number
  logVolumeUnit?: 'ul' | 'nl' | 'ml'
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
  fileConfig?: Record<string, z.infer<ReturnType<typeof z.json>>>,
): AgentOptions
export declare function loadConfigFile(
  argv: string[],
  scriptDir: string,
): Promise<Record<string, z.infer<ReturnType<typeof z.json>>>>
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

export declare const ROBOT_DRIVERS: string[]

export interface RobotJob {
  id: string
  number: number
  status: string
  remoteRef: string | null
  cancelRequested?: boolean
  file?: { name: string; content: string }
}

export interface RobotDriver {
  name: string
  stage: (job: RobotJob) => Promise<{ remoteRef: string; message?: string }>
  start: (job: RobotJob) => Promise<{ message?: string }>
  poll: (job: RobotJob) => Promise<{
    status: string
    message?: string
    entries?: unknown[]
    runLog?: string
    volumeUnit?: string
  }>
  stop: (job: RobotJob) => Promise<void>
}

export declare function opentronsEntries(
  run:
    | { labware?: Array<{ id: string; location?: { slotName?: string } }> }
    | undefined,
  commands:
    | Array<{
        commandType: string
        status: string
        params?: { wellName?: string; labwareId?: string; volume?: number }
      }>
    | undefined,
): Array<{
  sourceWell: string
  destWell: string
  actualUl: number
  status: 'ok' | 'failed'
}>
export declare function createOpentronsDriver(
  config: RobotOptions,
  deps?: { fetch?: typeof fetch },
): RobotDriver
export declare function createFileDriver(config: RobotOptions): RobotDriver
export declare function createRobotRunner(
  options: AgentOptions,
  deps?: {
    fetch?: typeof fetch
    log?: (line: string) => void
    ensureToken: (force?: boolean) => Promise<string>
    driver?: RobotDriver
  },
): { pass: () => Promise<number> }
