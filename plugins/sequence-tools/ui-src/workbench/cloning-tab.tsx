/**
 * Cloning: plan a digest-and-ligate, Golden Gate or Gibson assembly from parts,
 * see the products it can make and how the parts join, then add the product
 * to the notebook or register it with lineage to its parts.
 */
import { useMemo, useRef, useState } from 'react'

import { Textarea } from '#/components/inventory/list'
import { Notice } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import { IconButton } from '#/components/ui/icon-button'
import { Field, Input } from '#/components/ui/input'
import { Select } from '#/components/ui/select'
import { toast } from '#/components/ui/sonner'
import { Tabs } from '#/components/ui/tabs'
import { t } from '#/copy'
import { siblingSequences } from '#/lib/host'
import { useAsync } from '#/lib/use-async'
import {
  cleanDna,
  digestAndLigate,
  ENZYMES,
  formatBp,
  gibson,
  goldenGate,
  simulatePcr,
  sortedFragments,
} from '#/lib/molbio'
import type { AssemblyProduct } from '#/lib/molbio'
import {
  SEQUENCE_ACCEPT,
  isSequenceFileName,
  parseSequenceFile,
} from '#/lib/sequence'
import type { ParsedSequence } from '#/lib/sequence'
import {
  MAX_PLANS,
  MAX_PLAN_PARTS,
  SEQUENCE_METHODS,
  newId,
  sequenceOf,
} from '#/lib/sequence-block'
import type {
  AssemblyPlan,
  PlanPart,
  SequenceMethod,
} from '#/lib/sequence-block'
import {
  duplicatesOf,
  isDuplicateError,
  parentsOf,
  registerProduct,
  registryModels,
} from '#/lib/registry'
import type { DuplicateMatch, RegistryModel } from '#/lib/registry'
import { SequenceViewer } from '../sequence-viewer'
import { EnzymePicker } from './enzyme-picker'
import { DataTable, Panel, fixed } from './shared'
import type { WorkbenchProps } from './shared'

const TYPE_IIS = ENZYMES.filter((e) => e.typeIIS).map((e) => e.name)

/** Run a plan: the products it can make and warnings about the plan itself. */
export function runPlan(plan: AssemblyPlan): {
  products: AssemblyProduct[]
  warnings: string[]
} {
  const parts = plan.parts.map((p) => ({
    id: p.id,
    name: p.name,
    seq: p.seq.toUpperCase(),
    topology: p.topology,
    features: p.features,
  }))
  if (parts.length < 2) return { products: [], warnings: ['needTwoParts'] }
  if (plan.method === 'gibson')
    return gibson(parts, { minOverlap: plan.minOverlap ?? 15 })
  if (plan.method === 'golden_gate') {
    const enzyme = plan.enzymes[0]
    return enzyme
      ? goldenGate(parts, enzyme)
      : { products: [], warnings: ['pickEnzyme'] }
  }
  if (plan.enzymes.length === 0)
    return { products: [], warnings: ['pickEnzyme'] }
  return digestAndLigate(
    plan.parts.map((p) => {
      const pick = plan.partPick?.[p.id] ?? 'largest'
      return {
        part: {
          id: p.id,
          name: p.name,
          seq: p.seq.toUpperCase(),
          topology: p.topology,
          features: p.features,
        },
        enzymes: plan.partEnzymes?.[p.id] ?? plan.enzymes,
        pick,
      }
    }),
  )
}

function methodLabel(m: SequenceMethod): string {
  return t(`molbio.cloning.method.${m}`)
}

export function CloningTab(props: WorkbenchProps) {
  const { draft, edit, canEdit } = props
  const plans = draft.plans ?? []
  const [selectedId, setSelectedId] = useState<string | null>(
    plans[0]?.id ?? null,
  )
  const plan = plans.find((p) => p.id === selectedId) ?? plans.at(0) ?? null
  const [newName, setNewName] = useState('')
  const [newMethod, setNewMethod] = useState<SequenceMethod>('golden_gate')
  if (draft.molecule === 'protein')
    return <Notice>{t('molbio.enzymes.dnaOnly')}</Notice>

  const updatePlan = (id: string, change: (p: AssemblyPlan) => AssemblyPlan) =>
    edit((d) => ({
      ...d,
      plans: (d.plans ?? []).map((p) => (p.id === id ? change(p) : p)),
    }))

  const create = () => {
    if (plans.length >= MAX_PLANS) {
      toast.error(t('molbio.cloning.tooManyPlans'))
      return
    }
    const id = newId('plan')
    const first: PlanPart[] = draft.residues
      ? [partFromSequence(draft, props.blockId)]
      : []
    edit((d) => ({
      ...d,
      plans: [
        ...(d.plans ?? []),
        {
          id,
          name:
            newName.trim() ||
            t('molbio.cloning.unnamed', { number: plans.length + 1 }),
          method: newMethod,
          enzymes: newMethod === 'golden_gate' ? ['BsaI'] : [],
          parts: first,
        },
      ],
    }))
    setSelectedId(id)
    setNewName('')
  }

  return (
    <div className="flex flex-col gap-5">
      {canEdit ? (
        <Panel
          title={t('molbio.cloning.newPlan')}
          hint={t('molbio.cloning.newPlanHint')}
        >
          <div className="flex flex-wrap items-end gap-3">
            <Field label={t('molbio.cloning.planName')} className="w-56">
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t('molbio.cloning.planNamePlaceholder')}
              />
            </Field>
            <Tabs
              mode="state"
              variant="segment"
              label={t('molbio.cloning.methodLabel')}
              value={newMethod}
              onValueChange={(k) => setNewMethod(k as SequenceMethod)}
              items={SEQUENCE_METHODS.map((m) => ({
                key: m,
                label: methodLabel(m),
              }))}
            />
            <Button variant="primary" icon="plus" onClick={create}>
              {t('molbio.cloning.createPlan')}
            </Button>
          </div>
        </Panel>
      ) : null}

      {plans.length > 1 ? (
        <Tabs
          mode="state"
          variant="strip"
          label={t('molbio.cloning.plans')}
          value={plan?.id ?? ''}
          onValueChange={setSelectedId}
          items={plans.map((p) => ({ key: p.id, label: p.name }))}
        />
      ) : null}

      {plan ? (
        <PlanEditor
          key={plan.id}
          {...props}
          plan={plan}
          update={(change) => updatePlan(plan.id, change)}
          remove={() => {
            edit((d) => ({
              ...d,
              plans: (d.plans ?? []).filter((p) => p.id !== plan.id),
            }))
            setSelectedId(null)
          }}
        />
      ) : (
        <Notice>{t('molbio.cloning.noPlans')}</Notice>
      )}
    </div>
  )
}

function partFromSequence(
  d: WorkbenchProps['draft'],
  blockId: string,
): PlanPart {
  return {
    id: newId('part'),
    name: d.name || d.title || 'Sequence',
    seq: d.residues,
    topology: d.topology,
    features: d.features,
    blockId,
    ...(d.registryRecordId
      ? {
          registryRecordId: d.registryRecordId,
          registryIdentifier: d.registryIdentifier,
        }
      : {}),
  }
}

function PlanEditor(
  props: WorkbenchProps & {
    plan: AssemblyPlan
    update: (change: (p: AssemblyPlan) => AssemblyPlan) => void
    remove: () => void
  },
) {
  const { draft, canEdit, plan, update, edit, blockId, insertBelow } =
    props
  const [productIndex, setProductIndex] = useState(0)
  const result = useMemo(() => runPlan(plan), [plan])
  const product =
    result.products.at(Math.min(productIndex, result.products.length - 1)) ??
    null
  const addPart = (part: PlanPart) => {
    if (plan.parts.length >= MAX_PLAN_PARTS) {
      toast.error(t('molbio.cloning.tooManyParts'))
      return
    }
    update((p) => ({ ...p, parts: [...p.parts, part] }))
  }
  return (
    <div className="flex flex-col gap-5">
      <Panel
        title={plan.name}
        actions={
          canEdit ? (
            <Button size="sm" variant="danger" onClick={props.remove}>
              {t('molbio.cloning.deletePlan')}
            </Button>
          ) : null
        }
      >
        <div className="flex flex-wrap items-end gap-3">
          {canEdit ? (
            <Field label={t('molbio.cloning.planName')} className="w-56">
              <Input
                value={plan.name}
                onChange={(e) =>
                  update((p) => ({ ...p, name: e.target.value }))
                }
              />
            </Field>
          ) : null}
          <Tabs
            mode="state"
            variant="segment"
            label={t('molbio.cloning.methodLabel')}
            value={plan.method}
            onValueChange={(k) => {
              if (!canEdit) return
              update((p) => ({
                ...p,
                method: k as SequenceMethod,
                enzymes:
                  k === 'golden_gate'
                    ? ['BsaI']
                    : k === 'ligation'
                      ? []
                      : p.enzymes,
              }))
            }}
            items={SEQUENCE_METHODS.map((m) => ({
              key: m,
              label: methodLabel(m),
            }))}
          />
        </div>
        <p className="text-label text-fg-muted">
          {t(`molbio.cloning.methodHint.${plan.method}`)}
        </p>
        {plan.method === 'gibson' ? (
          <Field label={t('molbio.cloning.minOverlap')} className="w-40">
            <Input
              inputMode="numeric"
              disabled={!canEdit}
              value={String(plan.minOverlap ?? 15)}
              onChange={(e) =>
                update((p) => ({
                  ...p,
                  minOverlap: Math.max(
                    8,
                    Math.min(60, Number(e.target.value) || 15),
                  ),
                }))
              }
            />
          </Field>
        ) : plan.method === 'golden_gate' ? (
          <Field label={t('molbio.cloning.typeIIS')} className="w-48">
            <Select
              disabled={!canEdit}
              value={plan.enzymes[0] ?? ''}
              onChange={(e) =>
                update((p) => ({ ...p, enzymes: [e.target.value] }))
              }
            >
              {TYPE_IIS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <EnzymePicker
            selected={plan.enzymes}
            disabled={!canEdit}
            onChange={(names) => update((p) => ({ ...p, enzymes: names }))}
          />
        )}
      </Panel>

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
              cell: (p) => (
                <span className="font-medium text-fg">{p.name}</span>
              ),
            },
            {
              key: 'shape',
              head: t('molbio.cloning.columns.shape'),
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
                              ;[parts[i - 1], parts[i]] = [
                                parts[i],
                                parts[i - 1],
                              ]
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

      <Panel title={t('molbio.cloning.products')}>
        {result.warnings.length > 0 && result.products.length === 0 ? (
          <Notice tone="warn">
            {result.warnings
              .map((w) =>
                t(
                  `molbio.cloning.planWarning.${w}` as 'molbio.cloning.planWarning.noAssembly',
                ),
              )
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
                    onClick={() => setProductIndex(i)}
                  >
                    {i + 1}
                  </button>
                ),
              },
              {
                key: 'shape',
                head: t('molbio.cloning.columns.shape'),
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
                        .map((w) =>
                          t(
                            `molbio.cloning.productWarning.${w}` as 'molbio.cloning.productWarning.shortOverlap',
                          ),
                        )
                        .join(', '),
              },
            ]}
          />
        ) : null}
      </Panel>

      {product ? (
        <ProductPanel
          key={`${plan.id}-${productIndex}-${product.seq.length}`}
          plan={plan}
          product={product}
          blockId={blockId}
          canEdit={canEdit}
          edit={edit}
          insertBelow={insertBelow}
          fallbackName={draft.name || draft.title || ''}
        />
      ) : null}
    </div>
  )
}

function AddPart({
  draft,
  context,
  blockId,
  addPart,
}: WorkbenchProps & { addPart: (p: PlanPart) => void }) {
  const [source, setSource] = useState('')
  const [from, setFrom] = useState('1')
  const [to, setTo] = useState(String(draft.residues.length || 1))
  const [pasted, setPasted] = useState('')
  const [pastedName, setPastedName] = useState('')
  const [fwd, setFwd] = useState('')
  const [rev, setRev] = useState('')
  const file = useRef<HTMLInputElement>(null)
  const siblings = useAsync(() => siblingSequences(context), context.blockId ?? '')
  const primers = draft.primers ?? []
  const names = {
    whole: t('molbio.cloning.add.whole'),
    region: t('molbio.cloning.add.region'),
    pcr: t('molbio.cloning.add.pcr'),
    block: t('molbio.cloning.add.block'),
    paste: t('molbio.cloning.add.paste'),
    file: t('molbio.cloning.add.file'),
  }
  const own = draft.name || draft.title || t('molbio.sequenceFallback')
  const pcrProducts =
    source === 'pcr' && fwd && rev
      ? simulatePcr(
          draft.residues.toUpperCase(),
          primers.find((p) => p.id === fwd)?.seq ?? '',
          primers.find((p) => p.id === rev)?.seq ?? '',
          draft.topology === 'circular',
        )
      : []
  return (
    <div className="flex flex-col gap-3 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t('molbio.cloning.add.label')} className="w-64">
          <Select value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">{t('molbio.cloning.add.choose')}</option>
            {draft.residues ? (
              <option value="whole">{names.whole}</option>
            ) : null}
            {draft.residues ? (
              <option value="region">{names.region}</option>
            ) : null}
            {primers.length >= 2 ? (
              <option value="pcr">{names.pcr}</option>
            ) : null}
            <option value="block">{names.block}</option>
            <option value="paste">{names.paste}</option>
            <option value="file">{names.file}</option>
          </Select>
        </Field>
        {source === 'whole' ? (
          <Button onClick={() => addPart(partFromSequence(draft, blockId))}>
            {t('molbio.cloning.add.add')}
          </Button>
        ) : null}
        {source === 'region' ? (
          <>
            <Field label={t('molbio.primers.targetFrom')} className="w-24">
              <Input
                inputMode="numeric"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </Field>
            <Field label={t('molbio.primers.targetTo')} className="w-24">
              <Input
                inputMode="numeric"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </Field>
            <Button
              onClick={() => {
                const a = Math.max(1, Number(from) || 1)
                const b = Math.min(
                  draft.residues.length,
                  Number(to) || draft.residues.length,
                )
                if (b <= a) return
                addPart({
                  id: newId('part'),
                  name: `${own} ${a}..${b}`,
                  seq: draft.residues.slice(a - 1, b),
                  topology: 'linear',
                  features: draft.features
                    .filter(
                      (f) => f.start <= f.end && f.start >= a && f.end <= b,
                    )
                    .map((f) => ({
                      ...f,
                      start: f.start - a + 1,
                      end: f.end - a + 1,
                      parts: f.parts.map((x) => ({
                        start: x.start - a + 1,
                        end: x.end - a + 1,
                      })),
                    })),
                  blockId,
                })
              }}
            >
              {t('molbio.cloning.add.add')}
            </Button>
          </>
        ) : null}
        {source === 'pcr' ? (
          <>
            <Field label={t('molbio.primers.forward')} className="w-44">
              <Select value={fwd} onChange={(e) => setFwd(e.target.value)}>
                <option value="">{t('molbio.primers.choose')}</option>
                {primers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('molbio.primers.reverse')} className="w-44">
              <Select value={rev} onChange={(e) => setRev(e.target.value)}>
                <option value="">{t('molbio.primers.choose')}</option>
                {primers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Button
              disabled={pcrProducts.length === 0}
              onClick={() => {
                const p = pcrProducts[0]
                addPart({
                  id: newId('part'),
                  name: t('molbio.cloning.add.pcrName', {
                    forward: primers.find((x) => x.id === fwd)?.name ?? '',
                    reverse: primers.find((x) => x.id === rev)?.name ?? '',
                  }),
                  seq: p.seq,
                  topology: 'linear',
                  features: [],
                  blockId,
                })
              }}
            >
              {pcrProducts.length === 0 && fwd && rev
                ? t('molbio.primers.noProduct')
                : t('molbio.cloning.add.add')}
            </Button>
          </>
        ) : null}
        {source === 'block' ? (
          <Field label={t('molbio.cloning.add.block')} className="w-64">
            <Select
              value=""
              onChange={(e) => {
                const s = siblings.data?.find((x) => x.id === e.target.value)
                if (!s) return
                addPart({
                  id: newId('part'),
                  name:
                    s.payload.name ||
                    s.payload.title ||
                    t('molbio.sequenceFallback'),
                  seq: s.payload.residues,
                  topology: s.payload.topology,
                  features: s.payload.features,
                  blockId: s.id,
                  ...(s.payload.registryRecordId
                    ? {
                        registryRecordId: s.payload.registryRecordId,
                        registryIdentifier: s.payload.registryIdentifier,
                      }
                    : {}),
                })
              }}
            >
              <option value="">
                {siblings.isPending
                  ? t('molbio.cloning.add.loading')
                  : (siblings.data?.length ?? 0) === 0
                    ? t('molbio.cloning.add.noBlocks')
                    : t('molbio.cloning.add.pickBlock')}
              </option>
              {siblings.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.payload.name ||
                    s.payload.title ||
                    t('molbio.sequenceFallback')}{' '}
                  ({s.payload.residues.length})
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        {source === 'file' ? (
          <>
            <Button icon="upload" onClick={() => file.current?.click()}>
              {t('molbio.edit.importFile')}
            </Button>
            <input
              ref={file}
              type="file"
              hidden
              accept={SEQUENCE_ACCEPT}
              onChange={async (e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (!f) return
                if (!isSequenceFileName(f.name)) {
                  toast.error(t('sequences.notSequence', { name: f.name }))
                  return
                }
                try {
                  const parsed: ParsedSequence[] = parseSequenceFile(
                    await f.text(),
                  )
                  for (const s of parsed.slice(0, 4))
                    addPart({
                      id: newId('part'),
                      name: s.name,
                      seq: s.residues,
                      topology: s.topology,
                      features: s.features,
                    })
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : String(err))
                }
              }}
            />
          </>
        ) : null}
      </div>
      {source === 'paste' ? (
        <div className="flex flex-col gap-2">
          <Input
            aria-label={t('molbio.primers.name')}
            placeholder={t('molbio.primers.name')}
            className="w-56"
            value={pastedName}
            onChange={(e) => setPastedName(e.target.value)}
          />
          <Textarea
            aria-label={t('molbio.edit.pasteLabel')}
            rows={3}
            className="font-mono"
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder={t('molbio.cloning.add.pastePlaceholder')}
          />
          <div>
            <Button
              disabled={cleanDna(pasted).length < 8}
              onClick={() => {
                addPart({
                  id: newId('part'),
                  name: pastedName.trim() || t('molbio.cloning.add.pastedName'),
                  seq: cleanDna(pasted),
                  topology: 'linear',
                  features: [],
                })
                setPasted('')
                setPastedName('')
              }}
            >
              {t('molbio.cloning.add.add')}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function ProductPanel({
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
  const [name, setName] = useState(`${plan.name}`.trim() || fallbackName)
  const [modelKey, setModelKey] = useState('')
  const [duplicates, setDuplicates] = useState<DuplicateMatch[] | null>(null)
  const [allowDup, setAllowDup] = useState(false)
  const [busy, setBusy] = useState(false)
  const models = useAsync(registryModels, 'models')
  const sequences = (models.data ?? []).filter((m) => m.registry_sequence_field)
  const model: RegistryModel | undefined =
    sequences.find((m) => m.key === modelKey) ?? sequences.at(0)
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
  const register = async () => {
    if (!model) return
    setBusy(true)
    try {
      const done = await registerProduct({
        model,
        title: name.trim() || fallbackName,
        sequence: parsed,
        parents,
        allowDuplicate: allowDup,
      })
      edit((d) => ({
        ...d,
        products: [
          ...(d.products ?? []),
          {
            recordId: done.recordId,
            identifier: done.identifier,
            title: done.title,
            method: product.method,
            planId: plan.id,
            registeredAt: new Date().toISOString(),
          },
        ],
      }))
      toast(t('molbio.cloning.registered', { identifier: done.identifier }))
      setDuplicates(null)
    } catch (error) {
      if (isDuplicateError(error)) {
        try {
          setDuplicates(
            await duplicatesOf(model, parsed, name),
          )
        } catch {
          setDuplicates([])
        }
      } else toast.error(error instanceof Error ? error.message : t('molbio.cloning.registerFailed'))
    } finally {
      setBusy(false)
    }
  }
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
      <SequenceViewer sequences={[parsed]} />
      {canEdit ? (
        <div className="flex flex-col gap-3 rounded-md border border-border p-3">
          <h4 className="text-body font-medium text-fg">
            {t('molbio.cloning.registerTitle')}
          </h4>
          {models.isSuccess && sequences.length === 0 ? (
            <Notice>{t('molbio.cloning.noRegistry')}</Notice>
          ) : (
            <>
              <p className="text-label text-fg-muted">
                {parents.length > 0
                  ? t('molbio.cloning.lineage', { count: parents.length })
                  : t('molbio.cloning.noLineage')}
              </p>
              <div className="flex flex-wrap items-end gap-3">
                <Field label={t('molbio.cloning.registry')} className="w-56">
                  <Select
                    value={model?.key ?? ''}
                    onChange={(e) => {
                      setModelKey(e.target.value)
                      setDuplicates(null)
                    }}
                  >
                    {sequences.map((m) => (
                      <option key={m.key} value={m.key}>
                        {m.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Button
                  variant="primary"
                  disabled={busy || !model}
                  onClick={() => void register()}
                >
                  {t('molbio.cloning.register')}
                </Button>
              </div>
            </>
          )}
          {duplicates ? (
            <Notice tone="warn">
              <div className="flex flex-col gap-2">
                <span>
                  {duplicates.length > 0
                    ? t('molbio.cloning.duplicate', {
                        identifiers: duplicates
                          .map((d) => d.identifier)
                          .join(', '),
                      })
                    : t('molbio.cloning.duplicateUnknown')}
                </span>
                <label className="flex items-center gap-2">
                  <Checkbox checked={allowDup} onCheckedChange={setAllowDup} />
                  {t('registry.duplicate.registerAnyway')}
                </label>
              </div>
            </Notice>
          ) : null}
        </div>
      ) : null}
    </Panel>
  )
}
