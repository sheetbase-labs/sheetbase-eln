import type { SheetDefinitionConfiguration } from './sheet-definition'

export type SheetRecordActionKind =
  'create-record' | 'link-record' | 'open-record'

export interface ResolvedSheetRecordAction {
  kind: SheetRecordActionKind
  key: string
  label: string
  enabled: boolean
  reason:
    | 'Configured on the Sheet Definition.'
    | 'Not configured on the Sheet Definition.'
}

const KIND_ORDER: SheetRecordActionKind[] = [
  'link-record',
  'create-record',
  'open-record',
]

const KIND_LABEL: Record<SheetRecordActionKind, string> = {
  'link-record': 'Link Record',
  'create-record': 'Create Record',
  'open-record': 'Open Record',
}

/**
 * CORE-04.9 / CORE-05.3: UI visibility follows Definition `actions`.
 * Server Record RPCs distinguish `record.link` (search / batch link) from
 * `record.create` (inline create and batch create). Current role mapping
 * still grants both to every unsuspended member.
 */
export function resolveSheetRecordActions(
  configuration:
    Pick<SheetDefinitionConfiguration, 'actions'> | null | undefined,
): ResolvedSheetRecordAction[] {
  const configured = new Map(
    (configuration?.actions ?? []).map((action) => [action.kind, action]),
  )
  return KIND_ORDER.map((kind) => {
    const action = configured.get(kind)
    if (!action) {
      return {
        kind,
        key: kind,
        label: KIND_LABEL[kind],
        enabled: false,
        reason: 'Not configured on the Sheet Definition.',
      }
    }
    return {
      kind,
      key: action.key,
      label: action.label,
      enabled: true,
      reason: 'Configured on the Sheet Definition.',
    }
  })
}

export const SHEET_RECORD_CAPABILITY_LIMITATION =
  'Definition actions hide or disable Record create/link in the UI. Server RPCs now require record.link versus record.create. The initial role mapping still grants both to unsuspended members so Scientist behaviour is unchanged.'
