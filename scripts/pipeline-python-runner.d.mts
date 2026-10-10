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
  command: (args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>,
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
