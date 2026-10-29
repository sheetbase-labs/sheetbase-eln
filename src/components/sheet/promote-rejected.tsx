import { t } from '#/copy'
import { useQuery } from '@tanstack/react-query'

import { Banner } from '#/components/v3/ui/alert'
import { Button } from '#/components/v3/ui/button'
import { createDataClient } from '#/lib/data-client'
import type { DataClient } from '#/lib/data-client'
import { listInstanceColumnPromotions } from '#/lib/schema-evolution'

const promoteRejectedDataClient = createDataClient()

/**
 * SHEET-02.3 — the returned-promotion banner (canvas/PromoteRejected).
 *
 * When the reviewer returns a local column's promotion, the sheet says so: the
 * reason the approver gave, and that the column is still local. SHEET-02.2
 * records the decision reason on the promotion (`column_promotions.reason`)
 * and changes nothing in the dataset, so there is nothing to announce beyond
 * the return. Renders nothing while the promotion is pending, approved or
 * applied, or when no promotion exists for the field.
 */
export function PromoteRejected({
  instanceId,
  fieldId,
  client = promoteRejectedDataClient,
  onEditAndResubmit,
  onKeepLocal,
}: {
  instanceId: string
  fieldId: string
  client?: DataClient
  onEditAndResubmit?: () => void
  onKeepLocal?: () => void
}) {
  const promotions = useQuery({
    queryKey: ['column-promotions', instanceId, fieldId],
    queryFn: () => listInstanceColumnPromotions(client, instanceId),
  })
  const returned = (promotions.data ?? []).find(
    (promotion) =>
      promotion.field_id === fieldId && promotion.state === 'returned',
  )
  if (!returned) return null

  return (
    <Banner
      tone="bad"
      title={t('notebook.promoteRejected.title')}
      action={
        onEditAndResubmit || onKeepLocal ? (
          <>
            {onEditAndResubmit ? (
              <Button size="sm" onClick={onEditAndResubmit}>
                {t('notebook.promoteRejected.editAndResubmit')}
              </Button>
            ) : null}
            {onKeepLocal ? (
              <Button size="sm" onClick={onKeepLocal}>
                {t('notebook.promoteRejected.keepLocal')}
              </Button>
            ) : null}
          </>
        ) : undefined
      }
    >
      {returned.reason ? (
        <span>“{returned.reason}” </span>
      ) : (
        <span>{t('notebook.promoteRejected.theReviewerReturnedThis')} </span>
      )}
      <span className="text-fg-muted">
        {t('notebook.promoteRejected.theColumnStaysLocal')}
      </span>
    </Banner>
  )
}
