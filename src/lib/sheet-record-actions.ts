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
 * CORE-04.9: UI visibility follows Definition `actions`. Server Record
 * operations still use existing RLS/membership. Link-only vs create-capable
 * server capabilities are deferred to CORE-05.
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
  'CORE-04 hides Definition actions in the UI only. Any workspace member can still call Record RPCs permitted by current RLS. Richer link-only vs create-capable server capabilities belong in CORE-05.'
