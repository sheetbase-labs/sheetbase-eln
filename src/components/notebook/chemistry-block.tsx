/**
 * Chemistry blocks: a drawn structure, and a drawn reaction with its table.
 *
 * The drawing is made in a dialog with the chemistry editor, which is loaded the
 * first time anyone draws or views one. The block keeps the drawing and what is
 * worked out from it (formula, weight, SMILES), so the notebook, search and the
 * printed record never need the drawing library.
 */
import DOMPurify from 'dompurify'
import { z } from 'zod'
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { ReactNode } from 'react'

import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { Textarea } from '#/components/inventory/list'
import { Notice } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { IconButton } from '#/components/ui/icon-button'
import { Input } from '#/components/ui/input'
import { Muted } from '#/components/ui/layout'
import { Radio, RadioGroup } from '#/components/ui/radio-group'
import { Select } from '#/components/ui/select'
import { TableBox } from '#/components/ui/table'
import { CopyButton } from '#/components/ui/copy-button'
import { ConflictBanner } from './conflict-banner'
import { useAutosave } from './use-autosave'
import { useOfflineEdits } from '#/components/offline/offline-edits'
import { canEditBlockOffline } from '#/components/offline/offline-edit-model'
import type { BlockEditorProps } from './block-editor'
import { t } from '#/copy'
import { validateBlock } from '#/lib/blocks'
import {
  MAX_REACTION_ROWS,
  REACTION_ROLES,
  amountPatch,
  computeReactionTable,
  formatAmount,
  limitingRow,
  newRowId,
  syncRowsWithDrawing,
} from '#/lib/chemistry'
import type {
  AmountField,
  ComputedRow,
  ReactionPayload,
  ReactionRole,
  ReactionRow,
  StructurePayload,
} from '#/lib/chemistry'
import {
  drawnComponents,
  encodeReaction,
  factsOf,
  loadOcl,
  moleculeFacts,
  parseMolfile,
  parseReaction,
  reactionSmiles,
  schemeSvg,
  structureSvg,
} from '#/lib/chemistry-draw'
import type { MoleculeFacts, Ocl } from '#/lib/chemistry-draw'

// ---------------------------------------------------------------------------
// Reading the payload
// ---------------------------------------------------------------------------

// Decode editable fields without discarding extension metadata on a saved drawing.
// Domain limits and cross-row invariants remain enforced by validateBlock at save.
const structurePayload = z.looseObject({
  molfile: z.string().catch(''),
  title: z.string().optional(),
  caption: z.string().optional(),
  name: z.string().optional(),
  formula: z.string().optional(),
  smiles: z.string().optional(),
  mw: z.number().nullable().optional(),
})

const reactionRow: z.ZodType<ReactionRow> = z.looseObject({
  id: z.string(),
  role: z.enum(REACTION_ROLES),
  name: z.string(),
  formula: z.string().optional(),
  structureCode: z.string().optional(),
  note: z.string().optional(),
  mw: z.number().nullable().optional(),
  equiv: z.number().nullable().optional(),
  massMg: z.number().nullable().optional(),
  volumeMl: z.number().nullable().optional(),
  density: z.number().nullable().optional(),
  concentration: z.number().nullable().optional(),
})

const reactionPayload = z.looseObject({
  drawing: z.string().catch(''),
  rows: z.array(reactionRow).default([]),
  title: z.string().optional(),
  caption: z.string().optional(),
  smiles: z.string().optional(),
  limitingId: z.string().nullable().optional(),
})

/** The chemistry library, once it has loaded; null until then. */
function useOcl(): Ocl | null {
  const [ocl, setOcl] = useState<Ocl | null>(null)
  useEffect(() => {
    let live = true
    void loadOcl().then((loaded) => {
      if (live) setOcl(loaded)
    })

    return () => {
      live = false
    }
  }, [])

  return ocl
}

// ---------------------------------------------------------------------------
// Pictures
// ---------------------------------------------------------------------------

function Picture({
  svg,
  label,
  empty,
}: {
  /** null while loading or when nothing is drawn. */
  svg: string | null
  label: string
  empty: ReactNode
}) {
  const clean = useMemo(
    () =>
      svg ? DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true } }) : null,
    [svg],
  )

  if (!clean) {
    return (
      <div className="flex min-h-24 items-center justify-center text-body text-fg-muted">
        {empty}
      </div>
    )
  }

  return (
    <div
      role="img"
      aria-label={label}
      className="flex justify-center overflow-x-auto text-fg [&>svg]:h-auto [&>svg]:max-w-full"
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  )
}

function StructurePicture({ payload }: { payload: StructurePayload }) {
  const ocl = useOcl()

  const svg = useMemo(
    () => (ocl && payload.molfile ? structureSvg(ocl, payload.molfile) : null),
    [ocl, payload.molfile],
  )

  return (
    <Picture
      svg={svg}
      label={t('notebook.chemistry.structureLabel', {
        name: payload.title || payload.name || payload.formula || '',
      })}
      empty={
        payload.molfile
          ? t('notebook.chemistry.loading')
          : t('notebook.chemistry.nothingDrawn')
      }
    />
  )
}

function SchemePicture({ payload }: { payload: ReactionPayload }) {
  const ocl = useOcl()

  const svg = useMemo(
    () => (ocl && payload.drawing ? schemeSvg(ocl, payload.drawing) : null),
    [ocl, payload.drawing],
  )

  return (
    <Picture
      svg={svg}
      label={t('notebook.chemistry.schemeLabel', {
        title: payload.title ?? '',
      })}
      empty={
        payload.drawing
          ? t('notebook.chemistry.loading')
          : t('notebook.chemistry.nothingDrawn')
      }
    />
  )
}

function Facts({ payload }: { payload: StructurePayload }) {
  const parts = [
    payload.formula,
    payload.mw ? `${formatAmount(payload.mw)} g/mol` : null,
  ].filter(Boolean)

  if (parts.length === 0 && !payload.smiles) return null

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-label text-fg-muted">
      {parts.length ? <span className="num">{parts.join(' · ')}</span> : null}
      {payload.smiles ? (
        <span className="flex min-w-0 items-center gap-1">
          <code className="min-w-0 truncate font-mono">{payload.smiles}</code>
          <CopyButton
            value={payload.smiles}
            aria-label={t('notebook.chemistry.copySmiles')}
          />
        </span>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Previews
// ---------------------------------------------------------------------------

export function StructurePreview({ payload }: { payload: unknown }) {
  const p = structurePayload.parse(payload)

  return (
    <figure className="m-0 flex flex-col gap-2 rounded-md border border-border p-3">
      <StructurePicture payload={p} />
      <Facts payload={p} />
      {p.name ? (
        <span className="text-label text-fg-muted">{p.name}</span>
      ) : null}
      {p.caption ? <p className="m-0 text-body">{p.caption}</p> : null}
    </figure>
  )
}

export function ReactionPreview({ payload }: { payload: unknown }) {
  const p = reactionPayload.parse(payload)

  return (
    <figure className="m-0 flex flex-col gap-3 rounded-md border border-border p-3">
      <SchemePicture payload={p} />
      {p.rows.length ? <ReactionTable payload={p} /> : null}
      {p.caption ? <p className="m-0 text-body">{p.caption}</p> : null}
    </figure>
  )
}

// ---------------------------------------------------------------------------
// The reaction table
// ---------------------------------------------------------------------------

const ROLE_LABEL: Record<ReactionRole, string> = {
  reactant: t('notebook.chemistry.roleReactant'),
  reagent: t('notebook.chemistry.roleReagent'),
  solvent: t('notebook.chemistry.roleSolvent'),
  product: t('notebook.chemistry.roleProduct'),
}

/** A number box: shows what was typed, or what was worked out, in a lighter tone. */
function AmountInput({
  label,
  value,
  worked,
  onChange,
  disabled,
}: {
  label: string
  value: number | null | undefined
  worked: number | null | undefined
  onChange: (value: number | null) => void
  disabled?: boolean
}) {
  const [text, setText] = useState(value == null ? '' : String(value))
  const [previousValue, setPreviousValue] = useState(value)

  if (previousValue !== value) {
    setPreviousValue(value)
    setText(value == null ? '' : String(value))
  }

  return (
    <Input
      aria-label={label}
      inputMode="decimal"
      className="num w-20 text-right"
      value={text}
      disabled={disabled}
      placeholder={worked == null ? '' : formatAmount(worked)}
      onChange={(event) => {
        setText(event.target.value)
        const trimmed = event.target.value.trim()

        if (trimmed === '') return onChange(null)
        const number = Number(trimmed)

        if (Number.isFinite(number) && number >= 0) onChange(number)
      }}
    />
  )
}

const ReactionTableContext = createContext<
  | (Parameters<typeof ReactionTable>[0] & {
      computed: Map<string, ComputedRow>
    })
  | null
>(null)

function useReactionTable() {
  const table = useContext(ReactionTableContext)

  if (!table) throw new Error('Reaction cells require their table provider')

  return table
}

// Stable cell components keep typing focus; context supplies current render data.
function buildColumns(
  editing: boolean,
  hasDensity: boolean,
): RegistryColumn<ReactionRow>[] {
  const number = (
    field: AmountField,
    label: string,
    workedValue: (row: ComputedRow | undefined) => number | null | undefined,
  ): RegistryColumn<ReactionRow> => ({
    id: field,
    header: label,
    cell: function AmountCell({ row }) {
      const { computed, edit } = useReactionTable()
      const r = row.original
      const worked = workedValue(computed.get(r.id))

      if (!edit) {
        const typed = r[field]
        const shown = typed ?? worked

        return <span className="num">{formatAmount(shown)}</span>
      }

      return (
        <AmountInput
          label={`${label}: ${r.name || r.formula || ROLE_LABEL[r.role]}`}
          value={r[field]}
          worked={worked}
          // A drawn molecule's weight comes from the drawing.
          disabled={field === 'mw' && Boolean(r.structureCode)}
          onChange={(value) => edit.update(r.id, amountPatch(r, field, value))}
        />
      )
    },
    meta: { cellClassName: 'text-right' },
  })

  const columns: RegistryColumn<ReactionRow>[] = [
    {
      id: 'role',
      header: t('notebook.chemistry.role'),
      cell: function RoleCell({ row }) {
        const { edit } = useReactionTable()

        return edit && !row.original.structureCode ? (
          <Select
            className="w-28"
            aria-label={t('notebook.chemistry.role')}
            value={row.original.role}
            onChange={(event) =>
              edit.update(row.original.id, {
                role: z.enum(REACTION_ROLES).parse(event.target.value),
              })
            }
          >
            {REACTION_ROLES.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABEL[role]}
              </option>
            ))}
          </Select>
        ) : (
          ROLE_LABEL[row.original.role]
        )
      },
    },
    {
      id: 'name',
      header: t('notebook.chemistry.name'),
      cell: function NameCell({ row }) {
        const { edit, payload } = useReactionTable()
        const r = row.original

        return (
          <div className="flex min-w-40 flex-col">
            {edit ? (
              <Input
                aria-label={t('notebook.chemistry.name')}
                value={r.name}
                placeholder={r.formula ?? ''}
                onChange={(event) =>
                  edit.update(r.id, { name: event.target.value })
                }
              />
            ) : (
              <span className="font-medium">{r.name || r.formula || '—'}</span>
            )}
            {r.formula && (edit ? r.name === '' : r.name) ? (
              <span className="num text-label text-fg-muted">
                {r.formula}
                {!edit && limitingRow(payload)?.id === r.id
                  ? ` · ${t('notebook.chemistry.limitingYes')}`
                  : ''}
              </span>
            ) : null}
          </div>
        )
      },
    },
    number('mw', t('notebook.chemistry.mw'), () => null),
    number('equiv', t('notebook.chemistry.equiv'), (r) => r?.equiv),
    number('massMg', t('notebook.chemistry.massMg'), (r) => r?.massMg),
    number('volumeMl', t('notebook.chemistry.volumeMl'), (r) => r?.volumeMl),
    number('density', t('notebook.chemistry.density'), () => null),
    {
      id: 'mmol',
      header: t('notebook.chemistry.mmol'),
      cell: function MmolCell({ row }) {
        const { computed } = useReactionTable()

        return (
          <span className="num">
            {formatAmount(computed.get(row.original.id)?.mmol)}
          </span>
        )
      },
      meta: { cellClassName: 'text-right' },
    },
    {
      id: 'theoretical',
      header: t('notebook.chemistry.theoreticalMg'),
      cell: function TheoreticalCell({ row }) {
        const { computed } = useReactionTable()

        return (
          <span className="num">
            {row.original.role === 'product'
              ? formatAmount(computed.get(row.original.id)?.theoreticalMg)
              : ''}
          </span>
        )
      },
      meta: { cellClassName: 'text-right' },
    },
    {
      id: 'yield',
      header: t('notebook.chemistry.yield'),
      cell: function YieldCell({ row }) {
        const { computed } = useReactionTable()
        const y = computed.get(row.original.id)?.yieldPercent

        return (
          <span className="num font-semibold">
            {row.original.role === 'product' && y != null
              ? `${formatAmount(y)}%`
              : ''}
          </span>
        )
      },
      meta: { cellClassName: 'text-right' },
    },
    {
      id: 'limiting',
      header: t('notebook.chemistry.limiting'),
      cell: function LimitingCell({ row }) {
        const { edit, payload } = useReactionTable()
        const r = row.original

        if (r.role !== 'reactant') return null

        return edit ? (
          <Radio
            value={r.id}
            aria-label={t('notebook.chemistry.limitingLabel', {
              name: r.name || r.formula || ROLE_LABEL[r.role],
            })}
          />
        ) : limitingRow(payload)?.id === r.id ? (
          t('notebook.chemistry.limitingYes')
        ) : null
      },
    },
  ]

  if (!editing) {
    // The read view has no room for what only the editor needs.
    return columns.filter(
      (column) =>
        column.id !== 'limiting' && (column.id !== 'density' || hasDensity),
    )
  }

  columns.push({
    id: 'remove',
    header: '',
    cell: function RemoveCell({ row }) {
      const { edit } = useReactionTable()

      return row.original.structureCode ? null : (
        <IconButton
          label={t('notebook.chemistry.removeRow')}
          icon="trash"
          onClick={() => edit?.remove(row.original.id)}
        />
      )
    },
  })

  return columns
}

export function ReactionTable({
  payload,
  edit,
}: {
  payload: ReactionPayload
  edit?: {
    update: (id: string, patch: Partial<ReactionRow>) => void
    remove: (id: string) => void
    setLimiting: (id: string) => void
  }
}) {
  const computed = useMemo(() => computeReactionTable(payload), [payload])
  const editing = Boolean(edit)
  const hasDensity = payload.rows.some((row) => row.density != null)

  const columns = useMemo(
    () => buildColumns(editing, hasDensity),
    [editing, hasDensity],
  )

  const table = useMemo(
    () => ({ payload, computed, edit }),
    [payload, computed, edit],
  )

  const limiting = limitingRow(payload)

  const grid = (
    <ReactionTableContext value={table}>
      <TableBox>
        <RegistryGrid
          label={t('notebook.chemistry.tableLabel')}
          rows={payload.rows}
          columns={columns}
          getRowId={(row) => row.id}
          selectable={false}
          sortable={false}
        />
      </TableBox>
    </ReactionTableContext>
  )

  if (!edit) return grid

  return (
    <RadioGroup
      className="gap-0"
      value={limiting?.id ?? ''}
      onValueChange={(value) => edit.setLimiting(String(value))}
    >
      {grid}
    </RadioGroup>
  )
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

type Drawn =
  | { kind: 'structure'; molfile: string; facts: MoleculeFacts | null }
  | {
      kind: 'reaction'
      drawing: string
      smiles: string
      components: ReturnType<typeof drawnComponents>
    }

/** The chemistry editor in a dialog. It hands back what was drawn when saved. */
function DrawingDialog({
  mode,
  initial,
  open,
  onOpenChange,
  onSave,
}: {
  mode: 'structure' | 'reaction'
  initial: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (drawn: Drawn) => void
}) {
  const ocl = useOcl()
  const [host, setHost] = useState<HTMLDivElement | null>(null)
  const editor = useRef<InstanceType<Ocl['CanvasEditor']> | null>(null)
  const [changed, setChanged] = useState(false)
  useLayoutEffect(() => {
    if (!open || !ocl || !host) return

    const canvas = new ocl.CanvasEditor(host, {
      initialMode: mode === 'structure' ? 'molecule' : 'reaction',
    })

    editor.current = canvas

    if (mode === 'structure') {
      const molecule = parseMolfile(ocl, initial)

      if (molecule) canvas.setMolecule(molecule)
    } else {
      const reaction = parseReaction(ocl, initial)

      if (reaction) canvas.setReaction(reaction)
    }

    setChanged(false)
    canvas.setOnChangeListener((event) => {
      if (event.isUserEvent) setChanged(true)
    })

    return () => {
      editor.current = null
      canvas.destroy()
    }
  }, [open, ocl, host, mode, initial])

  const save = () => {
    const canvas = editor.current

    if (!canvas || !ocl) return

    if (mode === 'structure') {
      const molecule = canvas.getMolecule()
      const empty = molecule.getAllAtoms() === 0
      onSave({
        kind: 'structure',
        molfile: empty ? '' : molecule.toMolfile(),
        facts: empty ? null : factsOf(molecule),
      })
    } else {
      const drawing = encodeReaction(ocl, canvas.getReaction())
      onSave({
        kind: 'reaction',
        drawing,
        smiles: reactionSmiles(ocl, drawing),
        components: drawnComponents(ocl, drawing),
      })
    }

    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[6vh] max-h-[88vh] w-[min(1000px,calc(100vw-32px))]">
        <DialogHeader
          title={
            mode === 'structure'
              ? t('notebook.chemistry.drawStructureTitle')
              : t('notebook.chemistry.drawReactionTitle')
          }
          description={
            mode === 'structure'
              ? t('notebook.chemistry.drawStructureDescription')
              : t('notebook.chemistry.drawReactionDescription')
          }
        />
        <DialogBody>
          <div
            ref={setHost}
            data-testid="chemistry-canvas"
            className="h-[min(520px,60vh)] w-full overflow-hidden rounded-md border border-border bg-white"
          />
          {!ocl ? <Muted>{t('notebook.chemistry.loading')}</Muted> : null}
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button variant="primary" disabled={!ocl || !changed} onClick={save}>
            {t('notebook.chemistry.useDrawing')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Editors
// ---------------------------------------------------------------------------

function useChemistryAutosave<T extends BlockEditorProps['block']['payload']>(
  type: 'structure' | 'reaction',
  { block, save, offline, onStatusChange }: BlockEditorProps,
  initial: T,
  schema: z.ZodType<T>,
) {
  // Edited in place like the other blocks: while offline the page's save keeps
  // the payload on the device and sends it on reconnect.
  const { canQueue } = useOfflineEdits()

  const holdOffline =
    (offline ?? false) && !(canQueue && canEditBlockOffline(type))

  const autosave = useAutosave<T>({
    initialValue: initial,
    validate: (value) => {
      const result = validateBlock({
        type,
        payload: value,
        payloadSchemaVersion: block.payloadSchemaVersion,
      })

      return result.ok ? [] : result.errors.map((error) => error.message)
    },
    save: async (value) => {
      const result = await save(value)

      return {
        ...result,
        serverValue:
          result.serverValue === undefined
            ? undefined
            : schema.parse(result.serverValue),
      }
    },
    offline: holdOffline,
    touched: true,
  })

  useLayoutEffect(() => {
    onStatusChange?.(autosave.status)
  }, [autosave.status, onStatusChange])

  return autosave
}

function SaveNotices<T extends object>({
  autosave,
  offline,
}: {
  autosave: ReturnType<typeof useAutosave<T>>
  offline?: boolean
}) {
  return (
    <>
      {autosave.status === 'conflict' ? (
        <ConflictBanner
          message={t('notebook.chemistry.changedElsewhere')}
          serverPreview={JSON.stringify(autosave.serverValue)}
          onUseServer={autosave.discardDraft}
          onKeepLocal={autosave.retry}
        />
      ) : null}
      {autosave.error && autosave.status !== 'conflict' ? (
        <Notice
          tone="bad"
          action={
            <Button onClick={autosave.retry}>
              {t('notebook.chemistry.retry')}
            </Button>
          }
        >
          {autosave.error}
        </Notice>
      ) : null}
      {offline ? (
        <Notice>{t('notebook.chemistry.reconnectToDraw')}</Notice>
      ) : null}
    </>
  )
}

export function StructureEditor(props: BlockEditorProps) {
  const { block, readOnly, offline } = props

  const initial = useMemo(
    () => structurePayload.parse(block.payload),
    [block.payload],
  )

  const autosave = useChemistryAutosave(
    'structure',
    props,
    initial,
    structurePayload,
  )

  const [drawing, setDrawing] = useState(false)
  const draft = autosave.draft
  const ocl = useOcl()

  // Weight and formula for a drawing saved before they were kept with it.
  const facts = useMemo(
    () => (ocl && draft.molfile ? moleculeFacts(ocl, draft.molfile) : null),
    [ocl, draft.molfile],
  )

  if (readOnly) return <StructurePreview payload={block.payload} />

  const edit = (patch: Partial<StructurePayload>) =>
    autosave.setDraft((current) => ({ ...current, ...patch }))

  return (
    <section
      aria-label={t('notebook.chemistry.structureAria')}
      className="flex min-w-0 flex-col gap-3 rounded-md border border-border p-3"
    >
      <SaveNotices autosave={autosave} offline={offline} />
      <Input
        aria-label={t('notebook.chemistry.title')}
        placeholder={t('notebook.chemistry.titlePlaceholder')}
        value={draft.title ?? ''}
        autoFocus={props.autoFocus}
        onChange={(event) => edit({ title: event.target.value })}
        onBlur={autosave.flush}
      />
      <StructurePicture payload={draft} />
      <Facts
        payload={{
          ...draft,
          formula: draft.formula ?? facts?.formula,
          mw: draft.mw ?? facts?.mw,
        }}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          icon="flask"
          disabled={offline}
          onClick={() => setDrawing(true)}
        >
          {draft.molfile
            ? t('notebook.chemistry.editStructure')
            : t('notebook.chemistry.drawStructure')}
        </Button>
      </div>
      <Input
        aria-label={t('notebook.chemistry.compoundName')}
        placeholder={t('notebook.chemistry.compoundNamePlaceholder')}
        value={draft.name ?? ''}
        onChange={(event) => edit({ name: event.target.value })}
        onBlur={autosave.flush}
      />
      <Textarea
        aria-label={t('notebook.chemistry.caption')}
        placeholder={t('notebook.chemistry.captionPlaceholder')}
        rows={2}
        value={draft.caption ?? ''}
        onChange={(event) => edit({ caption: event.target.value })}
        onBlur={autosave.flush}
      />
      <DrawingDialog
        mode="structure"
        initial={draft.molfile}
        open={drawing}
        onOpenChange={setDrawing}
        onSave={(drawn) => {
          if (drawn.kind !== 'structure') return
          edit({
            molfile: drawn.molfile,
            formula: drawn.facts?.formula,
            smiles: drawn.facts?.smiles,
            mw: drawn.facts?.mw ?? null,
          })
          autosave.flush()
        }}
      />
    </section>
  )
}

export function ReactionEditor(props: BlockEditorProps) {
  const { block, readOnly, offline } = props

  const initial = useMemo(
    () => reactionPayload.parse(block.payload),
    [block.payload],
  )

  const autosave = useChemistryAutosave(
    'reaction',
    props,
    initial,
    reactionPayload,
  )

  const [drawing, setDrawing] = useState(false)
  const draft = autosave.draft

  if (readOnly) return <ReactionPreview payload={block.payload} />

  const edit = (patch: Partial<ReactionPayload>) =>
    autosave.setDraft((current) => ({ ...current, ...patch }))

  const updateRow = (id: string, patch: Partial<ReactionRow>) =>
    autosave.setDraft((current) => ({
      ...current,
      rows: current.rows.map((row) =>
        row.id === id ? { ...row, ...patch } : row,
      ),
    }))

  return (
    <section
      aria-label={t('notebook.chemistry.reactionAria')}
      className="flex min-w-0 flex-col gap-3 rounded-md border border-border p-3"
    >
      <SaveNotices autosave={autosave} offline={offline} />
      <Input
        aria-label={t('notebook.chemistry.title')}
        placeholder={t('notebook.chemistry.titlePlaceholder')}
        value={draft.title ?? ''}
        autoFocus={props.autoFocus}
        onChange={(event) => edit({ title: event.target.value })}
        onBlur={autosave.flush}
      />
      <SchemePicture payload={draft} />
      <div className="flex flex-wrap gap-2">
        <Button
          icon="flask"
          disabled={offline}
          onClick={() => setDrawing(true)}
        >
          {draft.drawing
            ? t('notebook.chemistry.editReaction')
            : t('notebook.chemistry.drawReaction')}
        </Button>
        <Button
          icon="plus"
          disabled={draft.rows.length >= MAX_REACTION_ROWS}
          onClick={() =>
            edit({
              rows: [
                ...draft.rows,
                { id: newRowId(), role: 'solvent', name: '' },
              ],
            })
          }
        >
          {t('notebook.chemistry.addRow')}
        </Button>
      </div>
      {draft.rows.length ? (
        <ReactionTable
          payload={draft}
          edit={{
            update: updateRow,
            remove: (id) =>
              autosave.setDraft((current) => ({
                ...current,
                rows: current.rows.filter((row) => row.id !== id),
                limitingId:
                  current.limitingId === id ? null : current.limitingId,
              })),
            setLimiting: (id) => edit({ limitingId: id }),
          }}
        />
      ) : (
        <Muted>{t('notebook.chemistry.noRows')}</Muted>
      )}
      <Textarea
        aria-label={t('notebook.chemistry.caption')}
        placeholder={t('notebook.chemistry.captionPlaceholder')}
        rows={2}
        value={draft.caption ?? ''}
        onChange={(event) => edit({ caption: event.target.value })}
        onBlur={autosave.flush}
      />
      <DrawingDialog
        mode="reaction"
        initial={draft.drawing}
        open={drawing}
        onOpenChange={setDrawing}
        onSave={(drawn) => {
          if (drawn.kind !== 'reaction') return
          autosave.setDraft((current) => {
            const rows = syncRowsWithDrawing(current.rows, drawn.components)

            return {
              ...current,
              drawing: drawn.drawing,
              smiles: drawn.smiles,
              rows,
              limitingId: rows.some((row) => row.id === current.limitingId)
                ? current.limitingId
                : null,
            }
          })
          autosave.flush()
        }}
      />
    </section>
  )
}
