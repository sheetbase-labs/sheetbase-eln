import { Notice } from '#/components/v3/ui/alert'

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
    <Notice tone="bad" title="Calibration overdue." action={action}>
      Data from {instrumentName} is flagged and can’t be cited in GxP records,
      and it can’t be booked, until a new calibration is recorded with its
      certificate.
      {action
        ? ''
        : ' Ask a workspace member with write access (any role except viewer) to record it.'}
    </Notice>
  )
}
