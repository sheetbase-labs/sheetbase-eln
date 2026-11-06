import { t } from '#/copy'

/**
 * The words on the header's Submit button: in full where there is room, and
 * just "Submit" on a phone. A returned experiment is resubmitted.
 */
export function SubmitLabel({ status }: { status: string }) {
  if (status === 'returned') return <>{t('projects.lifecycle.resubmit')}</>
  return (
    <>
      <span className="max-md:hidden">
        {t('projects.lifecycle.submitForReview')}
      </span>
      <span className="md:hidden">{t('common.actions.submit')}</span>
    </>
  )
}
