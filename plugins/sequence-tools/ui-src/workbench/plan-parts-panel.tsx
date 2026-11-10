import { IconButton, Select } from '../ui/kit'
import { t } from '#/copy'
import { formatBp, sortedFragments } from '#/lib/molbio'
import type { AssemblyPlan, PlanPart } from '#/lib/sequence-block'
import { AddPart } from './add-part'
import { DataTable, Panel } from './shared'
import type { WorkbenchProps } from './shared'

/**
 * The parts, in the order they will be joined: each one's name, shape, length
 * and registry identifier; for a ligation plan, which cut fragment of it to
 * use; and the controls to reorder or remove it. Below the table is the way to
 * add the next part.
 */
export function PlanPartsPanel({
  plan,
  update,
  addPart,
  ...props
}: WorkbenchProps & {
  plan: AssemblyPlan
  update: (change: (p: AssemblyPlan) => AssemblyPlan) => void
  addPart: (part: PlanPart) => void
}) {
  const canEdit = props.canEdit

  return (
    <Panel title={t('molbio.cloning.parts', { count: plan.parts.length })}>
      <DataTable
        caption={t('molbio.cloning.partsCaption')}
        rows={plan.parts}
        rowKey={(p) => p.id}
        empty={t('molbio.cloning.noParts')}
        columns={[
          { key: 'n', head: '#', cell: (_, i) => i + 1 },
          {
            key: 'name',
            head: t('molbio.cloning.columns.name'),
            cell: (p) => <span className="font-medium text-fg">{p.name}</span>,
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
            key: 'registry',
            head: t('molbio.cloning.columns.registry'),
            cell: (p) =>
              p.registryIdentifier ?? t('molbio.cloning.notRegistered'),
          },
          ...(plan.method === 'ligation'
            ? [
                {
                  key: 'cut',
                  head: t('molbio.cloning.columns.use'),
                  cell: (p: PlanPart) => {
                    if (plan.enzymes.length === 0) return '—'

                    const frags = sortedFragments(
                      {
                        id: p.id,
                        name: p.name,
                        seq: p.seq.toUpperCase(),
                        topology: p.topology,
                      },
                      plan.partEnzymes?.[p.id] ?? plan.enzymes,
                    )

                    const pick = plan.partPick?.[p.id]

                    const value = Array.isArray(pick)
                      ? String(pick[0])
                      : pick === 'smallest'
                        ? String(frags.length - 1)
                        : '0'

                    return (
                      <Select
                        size="sm"
                        aria-label={t('molbio.cloning.columns.use')}
                        disabled={!canEdit}
                        value={value}
                        onChange={(e) =>
                          update((q) => ({
                            ...q,
                            partPick: {
                              ...q.partPick,
                              [p.id]: [Number(e.target.value)],
                            },
                          }))
                        }
                      >
                        {frags.map((f, i) => (
                          // react-doctor-disable-next-line react-doctor/no-array-index-as-key -- A fragment is identified by its place in the sorted occurrence list; two fragments of the same size are distinct choices.
                          <option key={i} value={i}>
                            {t('molbio.cloning.fragmentOption', {
                              number: i + 1,
                              size: formatBp(f.size),
                            })}
                          </option>
                        ))}
                      </Select>
                    )
                  },
                },
              ]
            : []),
          ...(canEdit
            ? [
                {
                  key: 'x',
                  head: '',
                  align: 'right' as const,
                  cell: (p: PlanPart) => (
                    <span className="flex justify-end gap-1">
                      <IconButton
                        label={t('molbio.cloning.moveUp')}
                        icon="expand"
                        disabled={plan.parts[0].id === p.id}
                        onClick={() =>
                          update((q) => {
                            const i = q.parts.findIndex((x) => x.id === p.id)

                            const parts = [...q.parts]

                            ;[parts[i - 1], parts[i]] = [parts[i], parts[i - 1]]

                            return { ...q, parts }
                          })
                        }
                      />
                      <IconButton
                        label={t('molbio.cloning.removePart')}
                        icon="x"
                        onClick={() =>
                          update((q) => ({
                            ...q,
                            parts: q.parts.filter((x) => x.id !== p.id),
                          }))
                        }
                      />
                    </span>
                  ),
                },
              ]
            : []),
        ]}
      />
      {canEdit ? <AddPart {...props} addPart={addPart} /> : null}
    </Panel>
  )
}
