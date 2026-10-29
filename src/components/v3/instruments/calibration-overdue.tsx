import { Notice } from '#/components/v3/ui/alert'
import type { InstrumentGateMode } from '#/lib/workspace-admin'
import { t } from '#/copy'

/**
 * The overdue-calibration warning, shared by the registry inspector and the
 * record page. `action` is the one step that clears it (record a calibration);
 * without record rights the next step is a person, so the copy names who.
 */
export function CalibrationOverdueNotice({
  instrumentName,
  gateMode = 'warn',
  action,
}: {
  instrumentName: string
  /** What the workspace does with new data from an instrument like this. */
  gateMode?: InstrumentGateMode
  /** Present only when the viewer may record a calibration. */
  action?: React.ReactNode
}) {
  return (
    <Notice
      tone="bad"
      title={t('library.instruments.calibrationOverdue.calibrationOverdue')}
      action={action}
    >
      {gateMode === 'block'
        ? t('library.instruments.calibrationOverdue.dataRefused', {
            instrumentName,
          })
        : gateMode === 'warn'
          ? t('library.instruments.calibrationOverdue.dataFlagged', {
              instrumentName,
            })
          : t('library.instruments.calibrationOverdue.notBookable', {
              instrumentName,
            })}
      {action
        ? ''
        : t('library.instruments.calibrationOverdue.askAWorkspaceMemberWith')}
    </Notice>
  )
}
