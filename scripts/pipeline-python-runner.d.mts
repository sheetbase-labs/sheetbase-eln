/**
 * The Python runner is a standalone plain-JavaScript service (it runs as its own process, not
 * as part of the app bundle), so its shape is declared here for the tests that import it.
 */
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
  options?: { input?: string; timeoutMs?: number; maxBytes?: number },
) => Promise<{ code: number; stdout: string; stderr: string }>

export declare function validateJob(job: unknown): void
export declare function failureDetails(result: unknown): {
  logs?: string[]
  line?: number
}
export declare function inspectRuntime(
  image: string,
  command?: DockerCommand,
): Promise<RunnerEnvironment | undefined>
export declare function runDockerJob(
  job: Record<string, unknown>,
  image: string,
  command?: DockerCommand,
): Promise<{
  rows: Record<string, unknown>[]
  logs: string[]
  runtime: string
  files: Array<{ name: string; size: number }>
  environment?: RunnerEnvironment
}>
export declare function createRunnerServer(options: {
  token: string
  image: string
  execute?: (
    job: Record<string, unknown>,
    image: string,
  ) => Promise<{
    rows: Record<string, unknown>[]
    logs: string[]
    environment?: RunnerEnvironment
  }>
  inspect?: (image: string) => Promise<RunnerEnvironment | undefined>
  checkRuntime?: () => Promise<void>
}): import('node:http').Server
