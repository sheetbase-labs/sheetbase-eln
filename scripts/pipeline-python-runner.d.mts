/**
 * The Python runner is a standalone plain-JavaScript service (it runs as its own process, not
 * as part of the app bundle), so its shape is declared here for the tests that import it.
 */
import type { Server } from 'node:http'
import type { z } from 'zod'

export interface RunnerJob {
  statement: string
  inputs: Record<
    string,
    Array<Record<string, z.infer<ReturnType<typeof z.json>>>>
  >
  parameters: Record<string, z.infer<ReturnType<typeof z.json>>>
  limits?: {
    timeoutSeconds: number
    memoryMb: number
    cpus: number
    processes: number
    scratchMb: number
    bytes: number
    rows: number
  }
  requirements?: string[]
  environment?: string
  network?: string[]
  contract?: Record<string, z.infer<ReturnType<typeof z.json>>>
  artefactKey?: string
}

export declare const LIMITS: {
  bytes: number
  rows: number
  fields: number
  cells: number
  logBytes: number
  timeoutMs: number
  files: number
  fileBytes: number
}

export declare const OUTPUT_DIR: string
export declare const ARTEFACT_KEY: RegExp

export interface CollectedArtefact {
  name: string
  size: number
  path: string
}

export declare function collectOutputFiles(
  command: (
    args: string[],
  ) => Promise<{ code: number; stdout: string; stderr: string }>,
  containerName: string,
  artefactKey: string,
): Promise<CollectedArtefact[]>

export declare function releaseArtefacts(
  artefactKey: string,
  keep: boolean,
): Promise<{ kept: boolean }>

export declare function pruneArtefacts(
  maxAgeMs?: number,
  now?: number,
): Promise<{ removed: number; kept: number }>

export declare class RunnerError extends Error {
  constructor(
    message: string,
    status?: number,
    code?: string,
    details?: { logs?: string[]; line?: number },
  )
  status: number
  code: string
  details: { logs?: string[]; line?: number }
}

export interface RunnerEnvironment {
  python: string
  packages: Record<string, string>
}

export type DockerCommand = (
  args: string[],
  options?: {
    input?: string
    timeoutMs?: number
    maxBytes?: number
    timeoutMessage?: string
  },
) => Promise<{ code: number; stdout: string; stderr: string }>

/** What one job runs with: a plugin call's own limits, or the fixed pipeline limits. */
export interface JobLimits {
  custom: boolean
  bytes: number
  rows: number
  fields: number
  cells: number
  logBytes: number
  timeoutMs: number
  memoryMb: number
  cpus: number
  processes: number
  scratchMb: number
}

export interface EgressConfig {
  network: string
  host: string
  port: number
  allowPrivate?: boolean
}

export interface EgressProxy {
  server: Server
  register: (hosts: string[]) => { token: string; release: () => void }
  readonly activeGrants: number
}

export declare const PLUGIN_REQUIREMENT: RegExp
export declare const PLUGIN_HOST: RegExp
export declare const ENVIRONMENT_ID: RegExp

export declare function limitsOf(
  job: Pick<RunnerJob, 'limits'> | RunnerJob,
): JobLimits
export declare function containerArguments(
  image: string,
  name: string,
  options?: {
    limits?: JobLimits
    egress?: { network: string; url: string }
  },
): string[]
export declare function environmentId(
  baseImage: string,
  requirements: string[],
): string
export declare function validateRequirements(
  requirements: unknown,
): asserts requirements is string[]
export declare function environmentDockerfile(options?: {
  pipIndexUrl?: string
}): string
export declare function buildFailureMessage(output: string): string
export declare function buildEnvironment(
  requirements: string[],
  baseImage: string,
  command?: DockerCommand,
  options?: { pipIndexUrl?: string },
): Promise<string>
export declare function environmentImage(
  id: string,
  command?: DockerCommand,
): Promise<{ id: string; reported: string } | undefined>

export interface EnvironmentStatus {
  id: string
  state: 'ready' | 'building' | 'failed' | 'missing'
  error?: string
  packages?: Record<string, string>
}

export declare function createEnvironments(options: {
  image: string
  command?: DockerCommand
  inspect: (image: string) => Promise<RunnerEnvironment | undefined> | undefined
}): {
  id: (requirements: string[]) => string
  status: (id: string) => Promise<EnvironmentStatus>
  ensure: (requirements: string[]) => Promise<EnvironmentStatus>
  idle: () => Promise<void>
}
export declare function egressFromEnvironment(
  env?: Record<string, string | undefined>,
): EgressConfig | undefined

export declare function validateJob(job: unknown): asserts job is RunnerJob
export declare function failureDetails(result: {
  logs?: z.infer<ReturnType<typeof z.json>>
  line?: z.infer<ReturnType<typeof z.json>>
}): {
  logs?: string[]
  line?: number
}
export declare function inspectRuntime(
  image: string,
  command?: DockerCommand,
): Promise<RunnerEnvironment | undefined>
export declare function runDockerJob(
  job: RunnerJob,
  image: string,
  command?: DockerCommand,
  context?: { egress?: EgressConfig; proxy?: EgressProxy },
): Promise<{
  rows: Record<string, z.infer<ReturnType<typeof z.json>>>[]
  logs: string[]
  runtime: string
  files: Array<{ name: string; size: number }>
  environment?: RunnerEnvironment
}>
export declare function createRunnerServer(options: {
  token: string
  image: string
  execute?: (
    job: RunnerJob,
    image: string,
  ) => Promise<{
    rows: Record<string, z.infer<ReturnType<typeof z.json>>>[]
    logs: string[]
    environment?: RunnerEnvironment
  }>
  inspect?: (image: string) => Promise<RunnerEnvironment | undefined>
  concurrency?: number
  maxBodyBytes?: number
  egress?: EgressConfig
  proxy?: EgressProxy
  environments?: ReturnType<typeof createEnvironments>
  checkRuntime?: () => Promise<void>
}): Server
