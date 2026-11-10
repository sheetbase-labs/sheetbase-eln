import { hasCapability } from '#/lib/capability'
import type { ReportKind } from '#/lib/scheduled-reports'

/** Who may schedule a kind of report: the same rule the database applies. */
export function canScheduleKind(
  role: string | null | undefined,
  kind: ReportKind,
): boolean {
  return (
    hasCapability(role, 'schema.edit') ||
    (kind === 'instrument_usage' && hasCapability(role, 'instrument.manage'))
  )
}
