/**
 * Details: what the sheet is made of. Each source with the columns it brings,
 * the sheet's own columns (which can be offered to a dataset), the
 * calculations, how rows are matched and where the sheet came from.
 */
import { t } from '#/copy'
import { Icon } from '#/components/icons'
import type { IconName } from '#/components/icons'
import { Button } from '#/components/ui/button'
import type { CanonicalSheetGridColumn } from '#/lib/canonical-sheet-grid'

interface CompositionPart {
  key: string
  origin: CanonicalSheetGridColumn['origin']
  title: string
  detail?: string
  columns: CanonicalSheetGridColumn[]
}

const ORIGIN_ICON: Record<CanonicalSheetGridColumn['origin'], IconName> = {
  bound: 'database',
  local: 'edit',
  calculation: 'sigma',
}

/** Columns grouped by what owns them, in the order the sheet shows them. */
function compositionParts(
  columns: readonly CanonicalSheetGridColumn[],
): CompositionPart[] {
  const parts: CompositionPart[] = []

  for (const column of columns) {
    const key = `${column.origin}:${column.sourceLabel ?? column.group}`
    const part = parts.find((entry) => entry.key === key)

    if (part) {
      part.columns.push(column)
      continue
    }

    parts.push({
      key,
      origin: column.origin,
      title:
        column.origin === 'calculation'
          ? t('notebook.sheetComposition.calculations')
          : (column.sourceLabel ?? column.group),
      detail:
        column.origin === 'bound' && column.sourceLabel
          ? column.group
          : undefined,
      columns: [column],
    })
  }

  return parts
}

export function SheetCompositionPanel({
  columns,
  rowsMatchedOn,
  from,
  onAddToDataset,
}: {
  columns: readonly CanonicalSheetGridColumn[]
  /** Labels of the columns rows are matched on; empty when rows are the sheet's own. */
  rowsMatchedOn: readonly string[]
  /** Where the sheet came from: a definition, a duplicate or ad hoc. */
  from: string
  /** Offer one of the sheet's own columns to a dataset; absent when it can't. */
  onAddToDataset?: (columns: readonly CanonicalSheetGridColumn[]) => void
}) {
  const parts = compositionParts(columns)

  return (
    <aside
      aria-label={t('notebook.sheetComposition.ariaLabel')}
      className="w-72 shrink-0 overflow-y-auto border-l px-4 py-3 max-md:w-full max-md:flex-none max-md:overflow-visible max-md:border-t max-md:border-l-0"
    >
      <h4 className="mb-2 text-label font-semibold text-fg">
        {t('notebook.sheetComposition.title')}
      </h4>
      <ul className="divide-y divide-border-subtle">
        {parts.map((part) => (
          <li key={part.key} className="flex gap-2.5 py-2.5 text-label">
            <Icon
              name={ORIGIN_ICON[part.origin]}
              size={13}
              aria-hidden="true"
              className="mt-0.5 shrink-0 text-fg-muted"
            />
            <div className="min-w-0 flex-1">
              <div className="font-medium text-fg">{part.title}</div>
              <div className="text-fg-muted">
                {[part.detail, part.columns.map((c) => c.label).join(', ')]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
              {part.origin === 'local' && onAddToDataset ? (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  icon="database"
                  className="mt-2"
                  onClick={() => onAddToDataset(part.columns)}
                >
                  {t('notebook.sheetComposition.addToDataset')}
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      <dl className="mt-3 grid grid-cols-[4.5rem_1fr] gap-x-3 gap-y-1.5 text-label">
        <dt className="text-fg-muted">{t('notebook.sheetComposition.rows')}</dt>
        <dd className="text-fg">
          {rowsMatchedOn.length > 0
            ? t('notebook.sheetComposition.matchedOn', {
                columns: rowsMatchedOn.join(', '),
              })
            : t('notebook.sheetComposition.ownRows')}
        </dd>
        <dt className="text-fg-muted">{t('notebook.sheetComposition.from')}</dt>
        <dd className="text-fg">{from}</dd>
      </dl>
    </aside>
  )
}
