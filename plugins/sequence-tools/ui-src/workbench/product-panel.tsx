import { useMemo, useState } from 'react'

import { Button, Field, Input, toast } from '../ui/kit'
import { t } from '#/copy'
import { parentsOf } from '#/lib/registry'
import type { AssemblyProduct } from '#/lib/molbio'
import type { ParsedSequence } from '#/lib/sequence'
import type { AssemblyPlan } from '#/lib/sequence-block'
import { SequenceViewer } from '../sequence-viewer'
import { methodLabel } from './cloning-plan'
import { RegisterProductPanel } from './register-product-panel'
import { DataTable, Panel, fixed } from './shared'
import type { WorkbenchProps } from './shared'

/**
 * The chosen product: name it, send it below as a new sequence block, see how
 * its parts join and look at it as a map. Registering it is the registry form's
 * job — `register-product-panel.tsx` — which is the only part that writes.
 */
export function ProductPanel({
  plan,
  product,
  blockId,
  canEdit,
  edit,
  insertBelow,
  fallbackName,
}: {
  plan: AssemblyPlan
  product: AssemblyProduct
  blockId: string
  canEdit: boolean
  edit: WorkbenchProps['edit']
  insertBelow?: WorkbenchProps['insertBelow']
  fallbackName: string
}) {
  const [name, setName] = useState(() => plan.name.trim() || fallbackName)

  const parsed: ParsedSequence = useMemo(
    () => ({
      name,
      description: methodLabel(product.method),
      organism: null,
      molecule: 'dna',
      topology: product.topology,
      length: product.seq.length,
      residues: product.seq,
      features: product.features,
    }),
    [name, product],
  )

  const parents = parentsOf(plan, product)
  void blockId

  return (
    <Panel title={t('molbio.cloning.product')}>
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t('molbio.cloning.productName')} className="w-64">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        {canEdit && insertBelow ? (
          <Button
            icon="plus"
            onClick={() => {
              insertBelow({
                name: name.trim() || fallbackName,
                molecule: 'dna',
                topology: product.topology,
                residues: product.seq,
                features: product.features,
              })
              toast(t('molbio.cloning.addedBelow'))
            }}
          >
            {t('molbio.cloning.addBelow')}
          </Button>
        ) : null}
      </div>
      <JunctionTable product={product} />
      <SequenceViewer sequences={[parsed]} />
      {canEdit ? (
        <RegisterProductPanel
          plan={plan}
          product={product}
          name={name}
          parsed={parsed}
          parents={parents}
          fallbackName={fallbackName}
          edit={edit}
        />
      ) : null}
    </Panel>
  )
}

/** Build junction columns at the same point as the product panel render. */
function JunctionTable({ product }: { product: AssemblyProduct }) {
  return (
    <DataTable
      caption={t('molbio.cloning.junctions')}
      rows={product.junctions}
      rowKey={(_, i) => String(i)}
      empty={t('molbio.cloning.noJunctions')}
      columns={[
        { key: 'n', head: '#', cell: (_, i) => i + 1 },
        {
          key: 'between',
          head: t('molbio.cloning.columns.between'),
          cell: (_, i) => {
            const a = product.parts.at(i)
            const b = product.parts.at((i + 1) % product.parts.length)

            return `${a?.name ?? ''} → ${b?.name ?? ''}`
          },
        },
        {
          key: 'seq',
          head:
            product.method === 'gibson'
              ? t('molbio.cloning.columns.overlap')
              : t('molbio.cloning.columns.overhang'),
          className: 'font-mono',
          cell: (j) =>
            j.seq.length === 0 ? (
              t('molbio.enzymes.blunt')
            ) : (
              <span title={j.seq}>
                {j.seq.length > 36
                  ? `${j.seq.slice(0, 18)}…${j.seq.slice(-14)}`
                  : j.seq}
              </span>
            ),
        },
        {
          key: 'len',
          head: t('molbio.cloning.columns.length'),
          align: 'right',
          cell: (j) => j.seq.length,
        },
        ...(product.method === 'gibson'
          ? [
              {
                key: 'tm',
                head: t('molbio.primers.columns.tm'),
                align: 'right' as const,
                cell: (j: { tm?: number }) =>
                  j.tm === undefined ? '—' : fixed(j.tm),
              },
            ]
          : []),
      ]}
    />
  )
}
