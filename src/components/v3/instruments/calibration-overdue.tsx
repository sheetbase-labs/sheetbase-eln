import { Notice } from '#/components/v3/ui/alert'
import { t } from '#/copy'

/**
 * The overdue-calibration warning, shared by the registry inspector and the
 * record page. `action` is the one step that clears it (record a calibration);
 * without record rights the next step is a person, so the copy names who.
 */
export function CalibrationOverdueNotice({
  instrumentName,
  action,
}: {
  instrumentName: string
  /** Present only when the viewer may record a calibration. */
  action?: React.ReactNode
}) {
  return (
    <Notice
      tone="bad"
      title={t('library.instruments.calibrationOverdue.calibrationOverdue')}
      action={action}
    >
      {t('library.instruments.calibrationOverdue.dataFromIsFlaggedAnd', {
        instrumentName,
      })}
      {action
        ? ''
        : t('library.instruments.calibrationOverdue.askAWorkspaceMemberWith')}
    </Notice>
  )
}
