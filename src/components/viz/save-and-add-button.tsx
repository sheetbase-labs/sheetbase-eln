import { Button } from '#/components/ui/button'
import { Icon } from '#/components/icons'
import { t } from '#/copy'

/** Saves the analysis and puts it in the experiment the studio was opened from. */
export function SaveAndAddButton({
  identifier,
  ready,
  pending,
  onClick,
}: {
  identifier: string
  ready: boolean
  pending: boolean
  onClick: () => void
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant="primary"
      disabled={!ready || pending}
      onClick={onClick}
    >
      <Icon name="save" className="size-3.5" aria-hidden />{' '}
      {pending
        ? t('features.resultsAnalysis.studio.adding')
        : t('features.resultsAnalysis.studio.saveAndAdd', { identifier })}
    </Button>
  )
}
