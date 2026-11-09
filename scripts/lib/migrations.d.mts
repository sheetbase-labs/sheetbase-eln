export interface MigrationEntry {
  tag: string
  when: number
}

export interface Migration extends MigrationEntry {
  hash: string
  statements: string[]
}

export interface MigrationJournal {
  entries: Array<{
    idx: number
    version: string
    when: number
    tag: string
    breakpoints: boolean
  }>
}

export const TIMESTAMP_EPOCH_MS: number
export const TIMESTAMP_NAME: RegExp

export function timestampMs(stamp: string): number
export function listMigrations(folder?: string): MigrationEntry[]
export function readMigrations(folder?: string): Migration[]
export function readJournal(folder?: string): MigrationJournal
export function applyMigrations(
  client: {
    query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }>
  },
  folder?: string,
): Promise<string[]>
