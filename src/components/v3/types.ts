import type { Tone } from '#/components/v3/ui/status'

// Shapes the backend will return. They mirror the records in the design: stable IDs, pinned versions, immutable snapshots.
export type Person = { id: string; name: string; initials: string }

export type Notification = {
  id: string
  to: NotificationTarget
  unread: boolean
  html: string
  when: string
}
export type NotificationTarget =
  | { kind: 'review'; id: string }
  | { kind: 'dataset'; id: string }
  | { kind: 'pipeline-run'; id: string }
  | { kind: 'sample'; id: string }
  | { kind: 'sheet'; id: string }

export type Snapshot = {
  id: string // S-15
  savedAt: string
  madeBy: string
  rows: number
  change: string
  citedBy: string[]
  keeping: { tone: Tone; label: string }
  rowsRemoved?: string
  source?: { trigger: string; file: string; sha256: string }
}

export type Dataset = {
  id: string // DS-0311
  name: string
  model: string
  experiment: string
  owner: string
  issues: { tone: Tone; label: string }
  rows: number
  snapshots: Snapshot[]
  archived?: string
  notice?: { title: string; body: string; action: string }
}

export type SnapshotDiffRow = {
  change: 'add' | 'chg' | 'del'
  row: number
  sample: string
  condition: string
  turbidity: { before?: string; after?: string }
  other: { before?: string; after?: string }
}

export type FieldDef = {
  name: string
  key: string
  type: string
  unit: string
  required: string
  rule: string
  since: string
}
export type ModelVersion = {
  version: string
  publishedAt: string
  by: string
  change: { tag?: 'add' | 'chg'; text: string }[]
  approvedBy: string
  current: boolean
}
export type RecordRow = {
  id: string
  name: string
  values: Record<string, string>
  status: { tone: Tone; label: string }
}

export type Model = {
  id: string // MDL-0019
  name: string
  kind: 'Record' | 'Measurement'
  version: string
  prefix: string
  owner: string
  description: string
  fields: FieldDef[]
  versions: ModelVersion[]
  columns: { key: string; label: string; align?: 'right' }[]
  records: RecordRow[]
  recordCount: number
  rules: string[]
}

export type CellBankRecord = RecordRow & {
  model: string
  created: string
  groups: { title: string; items: [string, string][] }[]
  history: {
    when: string
    change: string
    before?: string
    after?: string
    by: string
  }[]
  notices: { tone: 'warn' | 'info'; text: string }[]
}

export type ApiToken = {
  id: string
  name: string
  owner: string
  can: string
  lastUsed: string
  expires: string
  state: 'active' | 'expired' | 'service'
}
