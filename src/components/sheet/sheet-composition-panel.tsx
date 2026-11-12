/**
 * Details: what the sheet is made of. Each source with the columns it brings,
 * the sheet's own columns (which can be offered to a dataset), the
 * calculations, how rows are matched and where the sheet came from.
 */
import { t } from '#/copy'
import { Icon } from '#/components/icons'
import type { IconName } from '#/components/icons'
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
      className="tx-side max-md:w-full max-md:flex-none max-md:border-t max-md:border-l-0"
    >
      <div>
        <h4>{t('notebook.sheetComposition.title')}</h4>
        <ul className="tx-made">
          {parts.map((part) => (
            <li key={part.key} className={part.origin === 'local' ? 'loc' : ''}>
              {part.origin === 'calculation' ? (
                <span className="fxm">ƒx</span>
              ) : (
                <Icon name={ORIGIN_ICON[part.origin]} size={12} />
              )}
              <span>
                <b>{part.title}</b>
                {[part.detail, part.columns.map((c) => c.label).join(', ')]
                  .filter(Boolean)
                  .join(' · ')}
                {part.origin === 'local' && onAddToDataset ? (
                  <button
                    type="button"
                    className="tx-add"
                    onClick={() => onAddToDataset(part.columns)}
                  >
                    <Icon name="database" size={11} />
                    {t('notebook.sheetComposition.addToDataset')}
                  </button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <dl className="tx-dl">
        <dt>{t('notebook.sheetComposition.rows')}</dt>
        <dd>
          {rowsMatchedOn.length > 0
            ? t('notebook.sheetComposition.matchedOn', {
                columns: rowsMatchedOn.join(', '),
              })
            : t('notebook.sheetComposition.ownRows')}
        </dd>
        <dt>{t('notebook.sheetComposition.from')}</dt>
        <dd>{from}</dd>
      </dl>
    </aside>
  )
}

/**
 * Details: how the sheet's dataset columns follow the dataset (live or pinned
 * to a snapshot) and whether editing asks for a reason.
 */
export function SheetBindingCards({
  pinned,
  live,
  reasonRequired,
}: {
  pinned: boolean
  live: boolean
  reasonRequired: boolean
}) {
  return (
    <div className="tx-cards">
      {live || pinned ? (
        <div className="tx-snap">
          <div className="h">
            <Icon name={pinned ? 'lock' : 'database'} size={12} />
            <b>
              {pinned
                ? t('notebook.sheetComposition.pinnedTitle')
                : t('notebook.sheetComposition.liveTitle')}
            </b>
          </div>
          <span>
            {pinned
              ? t('notebook.sheetComposition.pinnedText')
              : t('notebook.sheetComposition.liveText')}
          </span>
        </div>
      ) : null}
      <div className="tx-snap">
        <div className="h">
          <Icon name="edit" size={12} />
          <b>{t('notebook.sheetComposition.reasonTitle')}</b>
        </div>
        <span>
          {reasonRequired
            ? t('notebook.sheetComposition.reasonAsked')
            : t('notebook.sheetComposition.reasonNotAsked')}
        </span>
      </div>
    </div>
  )
}
