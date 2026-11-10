import { t } from '#/copy'
import { AskAiButton } from '#/components/assist/ask-ai-button'
import { PageHeader } from '#/components/ui/layout'
import { CopyButton } from '#/components/ui/copy-button'
import { FavouriteToggle } from '#/components/favourites/favourite-toggle'
import type { Crumb } from '#/components/ui/breadcrumb'
import type { SheetInstance } from '#/lib/sheet-instance-data'

/**
 * The sheet page's header: the instance's name and revision in the middle, and
 * the favourite, share and assistant actions on the right.
 */
export function SheetPageHeader({
  trail,
  instance,
  sheetId,
}: {
  trail: Crumb[]
  instance: SheetInstance | null
  sheetId: string
}) {
  return (
    <PageHeader
      trail={trail}
      title={instance?.name ?? t('notebook.sheetPage.sheetLabel')}
      meta={
        <>
          {instance?.displayId ? (
            <span className="mono">{instance.displayId}</span>
          ) : null}
          <span>
            {instance ? `v${instance.revision}` : t('common.states.loading')}
          </span>
          {instance?.sourceDefinitionVersionId ? (
            <span className="max-lg:hidden">
              {t('notebook.sheetPage.fromATemplate')}
            </span>
          ) : (
            <span className="max-lg:hidden">
              {t('notebook.sheetPage.adHocSheet')}
            </span>
          )}
        </>
      }
      actions={
        <>
          <FavouriteToggle kind="sheet" objectId={sheetId} />
          {/* NAV-02 Share: the control reports the actual outcome — claiming
              "Link copied" when nothing reached the clipboard would leave the
              user with an empty paste and no explanation. */}
          <CopyButton
            value={() => window.location.href}
            copiedMessage={t('notebook.sheetPage.linkCopied')}
            failedMessage={t('notebook.sheetPage.couldNotCopyTheLink')}
          >
            {t('common.actions.share')}
          </CopyButton>
          <AskAiButton />
        </>
      }
    />
  )
}
