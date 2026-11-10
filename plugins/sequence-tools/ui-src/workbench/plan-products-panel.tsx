import { Notice } from '../ui/kit'
import { t } from '#/copy'
import type { AssemblyResult } from '#/lib/molbio'
import { DataTable, Panel } from './shared'

/**
 * What the plan would make: the products it can form and what is wrong with the
 * plan when it can form none. More than one product is a warning in its own
 * right — the person has to choose which one they meant.
 */
export function PlanProductsPanel({
  result,
  productIndex,
  onSelect,
}: {
  result: AssemblyResult
  productIndex: number
  onSelect: (index: number) => void
}) {
  return (
    <Panel title={t('molbio.cloning.products')}>
      {result.warnings.length > 0 && result.products.length === 0 ? (
        <Notice tone="warn">
          {result.warnings
            .map((w) => t(`molbio.cloning.planWarning.${w}`))
            .join(' ')}
        </Notice>
      ) : null}
      {result.products.length === 0 && result.warnings.length === 0 ? (
        <Notice>{t('molbio.cloning.noProducts')}</Notice>
      ) : null}
      {result.products.length > 1 ? (
        <Notice tone="warn">
          {t('molbio.cloning.severalProducts', {
            count: result.products.length,
          })}
        </Notice>
      ) : null}
      {result.products.length > 0 ? (
        <DataTable
          caption={t('molbio.cloning.productsCaption')}
          rows={result.products}
          rowKey={(_, i) => String(i)}
          selectedKey={String(productIndex)}
          empty={t('molbio.cloning.noProducts')}
          columns={[
            {
              key: 'n',
              head: '#',
              cell: (_, i) => (
                <button
                  type="button"
                  className="text-fg hover:underline"
                  onClick={() => onSelect(i)}
                >
                  {i + 1}
                </button>
              ),
            },
            {
              key: 'shape',
              head: t('molbio.cloning.columns.topology'),
              cell: (p) => t(`sequences.summary.${p.topology}`),
            },
            {
              key: 'len',
              head: t('molbio.cloning.columns.length'),
              align: 'right',
              cell: (p) =>
                t('sequences.summary.length.dna', { count: p.seq.length }),
            },
            {
              key: 'order',
              head: t('molbio.cloning.columns.order'),
              className: 'max-w-96 truncate',
              cell: (p) =>
                p.parts
                  .map((x) => `${x.name}${x.strand === -1 ? ' ←' : ''}`)
                  .join(' → '),
            },
            {
              key: 'warn',
              head: t('molbio.cloning.columns.checks'),
              cell: (p) =>
                p.warnings.length === 0
                  ? t('molbio.primers.clean')
                  : [...new Set(p.warnings)]
                      .map((w) => t(`molbio.cloning.productWarning.${w}`))
                      .join(', '),
            },
          ]}
        />
      ) : null}
    </Panel>
  )
}
