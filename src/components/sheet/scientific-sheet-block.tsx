import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CellChange, ChangeSource, ColumnSettings } from 'handsontable'
import { FormulaReferenceEditor, columnToLetter, toA1 } from '#/components/sheet/formula-reference-editor'
import { normalizeExponentiation } from '#/lib/formula-ir'
import {
  ChevronLeft,
  ChevronRight,
  Check,
  AlertCircle,
  MoreHorizontal,
  RotateCcw,
  Settings,
} from 'lucide-react'
import type { NotebookBlock } from '#/lib/notebook-data'
import { DataClientError } from '#/lib/data-client'
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Field,
  FieldLabel,
  Input,
  Separator,
  Spinner,
  Textarea,
} from '#/components/ui'
import { SheetbaseGrid } from './sheetbase-grid'
import { ScientificApiInspector } from './scientific-api-inspector'
import { ScientificTransferPanel } from './scientific-transfer-panel'
import {
  addScientificColumn,
  applyScientificRowChanges,
  decodeScientificValue,
  fetchAllScientificRows,
  fetchScientificFormulas,
  fetchScientificDependencies,
  fetchScientificCalculationResults,
  fetchScientificTable,
  mutateScientificFormula,
  preflightScientificConversion,
  requestScientificCalculation,
  preflightScientificRetirement,
  renameScientificTable,
  scientificDataClient,
  scientificQueryKeys,
  updateScientificColumnDisplay,
} from '#/lib/scientific-sheet-data'
import type {
  ScientificColumnWire,
  FormulaDependencyWire,
  FormulaDefinitionWire,
  ScientificLogicalType,
  ScientificRowWire,
  ScientificSchemaEvidence,
  ScientificTableWire,
} from '#/lib/scientific-sheet-data'
import { SchemaBadge } from '#/components/dataset-schema/schema-badge'
import { upgradeScientificSchema } from '#/lib/dataset-schema-data'
import {
  scientificSheetName,
} from '#/lib/scientific-workbook'
import type {
  ScientificWorkbook,
  WorkbookCellAddress,
  WorkbookResult,
  WorkbookTable,
} from '#/lib/scientific-workbook'
import { createSheetbaseHyperFormula } from '#/lib/hyperformula-profile'
import type { HyperFormula } from 'hyperformula'
import { useNotebookScientificWorkbook } from '#/components/notebook/scientific-workbook-provider'

interface PendingCell {
  rowIndex: number
  rowId: string | null
  columnId: string
  fieldName: string
  raw: unknown
}

interface ChangeBatch {
  generation: number
  cells: PendingCell[]
}

interface DraftCell extends PendingCell {
  generation: number
}

interface PendingFormulaWrite {
  rowId: string
  columnId: string
  source?: string
  replacement?: unknown
  existing?: FormulaDefinitionWire
}

function persistedFormula(formula: FormulaDefinitionWire) {
  const dependencies = new Map<
    string,
    { tableId: string; rowId: string; columnId: string }
  >()
  const bindings = Array.isArray(formula.bindings) ? formula.bindings : []
  for (const value of bindings) {
    const binding = value as {
      kind?: string
      tableId?: string
      cell?: { rowId: string; columnId: string }
      members?: Array<Array<{ rowId: string; columnId: string }>>
    }
    const cells =
      binding.kind === 'cell' && binding.cell
        ? [binding.cell]
        : binding.kind === 'range'
          ? (binding.members ?? []).flat()
          : []
    for (const cell of cells) {
      const tableId = binding.tableId ?? formula.target_table_id
      dependencies.set(`${tableId}/${cell.rowId}/${cell.columnId}`, {
        tableId,
        ...cell,
      })
    }
  }
  return {
    version: 1,
    syntaxProfile: formula.syntax_profile,
    functionProfile: formula.function_profile,
    literalProfile: formula.literal_profile,
    engineVersion: formula.engine_version,
    status: formula.status,
    source: formula.source_expression,
    template: formula.template,
    bindings: formula.bindings,
    engineExpression: formula.engine_expression,
    dependencies: [...dependencies.values()].sort((a, b) =>
      `${a.rowId}/${a.columnId}`.localeCompare(`${b.rowId}/${b.columnId}`),
    ),
  }
}

function displayResult(result: WorkbookResult | null) {
  if (!result) return null
  if (result.status === 'error') return `#${result.error}!`
  return result.logical.ok ? result.logical.value : `#${result.logical.code}!`
}

/**
 * Guard `ScientificWorkbook.get` against a stale workbook. The workbook is
 * rebuilt asynchronously (a `setTimeout(0)` in the workbook provider) when
 * table data changes, so a `tableWorkbook` reference held across a render can
 * briefly predate the row/column identity it is asked to look up. An
 * unguarded `locate()` throws `Unknown stable cell identity.` and crashes
 * render, which cascades into Handsontable's destroy path (`Cannot read
 * properties of undefined (reading 'off')`). Returning `null` lets the UI
 * degrade gracefully until the rebuilt workbook arrives.
 *
 * Exported for unit testing.
 */
export function safeWorkbookGet(
  workbook: ScientificWorkbook,
  address: WorkbookCellAddress,
): WorkbookResult | null {
  try {
    return workbook.get(address)
  } catch {
    return null
  }
}

/**
 * Small save-status indicator for the grid footer. Shows Saved (green check),
 * Saving… (spinner), or Save failed (red, with retry). Only visible when the
 * mutation has been triggered at least once — idle state is hidden to avoid
 * clutter on initial load.
 */
function SaveStatusIndicator({
  isPending,
  isError,
  isSuccess,
  onRetry,
}: {
  isPending: boolean
  isError: boolean
  isSuccess: boolean
  onRetry: () => void
}) {
  if (isPending)
    return (
      <span
        className="flex items-center gap-1 text-muted-foreground"
        aria-label="Saving"
      >
        <Spinner className="size-3" />
        Saving…
      </span>
    )
  if (isError)
    return (
      <span
        className="flex items-center gap-1 text-destructive"
        aria-label="Save failed"
      >
        <AlertCircle className="size-3" />
        Save failed
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-5 px-1.5 text-[10px] text-destructive"
          onClick={onRetry}
        >
          <RotateCcw className="size-3" />
          Retry
        </Button>
      </span>
    )
  if (isSuccess)
    return (
      <span
        className="flex items-center gap-1 text-success-foreground"
        aria-label="Saved"
      >
        <Check className="size-3" />
        Saved
      </span>
    )
  return null
}

const LOGICAL_TYPES: ScientificLogicalType[] = [
  'text',
  'integer',
  'decimal',
  'boolean',
  'date',
  'timestamp',
  'category',
]

/** Native `<select>` styled to match the design-system input. There is no
 * shadcn Select primitive in this project, so we style the native control with
 * the same tokens as `Input`. */
const selectClass =
  'h-8 rounded-md border border-input bg-background px-2 text-xs shadow-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50'

/** Native checkbox styled to match the design system (no Checkbox primitive). */
const checkboxClass =
  'size-4 rounded border-input text-primary accent-primary focus-visible:ring-2 focus-visible:ring-ring/50'

type Confirmation =
  | {
      kind: 'convert'
      column: ScientificColumnWire
      evidence: ScientificSchemaEvidence
    }
  | {
      kind: 'retire'
      column: ScientificColumnWire
      evidence: ScientificSchemaEvidence
    }

function parseJsonObject(value: string, label: string) {
  if (!value.trim()) return {}
  const parsed: unknown = JSON.parse(value)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error(`${label} must be a JSON object.`)
  return parsed as Record<string, unknown>
}

function typedDefault(type: ScientificLogicalType, value: string) {
  if (type === 'text' || type === 'date' || type === 'timestamp') return value
  if (type === 'boolean') {
    if (value !== 'true' && value !== 'false')
      throw new Error('Boolean default must be true or false.')
    return value === 'true'
  }
  const number = Number(value)
  if (
    !Number.isFinite(number) ||
    (type === 'integer' && !Number.isSafeInteger(number)) ||
    (type === 'decimal' && value.replace(/[^0-9]/g, '').length > 15)
  )
    throw new Error(`Default must be a valid ${type}.`)
  return number
}

function SchemaConfigurator({
  table,
  tableId,
  readOnly,
  draftColumnIds,
  rowMutationPending,
  formulaDependencies,
  onSuccess,
}: {
  table: ScientificTableWire
  tableId: string
  readOnly: boolean
  draftColumnIds: Set<string>
  rowMutationPending: boolean
  formulaDependencies: FormulaDependencyWire[]
  onSuccess: () => Promise<void>
}) {
  const [name, setName] = useState(table.name)
  const [label, setLabel] = useState('')
  const [type, setType] = useState<ScientificLogicalType>('text')
  const [nullable, setNullable] = useState(true)
  const [hasDefault, setHasDefault] = useState(false)
  const [defaultText, setDefaultText] = useState('')
  const [unit, setUnit] = useState('')
  const [validation, setValidation] = useState('')
  const [options, setOptions] = useState('')
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const [status, setStatus] = useState('')
  const version = useRef(table.schema_version)

  useEffect(() => {
    version.current = Math.max(version.current, table.schema_version)
  }, [table.schema_version])

  const schemaMutation = useMutation({
    scope: { id: `scientific-table:${tableId}` },
    mutationFn: async (run: (schemaVersion: number) => Promise<unknown>) => {
      setStatus('Migration in progress…')
      return run(version.current)
    },
    onSuccess: async () => {
      version.current += 1
      setConfirmation(null)
      await onSuccess()
      setStatus('Schema updated successfully.')
    },
    onError: async (error) => {
      setStatus(
        `Could not update schema. ${error instanceof Error ? error.message : 'Please retry.'}`,
      )
      if (
        error instanceof DataClientError &&
        (error.code === 'service_unavailable' || error.code === 'stale_version')
      )
        await onSuccess()
    },
  })
  const disabled = readOnly || schemaMutation.isPending

  const addColumn = () => {
    try {
      if (!label.trim()) throw new Error('Column label is required.')
      const optionValues =
        type === 'category'
          ? options
              .split('\n')
              .map((value) => value.trim())
              .filter(Boolean)
              .map((optionLabel) => ({
                id: crypto.randomUUID(),
                label: optionLabel,
              }))
          : undefined
      if (
        optionValues &&
        new Set(optionValues.map((option) => option.label)).size !==
          optionValues.length
      )
        throw new Error('Category option labels must be unique.')
      let defaultValue: unknown
      if (hasDefault) {
        defaultValue =
          type === 'category'
            ? optionValues?.find((option) => option.label === defaultText)?.id
            : typedDefault(type, defaultText)
        if (defaultValue === undefined)
          throw new Error(
            'Category default must exactly match an option label.',
          )
        if (defaultValue === null && !nullable)
          throw new Error('A required column cannot use a null default.')
      }
      const parsedUnit = unit.trim() ? parseJsonObject(unit, 'Unit') : undefined
      const parsedValidation = parseJsonObject(validation, 'Validation')
      schemaMutation.mutate((schemaVersion) =>
        addScientificColumn(scientificDataClient, tableId, schemaVersion, {
          label: label.trim(),
          logicalType: type,
          nullable,
          ...(hasDefault ? { defaultValue } : {}),
          unit: parsedUnit,
          validation: parsedValidation,
          options: optionValues,
        }),
      )
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Invalid column.')
    }
  }

  return (
    <div className="space-y-5">
      <DialogHeader>
        <DialogTitle className="font-display">Configure sheet</DialogTitle>
        <DialogDescription>
          Rename the sheet, add columns, and manage units, validation and schema
          lifecycle. Display labels can change; stable identities remain.
        </DialogDescription>
      </DialogHeader>

      {formulaDependencies.length ? (
        <p className="text-xs text-warning-foreground" role="status">
          {new Set(formulaDependencies.map((item) => item.formula_id)).size}{' '}
          persisted formula(s) depend on this sheet
        </p>
      ) : null}

      <Field>
        <FieldLabel htmlFor="sheet-name">Sheet name</FieldLabel>
        <div className="flex items-center gap-2">
          <Input
            id="sheet-name"
            aria-label="Sheet name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="max-w-sm"
          />
          <Button
            type="button"
            size="sm"
            variant="subtle"
            disabled={disabled || !name.trim() || name === table.name}
            onClick={() =>
              schemaMutation.mutate((v) =>
                renameScientificTable(
                  scientificDataClient,
                  tableId,
                  v,
                  name.trim(),
                ),
              )
            }
          >
            Save name
          </Button>
        </div>
      </Field>

      <Separator />

      <div className="space-y-3">
        <FieldLabel>Add column</FieldLabel>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="new-col-label">Label</FieldLabel>
            <Input
              id="new-col-label"
              aria-label="New column label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="new-col-type">Type</FieldLabel>
            <select
              id="new-col-type"
              aria-label="New column type"
              className={selectClass}
              value={type}
              onChange={(e) => setType(e.target.value as ScientificLogicalType)}
            >
              {LOGICAL_TYPES.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-xs">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className={checkboxClass}
              checked={!nullable}
              onChange={(e) => setNullable(!e.target.checked)}
            />
            Required
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className={checkboxClass}
              checked={hasDefault}
              onChange={(e) => setHasDefault(e.target.checked)}
            />
            Set default
          </label>
          {hasDefault ? (
            <Input
              aria-label="Typed default"
              value={defaultText}
              onChange={(e) => setDefaultText(e.target.value)}
              className="h-8 max-w-48"
            />
          ) : null}
        </div>
        {type === 'category' ? (
          <Field>
            <FieldLabel htmlFor="cat-options">
              Category options (one per line)
            </FieldLabel>
            <Textarea
              id="cat-options"
              aria-label="Category options"
              value={options}
              onChange={(e) => setOptions(e.target.value)}
              className="min-h-24"
            />
          </Field>
        ) : null}
        <details className="rounded-md border bg-muted/20 p-2 text-xs">
          <summary className="cursor-pointer font-medium text-muted-foreground">
            Advanced · custom JSON
          </summary>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="unit-json">Unit JSON</FieldLabel>
              <Textarea
                id="unit-json"
                aria-label="Unit JSON"
                placeholder='{"code":"mg","symbol":"mg"}'
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className="min-h-20 font-mono"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="validation-json">Validation JSON</FieldLabel>
              <Textarea
                id="validation-json"
                aria-label="Validation JSON"
                placeholder='{"min":0}'
                value={validation}
                onChange={(e) => setValidation(e.target.value)}
                className="min-h-20 font-mono"
              />
            </Field>
          </div>
        </details>
        <Button type="button" size="sm" disabled={disabled} onClick={addColumn}>
          Add column
        </Button>
      </div>

      <Separator />

      <div className="space-y-2">
        <FieldLabel>Columns</FieldLabel>
        <ol className="space-y-1.5" aria-label="Columns">
          {table.columns.map((column, index) => (
            <li
              key={column.id}
              className="flex flex-wrap items-center gap-2 rounded-md border bg-card/40 p-2"
            >
              <Input
                aria-label={`Label for ${column.label}`}
                defaultValue={column.label}
                onBlur={(e) => {
                  if (e.target.value !== column.label)
                    schemaMutation.mutate((v) =>
                      updateScientificColumnDisplay(
                        scientificDataClient,
                        column.id,
                        v,
                        e.target.value,
                        null,
                      ),
                    )
                }}
                className="h-8 min-w-36 flex-1"
              />
              <Badge variant="secondary">{column.logical_type}</Badge>
              <Badge variant="outline">
                {column.nullable ? 'nullable' : 'required'}
              </Badge>
              <select
                aria-label={`Convert ${column.label}`}
                defaultValue=""
                className={selectClass}
                disabled={
                  disabled ||
                  rowMutationPending ||
                  draftColumnIds.has(column.id)
                }
                onChange={async (e) => {
                  const next = e.target.value
                  e.target.value = ''
                  if (!next) return
                  try {
                    setStatus('Checking conversion consequences…')
                    const evidence = await preflightScientificConversion(
                      scientificDataClient,
                      column.id,
                      version.current,
                      next as ScientificLogicalType,
                    )
                    setConfirmation({
                      kind: 'convert',
                      column,
                      evidence: evidence as ScientificSchemaEvidence,
                    })
                    setStatus('Review and confirm the conversion.')
                  } catch (error) {
                    setStatus(
                      `Conversion rejected. ${error instanceof Error ? error.message : ''}`,
                    )
                  }
                }}
              >
                <option value="">Convert…</option>
                {LOGICAL_TYPES.filter(
                  (value) => value !== column.logical_type,
                ).map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Move left"
                disabled={disabled || index === 0}
                onClick={() =>
                  schemaMutation.mutate((v) =>
                    updateScientificColumnDisplay(
                      scientificDataClient,
                      column.id,
                      v,
                      null,
                      index,
                    ),
                  )
                }
              >
                <ChevronLeft className="size-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Move right"
                disabled={disabled || index === table.columns.length - 1}
                onClick={() =>
                  schemaMutation.mutate((v) =>
                    updateScientificColumnDisplay(
                      scientificDataClient,
                      column.id,
                      v,
                      null,
                      index + 2,
                    ),
                  )
                }
              >
                <ChevronRight className="size-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={
                  disabled ||
                  rowMutationPending ||
                  draftColumnIds.has(column.id)
                }
                onClick={async () => {
                  try {
                    setStatus('Checking retirement consequences…')
                    const evidence = await preflightScientificRetirement(
                      scientificDataClient,
                      column.id,
                      version.current,
                    )
                    setConfirmation({
                      kind: 'retire',
                      column,
                      evidence: evidence as ScientificSchemaEvidence,
                    })
                    setStatus('Review and confirm retirement.')
                  } catch (error) {
                    setStatus(
                      `Retirement check failed. ${error instanceof Error ? error.message : ''}`,
                    )
                  }
                }}
              >
                Retire
              </Button>
            </li>
          ))}
        </ol>
        {rowMutationPending || draftColumnIds.size > 0 ? (
          <p role="status" className="text-xs text-warning-foreground">
            Save or discard pending row changes before converting or retiring
            columns.
          </p>
        ) : null}
      </div>

      {confirmation ? (
        <div
          role="alertdialog"
          aria-label="Confirm schema change"
          className="space-y-2 rounded-md border border-destructive/50 bg-destructive/5 p-3 text-xs"
        >
          <strong className="font-medium">
            Confirm {confirmation.kind} of {confirmation.column.label}
          </strong>
          <p>
            Non-null rows: {confirmation.evidence.nonNullRows ?? 'n/a'} ·
            Invalid rows: {confirmation.evidence.invalidRows ?? 'n/a'} · Formula
            markers: {confirmation.evidence.formulaMarkers} · Referencing
            formulas:{' '}
            {
              new Set(
                formulaDependencies
                  .filter(
                    (item) => item.source_column_id === confirmation.column.id,
                  )
                  .map((item) => item.formula_id),
              ).size
            }
          </p>
          <p className="text-muted-foreground">
            This can affect formulas and API clients. The stable field remains{' '}
            {confirmation.column.field_name}.
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={
                disabled ||
                rowMutationPending ||
                draftColumnIds.has(confirmation.column.id) ||
                (confirmation.kind === 'convert' &&
                  ((confirmation.evidence.invalidRows ?? 0) > 0 ||
                    confirmation.evidence.formulaMarkers > 0))
              }
              onClick={() =>
                schemaMutation.mutate(() =>
                  confirmation.kind === 'convert'
                    ? preflightScientificConversion(
                        scientificDataClient,
                        confirmation.column.id,
                        confirmation.evidence.schemaVersion,
                        confirmation.evidence.targetType!,
                        confirmation.evidence.hash,
                      )
                    : preflightScientificRetirement(
                        scientificDataClient,
                        confirmation.column.id,
                        confirmation.evidence.schemaVersion,
                        confirmation.evidence.hash,
                      ),
                )
              }
            >
              Confirm change
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() => {
                setConfirmation(null)
                setStatus('Schema change cancelled.')
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {status ? (
        <p role="status" className="text-xs">
          {status}
        </p>
      ) : null}

      <Separator />

      <details className="rounded-md border bg-muted/20 p-2 text-xs text-muted-foreground">
        <summary className="cursor-pointer font-medium">Developer info</summary>
        <div className="mt-2 space-y-2">
          <p>
            API resource{' '}
            <code className="font-mono">{table.resource_name}</code> · stable
            table <code className="font-mono">{table.id}</code>
          </p>
          <p>
            Display labels may change; UUIDs and generated API names remain
            stable.
          </p>
          <ul className="space-y-1 font-mono">
            {table.columns.map((column) => (
              <li key={column.id}>
                {column.label}: <span>{column.field_name}</span> · {column.id}
              </li>
            ))}
          </ul>
        </div>
      </details>
    </div>
  )
}

/**
 * Built-in context-menu item keys for the editable scientific sheet. Only
 * operations that are backed by the data model are included — column
 * insert/remove and read-only toggle are omitted because they would mutate
 * Handsontable locally without persisting. Custom items (clear contents,
 * configure columns) are added in the settings memo where they can access
 * component state.
 */
const GRID_CONTEXT_MENU_ITEMS: readonly string[] = Object.freeze([
  'row_above',
  'row_below',
  '---------',
  'remove_row',
  '---------',
  'cut',
  'copy',
  'paste',
  '---------',
  'undo',
  'redo',
])

function columnSettings(
  column: ScientificColumnWire,
  readOnly: boolean,
): ColumnSettings {
  const base: ColumnSettings = { data: column.field_name }
  // Use the formula reference editor for editable columns so users can
  // point-and-click cell references while entering formulas (type =, click a
  // cell → its A1 reference is inserted). Read-only mode keeps the default
  // editor since no editing occurs. Pass the class directly (not a string
  // name) to bypass Handsontable's global editor registry, which may not
  // resolve correctly across dynamically-imported bundles.
  const formulaEditor = !readOnly ? { editor: FormulaReferenceEditor } : {}
  if (column.logical_type === 'integer' || column.logical_type === 'decimal')
    return { ...base, type: 'numeric', ...formulaEditor }
  if (column.logical_type === 'boolean') return { ...base, type: 'checkbox' }
  if (column.logical_type === 'date')
    return {
      ...base,
      type: 'date',
      dateFormat: 'YYYY-MM-DD',
      correctFormat: false,
    }
  if (column.logical_type === 'category')
    return {
      ...base,
      type: 'dropdown',
      source: column.options.map((o) => o.label),
    }
  return { ...base, type: 'text', ...formulaEditor }
}

export function ScientificSheetBlock({
  block,
  readOnly = false,
}: {
  block: NotebookBlock
  readOnly?: boolean
}) {
  const tableId =
    typeof block.payload.tableId === 'string' ? block.payload.tableId : ''
  const [issues, setIssues] = useState<Array<{ key: string; message: string }>>(
    [],
  )
  const [drafts, setDrafts] = useState<Record<string, DraftCell>>({})
  const [selected, setSelected] = useState<WorkbookCellAddress | null>(null)
  const [selectedCoords, setSelectedCoords] = useState<{
    row: number
    col: number
  } | null>(null)
  const [configurationOpen, setConfigurationOpen] = useState(false)
  const [transferOpen, setTransferOpen] = useState(false)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [formulaSource, setFormulaSource] = useState('')
  const [formulaStatus, setFormulaStatus] = useState('')
  const [exponentHint, setExponentHint] = useState(false)
  const nextGeneration = useRef(0)
  const queryClient = useQueryClient()
  const tableQuery = useQuery({
    queryKey: scientificQueryKeys.table(tableId),
    queryFn: () => fetchScientificTable(scientificDataClient, tableId),
    enabled: !!tableId,
  })
  const table = tableQuery.data
  // SCI-010: upgrade the bound sheet to a newer published schema revision.
  const upgradeMutation = useMutation({
    mutationFn: async (targetRevision: number) => {
      if (!table) throw new Error('Table not loaded.')
      return upgradeScientificSchema(
        scientificDataClient,
        table.id,
        targetRevision,
      )
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: scientificQueryKeys.table(tableId),
      })
      await queryClient.invalidateQueries({
        queryKey: scientificQueryKeys.allRows(tableId),
      })
    },
  })
  const allRowsKey = scientificQueryKeys.allRows(tableId)
  const allRowsQuery = useQuery({
    queryKey: allRowsKey,
    queryFn: () => fetchAllScientificRows(scientificDataClient, table!),
    enabled: !!table,
  })
  const formulasQuery = useQuery({
    queryKey: scientificQueryKeys.formulas(tableId),
    queryFn: () => fetchScientificFormulas(scientificDataClient, tableId),
    enabled: !!table,
  })
  const dependenciesQuery = useQuery({
    queryKey: scientificQueryKeys.dependencies(tableId),
    queryFn: () => fetchScientificDependencies(scientificDataClient, tableId),
    enabled: !!tableId && configurationOpen,
  })
  const calculationResultsQuery = useQuery({
    queryKey: scientificQueryKeys.calculationResults(tableId),
    queryFn: () =>
      fetchScientificCalculationResults(scientificDataClient, tableId),
    enabled:
      !!tableId &&
      !!selected &&
      !!formulasQuery.data?.some(
        (formula) =>
          formula.target_row_id === selected.rowId &&
          formula.target_column_id === selected.columnId,
      ),
  })
  const formulaByCell = useMemo(
    () =>
      new Map(
        (formulasQuery.data ?? []).map((formula) => [
          `${formula.target_row_id}/${formula.target_column_id}`,
          formula,
        ]),
      ),
    [formulasQuery.data],
  )
  const workbookTable = useMemo<WorkbookTable | null>(() => {
    if (!table || !allRowsQuery.data || !formulasQuery.data) return null
    if (allRowsQuery.data.length > 10_000) return null
    try {
      return {
        id: table.id,
        name: table.name,
        columns: table.columns.map((column) => ({
          id: column.id,
          label: column.label,
          createdAt:
            column.created_at ?? table.created_at ?? '1970-01-01T00:00:00Z',
          logicalType: column.logical_type,
          categoryOptionIds: column.options.map((option) => option.id),
        })),
        rows: allRowsQuery.data.map((row) => ({
          id: row.id,
          createdAt: row.created_at ?? '1970-01-01T00:00:00Z',
          cells: Object.fromEntries(
            table.columns.map((column) => {
              const formula = formulaByCell.get(`${row.id}/${column.id}`)
              return [
                column.id,
                {
                  literal: row[column.field_name],
                  ...(formula ? { formula: persistedFormula(formula) } : {}),
                },
              ]
            }),
          ),
        })),
      }
    } catch (error) {
      // Persisted artifacts are untrusted wire data. A malformed artifact must
      // disable calculation without preventing literal grid access.
      void error
      return null
    }
  }, [allRowsQuery.data, formulaByCell, formulasQuery.data, table])
  const workbook = useNotebookScientificWorkbook(block.id, workbookTable)
  const tableWorkbook = workbook?.hasTable(tableId) ? workbook : null
  // Dedicated HyperFormula engine for the Handsontable formulas plugin.
  // We can't share the ScientificWorkbook engine because it gets rebuilt/
  // destroyed when query data changes, while Handsontable retains the
  // reference. This dedicated instance lives for the lifetime of this table
  // and is configured with the Sheetbase profile (correct functions, date
  // handling, precision, etc.). The formulas plugin syncs grid data into
  // this engine automatically.
  const gridEngine = useMemo<HyperFormula | null>(() => {
    if (!table) return null
    return createSheetbaseHyperFormula()
  }, [table?.id])
  // Destroy the engine when the table changes or the component unmounts.
  useEffect(() => {
    const engine = gridEngine
    if (!engine) return
    return () => {
      engine.destroy()
    }
  }, [gridEngine])

  const calculationProblem =
    (allRowsQuery.data?.length ?? 0) > 10_000
      ? 'Calculation is unavailable because this sheet exceeds 10,000 rows.'
      : allRowsQuery.isError || formulasQuery.isError
        ? 'Calculation data could not be loaded. Literal editing remains available.'
        : formulasQuery.data && allRowsQuery.data && !workbookTable
          ? 'Persisted formula data is invalid. Calculation is disabled to protect scientific meaning.'
          : null
  const selectedFormula = selected
    ? formulaByCell.get(`${selected.rowId}/${selected.columnId}`)
    : undefined
  useEffect(() => {
    setFormulaSource(selectedFormula?.source_expression ?? '')
    setFormulaStatus('')
  }, [selected, selectedFormula])
  // Auto-dismiss the ** → ^ conversion hint after 4 seconds.
  useEffect(() => {
    if (!exponentHint) return
    const timer = setTimeout(() => setExponentHint(false), 4000)
    return () => clearTimeout(timer)
  }, [exponentHint])
  const refreshCalculation = async (reconcileRows = false) => {
    // Literal edits update the all-rows cache optimistically in onSuccess; do
    // not refetch them here or rapid successive edits would read a stale
    // reverted version. Only formula writes (which advance row versions
    // server-side without returning a row) and explicit recalculation need to
    // reconcile the canonical rows.
    await Promise.all([
      ...(reconcileRows
        ? [
            queryClient.invalidateQueries({
              queryKey: allRowsKey,
            }),
          ]
        : []),
      queryClient.invalidateQueries({
        queryKey: scientificQueryKeys.formulas(tableId),
      }),
    ])
    try {
      await requestScientificCalculation(block.recordId)
      await queryClient.invalidateQueries({
        queryKey: scientificQueryKeys.calculationResults(tableId),
      })
    } catch (error) {
      setFormulaStatus(
        error instanceof Error
          ? error.message
          : 'Trusted calculation did not complete.',
      )
    }
  }

  /**
   * Commit the formula bar's current text to the selected cell via
   * `mutateScientificFormula` (create or update), then trigger recalculation.
   * Called when the user presses Enter in the formula input. Errors are
   * surfaced through `formulaStatus`.
   */
  const commitFormula = useCallback(async () => {
    if (!selected || !table) return
    if (!formulaSource.startsWith('=')) return
    const normalized = normalizeExponentiation(formulaSource)
    if (normalized !== formulaSource) {
      setFormulaSource(normalized)
      setExponentHint(true)
    }
    const row = (allRowsQuery.data ?? []).find(
      (item) => item.id === selected.rowId,
    )
    if (!row) {
      setFormulaStatus('Save the row before adding a formula.')
      return
    }
    try {
      await mutateScientificFormula({
        operation: selectedFormula ? 'update' : 'create',
        target: selected,
        expectedSchemaVersion: table.schema_version,
        expectedRowVersion: row.version,
        ...(selectedFormula
          ? { expectedFormulaVersion: Number(selectedFormula.version) }
          : {}),
        source: normalized,
      } as Parameters<typeof mutateScientificFormula>[0])
      setFormulaStatus('')
      await refreshCalculation(true)
    } catch (error) {
      setFormulaStatus(
        error instanceof Error ? error.message : 'Could not save the formula.',
      )
    }
  }, [
    selected,
    table,
    formulaSource,
    selectedFormula,
    allRowsQuery.data,
    refreshCalculation,
  ])

  // HOT mutates its data. Never expose canonical query-cache objects.
  const localRows = useMemo(() => {
    const detached: Array<Record<string, unknown>> = (allRowsQuery.data ?? []).map(
      (row) => {
        const copy = { ...row }
        for (const column of table?.columns ?? [])
          if (column.logical_type === 'category')
            copy[column.field_name] =
              column.options.find((o) => o.id === row[column.field_name])
                ?.label ?? row[column.field_name]
        return copy
      },
    )
    for (const draft of Object.values(drafts)) {
      const rowIndex = draft.rowId
        ? detached.findIndex((row) => row.id === draft.rowId)
        : draft.rowIndex
      if (rowIndex < 0) continue
      detached[rowIndex] ??= {}
      detached[rowIndex][draft.fieldName] = draft.raw
    }
    if (tableWorkbook)
      for (const row of detached) {
        if (typeof row.id !== 'string') continue
        for (const column of table?.columns ?? []) {
          const formula = formulaByCell.get(`${row.id}/${column.id}`)
          if (formula) {
            // Inject the engine expression so the Handsontable formulas
            // plugin recognises the cell as a formula and computes it
            // inline. Only same-sheet formulas (no `!` cross-sheet prefix)
            // can be computed by the Handsontable-owned engine; cross-sheet
            // formulas fall back to the pre-computed workbook result.
            const isSameSheet =
              formula.status === 'supported' &&
              !!formula.engine_expression &&
              !formula.engine_expression.includes('!')
            if (isSameSheet)
              row[column.field_name] = formula.engine_expression
            else
              row[column.field_name] = displayResult(
                safeWorkbookGet(tableWorkbook, {
                  tableId,
                  rowId: row.id,
                  columnId: column.id,
                }),
              )
          }
        }
      }
    return detached
  }, [drafts, formulaByCell, allRowsQuery.data, table, tableId, tableWorkbook])
  const mutation = useMutation({
    scope: { id: `scientific-table:${tableId}` },
    mutationFn: async (batch: ChangeBatch) => {
      if (readOnly || !table) return []
      const canonical =
        queryClient.getQueryData<ScientificRowWire[]>(allRowsKey) ?? []
      const canonicalById = new Map(canonical.map((row) => [row.id, row]))
      const edits = new Map<
        string,
        {
          rowId: string
          expectedVersion: number
          values: Record<string, unknown>
        }
      >()
      const inserts = new Map<number, Record<string, unknown>>()
      const formulaWrites: PendingFormulaWrite[] = []
      const errors: Array<{ key: string; message: string }> = []
      const formulaCells = batch.cells.filter((cell) => {
        const existing = cell.rowId
          ? formulaByCell.has(`${cell.rowId}/${cell.columnId}`)
          : false
        return (
          existing || (typeof cell.raw === 'string' && cell.raw.startsWith('='))
        )
      })
      if (formulaCells.length && batch.cells.length !== 1) {
        setIssues([
          {
            key: 'formula-batch',
            message:
              'Formula changes must be entered one cell at a time so the edit is atomic.',
          },
        ])
        throw Object.assign(new Error('Formula batch is not supported.'), {
          localValidation: true,
        })
      }
      for (const cell of batch.cells) {
        const { rowIndex, rowId, columnId, raw } = cell
        const column = table.columns.find((c) => c.id === columnId)
        if (!column) continue
        const row = rowId ? canonicalById.get(rowId) : undefined
        const existingFormula = row
          ? formulaByCell.get(`${row.id}/${column.id}`)
          : undefined
        if (typeof raw === 'string' && raw.startsWith('=')) {
          if (!row) {
            errors.push({
              key: `${rowIndex}:${column.id}`,
              message: 'Save the row before adding a formula.',
            })
          } else {
            formulaWrites.push({
              rowId: row.id,
              columnId,
              source: normalizeExponentiation(raw),
              existing: existingFormula,
            })
          }
          continue
        }
        let value: unknown
        try {
          value = decodeScientificValue(column, raw)
        } catch (error) {
          errors.push({
            key: `${rowIndex}:${column.id}`,
            message: error instanceof Error ? error.message : 'Invalid value.',
          })
          continue
        }
        if (row) {
          if (existingFormula) {
            formulaWrites.push({
              rowId: row.id,
              columnId,
              replacement: value,
              existing: existingFormula,
            })
            continue
          }
          const edit = edits.get(row.id) ?? {
            rowId: row.id,
            expectedVersion: row.version,
            values: {},
          }
          edit.values[column.id] = value
          edits.set(row.id, edit)
        } else {
          inserts.set(rowIndex, {
            ...(inserts.get(rowIndex) ?? {}),
            [column.id]: value,
          })
        }
      }
      if (errors.length) {
        setIssues(errors)
        throw Object.assign(new Error('Some cells are invalid.'), {
          localValidation: true,
        })
      }
      let changedRows: ScientificRowWire[] = []
      if (edits.size || inserts.size) {
        const result = await applyScientificRowChanges(
          scientificDataClient,
          table.id,
          table.schema_version,
          [...edits.values()],
          [...inserts.values()],
        )
        if (!result.ok) {
          setIssues(
            result.errors.map((e) => ({
              key: `${e.rowId}:${e.columnId}`,
              message: e.message,
            })),
          )
          throw Object.assign(new Error('Some cells were rejected.'), {
            validation: true,
          })
        }
        changedRows = result.rows
      }
      // Row edits run first. Formula writes then advance each target row's
      // optimistic version one at a time, so a paste containing literals and
      // several formulas in the same row cannot submit stale versions.
      const rowVersions = new Map(
        canonical.map((row) => [row.id, Number(row.version)]),
      )
      for (const row of changedRows)
        rowVersions.set(row.id, Number(row.version))
      for (const formula of formulaWrites) {
        const expectedRowVersion = rowVersions.get(formula.rowId)
        if (expectedRowVersion === undefined) continue
        await mutateScientificFormula(
          formula.source
            ? ({
                operation: formula.existing ? 'update' : 'create',
                target: {
                  tableId: table.id,
                  rowId: formula.rowId,
                  columnId: formula.columnId,
                },
                expectedSchemaVersion: table.schema_version,
                expectedRowVersion,
                ...(formula.existing
                  ? {
                      expectedFormulaVersion: Number(formula.existing.version),
                    }
                  : {}),
                source: formula.source,
              } as Parameters<typeof mutateScientificFormula>[0])
            : {
                operation: 'remove',
                target: {
                  tableId: table.id,
                  rowId: formula.rowId,
                  columnId: formula.columnId,
                },
                expectedSchemaVersion: table.schema_version,
                expectedRowVersion,
                expectedFormulaVersion: Number(formula.existing!.version),
                replacement: formula.replacement,
              },
        )
        rowVersions.set(formula.rowId, expectedRowVersion + 1)
      }
      return changedRows
    },
    onSuccess: (rows, batch) => {
      queryClient.setQueryData<ScientificRowWire[]>(allRowsKey, (old = []) => {
        const map = new Map(old.map((r) => [r.id, r]))
        for (const row of rows) map.set(row.id, row)
        return [...map.values()]
      })
      setDrafts((current) => {
        const next = { ...current }
        for (const cell of batch.cells) {
          const key = `${cell.rowId ?? `new:${cell.rowIndex}`}:${cell.columnId}`
          // The draft may have been discarded or replaced while this request
          // was in flight; keep the optional lookup intentionally.
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          if (next[key]?.generation === batch.generation) delete next[key]
        }
        return next
      })
      setIssues([])
      const formulaChanged = batch.cells.some(
        (cell) =>
          (typeof cell.raw === 'string' && cell.raw.startsWith('=')) ||
          (!!cell.rowId && formulaByCell.has(`${cell.rowId}/${cell.columnId}`)),
      )
      // Formula writes advance the generated row version without returning a
      // row. Literal writes already update the page from the RPC response.
      void refreshCalculation(formulaChanged)
    },
    onError: (error, batch) => {
      if (!(error as { localValidation?: boolean }).localValidation)
        void queryClient.invalidateQueries({
          queryKey: allRowsKey,
        })
      if (error instanceof DataClientError && error.code === 'stale_version') {
        const affected = new Map<string, { key: string; message: string }>()
        for (const cell of batch.cells) {
          const rowKey = cell.rowId ?? `new:${cell.rowIndex}`
          affected.set(rowKey, {
            key: `${rowKey}:conflict`,
            message: `Row ${cell.rowIndex + 1} changed elsewhere. Your entered values remain in the grid.`,
          })
        }
        setIssues([...affected.values()])
      }
    },
  })
  // Memoize columns, colHeaders, and formulas config so they don't get new
  // object references on every re-render. Without this, React reconciliation
  // (e.g. setSelected from afterSelectionEnd) would give HotTable "changed"
  // props and reinitialize the grid, killing the cell editor.
  const gridColumns = useMemo(
    () => table?.columns.map((col) => columnSettings(col, readOnly)) ?? [],
    [table?.columns, readOnly],
  )
  const gridColHeaders = useMemo(
    () =>
      table?.columns.map(
        (c, index) => {
          const letter = columnToLetter(index)
          const unitSuffix =
            c.unit && typeof c.unit === 'object' && 'symbol' in c.unit
              ? ` (${String(c.unit.symbol)})`
              : ''
          return `${letter} · ${c.label}${unitSuffix}`
        },
      ) ?? [],
    [table?.columns],
  )
  const formulasConfig = useMemo(
    () => {
      if (!gridEngine || !table) return undefined
      try {
        return {
          engine: gridEngine,
          sheetName: scientificSheetName(table.id),
        }
      } catch {
        return undefined
      }
    },
    [gridEngine, table?.id],
  )
  // Memoize the afterChange handler so it doesn't get a new function
  // reference on every render (which would reconfigure the grid).
  const handleAfterChange = useCallback(
    (changes: CellChange[] | null, source: ChangeSource) => {
      if (readOnly || !changes || source === 'loadData') return
      // Skip formula strings recalculated by the formulas plugin from
      // internal operations — only persist user-initiated edits.
      if (source === 'auto') return
      const generation = ++nextGeneration.current
      const cells: PendingCell[] = changes.flatMap(
        ([rowIndex, property, , raw]) => {
          const column = table!.columns.find(
            (candidate) => candidate.field_name === String(property),
          )
          if (!column) return []
          const rowId =
            typeof localRows[rowIndex]?.id === 'string'
              ? String(localRows[rowIndex].id)
              : null
          return [
            {
              rowIndex,
              rowId,
              columnId: column.id,
              fieldName: column.field_name,
              raw,
            },
          ]
        },
      )
      setDrafts((current) => {
        const next = { ...current }
        for (const cell of cells) {
          const key = `${cell.rowId ?? `new:${cell.rowIndex}`}:${cell.columnId}`
          next[key] = { ...cell, generation }
        }
        return next
      })
      mutation.mutate({ generation, cells })
    },
    [readOnly, table, localRows, mutation],
  )
  // Memoize afterSelectionEnd so it's stable across renders.
  const handleAfterSelectionEnd = useCallback(
    (row: number, columnIndex: number) => {
      const rowId =
        typeof localRows[row]?.id === 'string'
          ? String(localRows[row].id)
          : null
      const column = table!.columns.at(columnIndex)
      setSelectedCoords({ row, col: columnIndex })
      setSelected(
        rowId && column
          ? { tableId: table!.id, rowId, columnId: column.id }
          : null,
      )
      if (!rowId) setFormulaStatus('Save the row before adding a formula.')
    },
    [table, localRows],
  )
  // Memoize the complete settings object so the React wrapper doesn't
  // call updateSettings on every render. This is critical: without it,
  // any state change (selected, formulaStatus, drafts) re-creates the
  // settings object, causing HotTable to reconfigure and kill the editor.
  const settings = useMemo(
    () =>
      table
        ? {
            data: localRows,
            columns: gridColumns,
            colHeaders: gridColHeaders,
            rowHeaders: true,
            minSpareRows: !readOnly ? 1 : 0,
            height: Math.min(
              Math.max(
                (localRows.length + 1) * 28 + 8,
                table.columns.length > 0 ? 80 : 48,
              ),
              600,
            ),
            readOnly,
            fillHandle: !readOnly,
            // Only truthful, persisted operations are exposed. Custom items
            // (clear contents, configure columns) need component-state access
            // so they are defined here rather than in the frozen constant.
            contextMenu: readOnly
              ? false
              : {
                  items: [
                    ...GRID_CONTEXT_MENU_ITEMS,
                    '---------',
                    {
                      name: 'Clear contents',
                      callback: function (this: {
                        getSelected: () => number[][] | null
                        setDataAtCell: (
                          changes: Array<[number, number, unknown]>,
                        ) => void
                      }) {
                        const ranges = this.getSelected()
                        if (!ranges) return
                        const changes: Array<[number, number, unknown]> = []
                        for (const [sR, sC, eR, eC] of ranges) {
                          const startRow = Math.min(sR, eR)
                          const endRow = Math.max(sR, eR)
                          const startCol = Math.min(sC, eC)
                          const endCol = Math.max(sC, eC)
                          for (let r = startRow; r <= endRow; r++)
                            for (let c = startCol; c <= endCol; c++)
                              changes.push([r, c, null])
                        }
                        if (changes.length) this.setDataAtCell(changes)
                      },
                    },
                    '---------',
                    {
                      name: 'Configure columns…',
                      callback: () => setConfigurationOpen(true),
                    },
                  ],
                },
            stretchH: 'all' as const,
            formulas: formulasConfig,
            afterChange: handleAfterChange,
            afterSelectionEnd: handleAfterSelectionEnd,
          }
        : null,
    [
      table,
      localRows,
      gridColumns,
      gridColHeaders,
      formulasConfig,
      readOnly,
      handleAfterChange,
      handleAfterSelectionEnd,
    ],
  )
  if (!tableId) return <p role="alert">Invalid sheet block.</p>
  if (tableQuery.isPending || (table && allRowsQuery.isPending))
    return <p role="status">Loading scientific sheet…</p>
  if (tableQuery.isError || allRowsQuery.isError)
    return <p role="alert">Could not load scientific sheet.</p>
  if (!table || !settings)
    return <p role="alert">Scientific sheet not found.</p>
  return (
    <div className="group/sheet border-t border-border/50 pt-1.5">
      {issues.length ? (
        <ul
          role="alert"
          className="mb-2 space-y-0.5 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive"
        >
          {issues.map((issue) => (
            <li key={issue.key} data-cell={issue.key}>
              {issue.message}
            </li>
          ))}
        </ul>
      ) : null}
      {calculationProblem ? (
        <p
          role="alert"
          className="mb-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive"
        >
          {calculationProblem}
        </p>
      ) : null}

      {/* SCI-010: bound schema name + revision badge with upgrade indicator. */}
      {table.dataset_schema && (
        <div className="flex items-center justify-between px-1 pb-1.5">
          <SchemaBadge
            schema={table.dataset_schema}
            onUpgrade={
              readOnly || !table.dataset_schema.latest_published_revision
                ? undefined
                : () => {
                    void upgradeMutation.mutateAsync(
                      table.dataset_schema!.latest_published_revision!,
                    )
                  }
            }
            upgrading={upgradeMutation.isPending}
          />
        </div>
      )}

      {readOnly ? null : (
        <section
          aria-label="Formula bar"
          className="mb-2 flex items-center gap-1.5 border-y bg-muted/20 px-3 py-2 text-xs"
        >
          <span
            className="flex h-5 w-12 shrink-0 items-center justify-center rounded bg-background font-mono text-[10px] font-semibold text-muted-foreground"
            aria-label="Active cell address"
          >
            {selectedCoords
              ? toA1(selectedCoords.row, selectedCoords.col)
              : '—'}
          </span>
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-muted font-mono text-[10px] font-semibold italic text-muted-foreground">
            fx
          </span>
          <Input
            aria-label="Formula source"
            placeholder={selected ? '' : 'Select a cell'}
            value={formulaSource}
            disabled={!selected}
            onChange={(event) => setFormulaSource(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void commitFormula()
              } else if (event.key === 'Escape') {
                event.preventDefault()
                setFormulaSource(selectedFormula?.source_expression ?? '')
                setFormulaStatus('')
              }
            }}
            className="h-6 min-w-40 flex-1 border-muted font-mono text-xs"
          />
          {exponentHint ? (
            <span
              role="status"
              className="shrink-0 text-[10px] text-muted-foreground italic"
            >
              ** converted to ^
            </span>
          ) : null}
          {formulaStatus ? (
            <span role="status" className="text-muted-foreground">
              {formulaStatus}
            </span>
          ) : null}
        </section>
      )}

      <SheetbaseGrid
        settings={settings}
        ariaLabel={table.name}
      />

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <span>
            {(allRowsQuery.data ?? []).length}{' '}
            {(allRowsQuery.data ?? []).length === 1 ? 'row' : 'rows'}
          </span>
          {readOnly ? null : (
            <SaveStatusIndicator
              isPending={mutation.isPending}
              isError={mutation.isError}
              isSuccess={mutation.isSuccess}
              onRetry={() => {
                if (mutation.variables) mutation.mutate(mutation.variables)
              }}
            />
          )}
        </div>
        <div className="flex items-center gap-1">
          {!readOnly ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Configure table"
              onClick={() => setConfigurationOpen(true)}
            >
              <Settings className="size-4" />
            </Button>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Sheet tools"
              >
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setTransferOpen(true)}>
                Import &amp; export CSV
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setInspectorOpen(true)}>
                API inspector
              </DropdownMenuItem>
              {readOnly ? null : (
                <DropdownMenuItem
                  disabled={calculationResultsQuery.isFetching}
                  onSelect={() => void refreshCalculation()}
                >
                  Recalculate
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <Dialog open={configurationOpen} onOpenChange={setConfigurationOpen}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <SchemaConfigurator
            table={table}
            tableId={tableId}
            readOnly={readOnly}
            draftColumnIds={
              new Set(Object.values(drafts).map((draft) => draft.columnId))
            }
            rowMutationPending={mutation.isPending}
            formulaDependencies={dependenciesQuery.data ?? []}
            onSuccess={async () => {
              await tableQuery.refetch()
              await queryClient.invalidateQueries({
                queryKey: allRowsKey,
              })
            }}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Data interchange</DialogTitle>
            <DialogDescription>
              Import rows from CSV or export the sheet with schema and unit
              metadata.
            </DialogDescription>
          </DialogHeader>
          <ScientificTransferPanel
            table={table}
            rows={allRowsQuery.data ?? []}
            readOnly={readOnly}
            onImported={async () => {
              await Promise.all([
                tableQuery.refetch(),
                queryClient.invalidateQueries({
                  queryKey: allRowsKey,
                }),
                queryClient.invalidateQueries({
                  queryKey: scientificQueryKeys.allRows(tableId),
                }),
              ])
            }}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={inspectorOpen} onOpenChange={setInspectorOpen}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>API inspector</DialogTitle>
            <DialogDescription>
              Sheet identity, fields, and authenticated request examples.
            </DialogDescription>
          </DialogHeader>
          <ScientificApiInspector
            table={table}
            selectedRowId={selected?.rowId}
            selectedRowVersion={
              selected
                ? (allRowsQuery.data ?? []).find(
                    (row) => row.id === selected.rowId,
                  )?.version
                : undefined
            }
            selectedColumnId={selected?.columnId}
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}
