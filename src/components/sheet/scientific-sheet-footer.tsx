import { t } from '#/copy'
import { Button, buttonVariants } from '#/components/ui/button'
import { IconButton } from '#/components/ui/icon-button'
import { Icon } from '#/components/icons'
import { Spinner } from '#/components/ui/spinner'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { DataAccessButton } from '#/components/data-access/data-access-panel'
import { scientificTableHandle } from '#/lib/data-access-handles'
import type { SaveStatus } from '#/lib/grid-operation-coordinator'
import type { ScientificTableWire } from '#/lib/scientific-sheet-data'

function SaveStatusIndicator({
  status,
  onRetry,
}: {
  status: SaveStatus
  onRetry: () => void
}) {
  if (status === 'saving' || status === 'retrying')
    return (
      <span
        className="flex items-center gap-1 text-fg-muted"
        aria-label={
          status === 'retrying'
            ? t('notebook.scientificSheetBlock.ariaLabel')
            : t('notebook.scientificSheetBlock.savingAriaLabel')
        }
      >
        <Spinner size={12} />
        {status === 'retrying'
          ? t('notebook.scientificSheetBlock.offlineRetrying')
          : t('common.states.saving')}
      </span>
    )

  if (status === 'error')
    return (
      <span
        className="flex items-center gap-1 text-danger-text"
        aria-label={t('notebook.scientificSheetBlock.saveFailed')}
      >
        <Icon name="warn" className="size-3" />
        {t('notebook.scientificSheetBlock.saveFailed')}
        <Button
          type="button"
          variant="quiet"
          size="sm"
          className="text-danger-text"
          onClick={onRetry}
        >
          <Icon name="rotateCcw" className="size-3" />
          {t('notebook.scientificSheetBlock.retry')}
        </Button>
      </span>
    )

  if (status === 'saved')
    return (
      <span
        className="flex items-center gap-1 text-success-text-foreground"
        aria-label={t('common.states.saved')}
      >
        <Icon name="check" className="size-3" />
        {t('common.states.saved')}
      </span>
    )

  return null
}

export function ScientificSheetFooter({
  table,
  rowCount,
  readOnly,
  saveStatus,
  dataAccess,
  calculating,
  onRetry,
  onAdd,
  onConfigure,
  onExport,
  onInspect,
  onRecalculate,
}: {
  table: ScientificTableWire
  rowCount: number
  readOnly: boolean
  saveStatus: SaveStatus
  dataAccess: boolean
  calculating: boolean
  onRetry: () => void
  onAdd: () => void
  onConfigure: () => void
  onExport: () => void
  onInspect: () => void
  onRecalculate: () => void
}) {
  return (
    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-fg-muted">
      <div className="flex items-center gap-2">
        <span>
          {rowCount} {rowCount === 1 ? 'row' : 'rows'}
        </span>
        {readOnly ? null : (
          <SaveStatusIndicator status={saveStatus} onRetry={onRetry} />
        )}
      </div>
      <div className="flex items-center gap-1">
        {!readOnly ? (
          <Button
            type="button"
            variant="quiet"
            size="sm"
            aria-label={t('notebook.scientificSheetBlock.addRowAriaLabel')}
            onClick={onAdd}
          >
            {t('notebook.scientificSheetBlock.addRow')}
          </Button>
        ) : null}
        <a
          href={`/datasets/${encodeURIComponent(table.id)}`}
          className={buttonVariants({ variant: 'quiet', size: 'sm' })}
          data-slot="button"
          data-size="sm"
        >
          {t('notebook.scientificSheetBlock.exploreDataset')}
        </a>
        {!readOnly ? (
          <Button
            type="button"
            variant="quiet"
            size="icon"
            aria-label={t(
              'notebook.scientificSheetBlock.configureTableAriaLabel',
            )}
            onClick={onConfigure}
          >
            <Icon name="settings" className="size-4" />
          </Button>
        ) : null}
        {dataAccess ? (
          <DataAccessButton handle={scientificTableHandle(table)} />
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <IconButton
                type="button"
                variant="quiet"
                label={t('notebook.scientificSheetBlock.sheetToolsAriaLabel')}
                icon="more"
              />
            }
          />
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onExport}>
              {t('notebook.scientificSheetBlock.exportCsv')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onInspect}>
              {t('notebook.scientificSheetBlock.apiInspector')}
            </DropdownMenuItem>
            {readOnly ? null : (
              <DropdownMenuItem disabled={calculating} onClick={onRecalculate}>
                {t('notebook.scientificSheetBlock.recalculate')}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
