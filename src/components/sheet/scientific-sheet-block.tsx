import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  shiftFormulaReferences,
  toA1,
} from '#/components/sheet/formula-reference-editor'
import { normalizeExponentiation } from '#/lib/formula-ir'
import {
  FunctionAutocompleteDropdown,
  useFunctionAutocomplete,
} from '#/components/sheet/function-autocomplete'
import {
  ChevronLeft,
  ChevronRight,
  Check,
  AlertCircle,
  RotateCcw,
  Settings,
} from 'lucide-react'
import type { NotebookBlock } from '#/lib/notebook-data'
import { DataClientError } from '#/lib/data-client'
import { Badge } from '#/components/v3/ui/badge'
import { Button } from '#/components/v3/ui/button'
import { Dialog, DialogContent, DialogHeader } from '#/components/v3/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/v3/ui/dropdown-menu'
import { Input } from '#/components/v3/ui/input'
import { Textarea } from '#/components/v3/inventory/list'
import { Icon } from '#/components/v3/icons'
import { SheetbaseTableGrid } from './sheetbase-grid'
import type {
  SheetbaseGridCellChange,
  SheetbaseGridCellValue,
  SheetbaseGridColumn,
  SheetbaseGridMenuEntry,
  SheetbaseGridSelection,
  SheetbaseGridWriteSource,
} from './sheetbase-grid'
import { ScientificApiInspector } from './scientific-api-inspector'
import { ScientificTransferPanel } from './scientific-transfer-panel'
import {
  addScientificColumn,
  deleteScientificRows,
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
import { fieldEditorPresentation } from '#/lib/field-presentation'
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
import { scientificSheetName } from '#/lib/scientific-workbook'
import type {
  ScientificWorkbook,
  WorkbookCellAddress,
  WorkbookResult,
  WorkbookTable,
} from '#/lib/scientific-workbook'
import { createSheetbaseHyperFormula } from '#/lib/hyperformula-profile'
import type { HyperFormula } from 'hyperformula'
import { useNotebookScientificWorkbook } from '#/components/notebook/scientific-workbook-provider'
import { GridOperationCoordinator } from '#/lib/grid-operation-coordinator'
import type {
  SaveStatus,
  PendingCell as CoordinatorCell,
} from '#/lib/grid-operation-coordinator'

interface PendingCell {
  rowIndex: number
  rowId: string | null
  columnId: string
  fieldName: string
  raw: unknown
}

interface DraftCell extends PendingCell {
  generation: number
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
  if (result.status === 'error') return formulaErrorDisplay(result.error)
  return result.logical.ok ? result.logical.value : `#${result.logical.code}!`
}

const FORMULA_ERROR_DISPLAY: Record<string, string> = {
  DIV_BY_ZERO: '#DIV/0!',
  VALUE: '#VALUE!',
  NAME: '#NAME?',
  REF: '#REF!',
  NUM: '#NUM!',
  NA: '#N/A',
  ERROR: '#ERROR!',
  CYCLE: '#CYCLE!',
  SPILL: '#SPILL!',
  LIC: '#LIC!',
}

export function formulaErrorDisplay(code: string): string {
  return FORMULA_ERROR_DISPLAY[code] ?? '#ERROR!'
}

function readColumnPreferences<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback
  try {
    const value: unknown = JSON.parse(
      window.localStorage.getItem(key) ?? 'null',
    )
    return value === null ? fallback : (value as T)
  } catch {
    return fallback
  }
}

function writeColumnPreferences(key: string, value: unknown): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage can be unavailable in private browsing or a locked-down iframe.
  }
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
        aria-label={status === 'retrying' ? 'Retrying save' : 'Saving'}
      >
        <Icon name="clock" size={12} className="animate-spin" />
        {status === 'retrying' ? 'Offline/Retrying…' : 'Saving…'}
      </span>
    )
  if (status === 'error')
    return (
      <span
        className="flex items-center gap-1 text-danger-text"
        aria-label="Save failed"
      >
        <AlertCircle className="size-3" />
        Save failed
        <Button
          type="button"
          variant="quiet"
          size="sm"
          className="h-5 px-1.5 text-[10px] text-danger-text"
          onClick={onRetry}
        >
          <RotateCcw className="size-3" />
          Retry
        </Button>
      </span>
    )
  if (status === 'saved')
    return (
      <span
        className="flex items-center gap-1 text-success-text-foreground"
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
  'h-8 rounded-md border border-border bg-surface px-2 text-xs shadow-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50'

/** Native checkbox styled to match the design system (no Checkbox primitive). */
const checkboxClass =
  'size-4 rounded border-border text-primary accent-primary focus-visible:ring-2 focus-visible:ring-ring/50'

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
      <DialogHeader
        title="Configure sheet"
        description="Rename the sheet, add columns, and manage units, validation and schema lifecycle. Display labels can change; stable identities remain."
      />

      {formulaDependencies.length ? (
        <p className="text-xs text-warning-text" role="status">
          {new Set(formulaDependencies.map((item) => item.formula_id)).size}{' '}
          persisted formula(s) depend on this sheet
        </p>
      ) : null}

      <div className="space-y-1">
        <label className="text-label text-fg-muted" htmlFor="sheet-name">
          Sheet name
        </label>
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
            variant="quiet"
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
      </div>

      <hr className="border-border" />

      <div className="space-y-3">
        <label className="text-label font-medium text-fg-muted">
          Add column
        </label>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="text-label text-fg-muted" htmlFor="new-col-label">
              Label
            </label>
            <Input
              id="new-col-label"
              aria-label="New column label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="text-label text-fg-muted" htmlFor="new-col-type">
              Type
            </label>
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
          </div>
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
          <div className="space-y-1">
            <label className="text-label text-fg-muted" htmlFor="cat-options">
              Category options (one per line)
            </label>
            <Textarea
              id="cat-options"
              aria-label="Category options"
              value={options}
              onChange={(e) => setOptions(e.target.value)}
              className="min-h-24"
            />
          </div>
        ) : null}
        <details className="rounded-md border bg-surface-muted/20 p-2 text-xs">
          <summary className="cursor-pointer font-medium text-fg-muted">
            Advanced · custom JSON
          </summary>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-label text-fg-muted" htmlFor="unit-json">
                Unit JSON
              </label>
              <Textarea
                id="unit-json"
                aria-label="Unit JSON"
                placeholder='{"code":"mg","symbol":"mg"}'
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className="min-h-20 font-mono"
              />
            </div>
            <div className="space-y-1">
              <label
                className="text-label text-fg-muted"
                htmlFor="validation-json"
              >
                Validation JSON
              </label>
              <Textarea
                id="validation-json"
                aria-label="Validation JSON"
                placeholder='{"min":0}'
                value={validation}
                onChange={(e) => setValidation(e.target.value)}
                className="min-h-20 font-mono"
              />
            </div>
          </div>
        </details>
        <Button type="button" size="sm" disabled={disabled} onClick={addColumn}>
          Add column
        </Button>
      </div>

      <hr className="border-border" />

      <div className="space-y-2">
        <label className="text-label font-medium text-fg-muted">Columns</label>
        <ol className="space-y-1.5" aria-label="Columns">
          {table.columns.map((column, index) => (
            <li
              key={column.id}
              className="flex flex-wrap items-center gap-2 rounded-md border bg-surface/40 p-2"
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
              <Badge variant="chg">{column.logical_type}</Badge>
              <Badge variant="kind">
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
                variant="quiet"
                size="icon"
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
                variant="quiet"
                size="icon"
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
                variant="quiet"
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
          <p role="status" className="text-xs text-warning-text">
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
          <p className="text-fg-muted">
            This can affect formulas and API clients. The stable field remains{' '}
            {confirmation.column.field_name}.
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="danger"
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
              variant="secondary"
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

      <hr className="border-border" />

      <details className="rounded-md border bg-surface-muted/20 p-2 text-xs text-fg-muted">
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
 * COMP-06 — the vendor-neutral column contract. Formula-reference editing is
 * requested with `formula`; the wrapper builds the engine's editor.
 */
function sheetbaseColumn(
  column: ScientificColumnWire,
  readOnly: boolean,
): SheetbaseGridColumn {
  const unitSuffix =
    column.unit && typeof column.unit === 'object' && 'symbol' in column.unit
      ? ` (${String(column.unit.symbol)})`
      : ''
  const presentation = fieldEditorPresentation(column.logical_type)
  const base: Omit<SheetbaseGridColumn, 'type'> = {
    id: column.id,
    label: `${column.label}${unitSuffix}`,
    source: 'bound',
    readOnly,
  }
  if (presentation.kind === 'number')
    return {
      ...base,
      type: 'number',
      numberFormat:
        column.format ?? (column.logical_type === 'decimal' ? '0.00' : '0'),
      formula: !readOnly,
    }
  if (presentation.kind === 'checkbox') return { ...base, type: 'checkbox' }
  if (presentation.kind === 'date')
    return { ...base, type: 'date', dateFormat: 'YYYY-MM-DD' }
  if (presentation.kind === 'category-select')
    return {
      ...base,
      type: 'select',
      options: column.options.map((option) => option.label),
    }
  return { ...base, type: 'text', formula: !readOnly }
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
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const nextGeneration = useRef(0)
  const formulaInputRef = useRef<HTMLInputElement>(null)
  const formulaAutocomplete = useFunctionAutocomplete({
    value: formulaSource,
    inputRef: formulaInputRef,
    onInsert: ({ text, cursor }) => {
      setFormulaSource(text)
      // Defer cursor positioning until after React re-renders the input.
      requestAnimationFrame(() => {
        formulaInputRef.current?.focus()
        formulaInputRef.current?.setSelectionRange(cursor, cursor)
      })
    },
  })
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
  const allRowsKey = useMemo(
    () => scientificQueryKeys.allRows(tableId),
    [tableId],
  )
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
    // The formulas plugin requires the sheet to already exist in the engine.
    // Without this, the plugin cannot map grid cells to HyperFormula cells,
    // so formula evaluation, copy-paste formula preservation, and autofill
    // translation all silently fail (cells show computed values instead of
    // formula expressions).
    try {
      const engine = createSheetbaseHyperFormula()
      const sheetName = scientificSheetName(table.id)
      if (!engine.doesSheetExist(sheetName)) engine.addSheet(sheetName)
      return engine
    } catch {
      return null
    }
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
  // Compute the canonical formula-bar display value for the selected cell:
  // the formula source expression for formula cells, or the raw cell value
  // for non-formula cells (like Excel). Used by the selection effect and the
  // Escape-key handler so they stay consistent.
  const selectedCellDisplay = useCallback((): string => {
    if (selectedFormula) return selectedFormula.source_expression
    if (!selected) return ''
    const rows = localRowsRef.current
    const row = rows.find((candidate) => candidate.id === selected.rowId)
    const column = table?.columns.find(
      (candidate) => candidate.id === selected.columnId,
    )
    return row && column ? String(row[column.field_name] ?? '') : ''
  }, [selected, selectedFormula, table])
  useEffect(() => {
    setFormulaSource(selectedCellDisplay())
    setFormulaStatus('')
  }, [selectedCellDisplay])
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
    //
    // The formulas query is NOT refetched here. The optimistic cache update
    // in onFormulaPersisted (coordinator path) or commitFormula (formula bar
    // path) already inserted the formula into the cache for immediate
    // formula bar display. A refetch would overwrite the optimistic data and
    // — critically — change formulasQuery.data, which recomputes gridData,
    // which recomputes settings, which triggers updateSettings on HotTable.
    // That updateSettings call can disrupt ongoing grid interactions like
    // autofill drags by calling loadData() mid-drag. Instead, we just
    // invalidate the formulas query so it refetches in the background
    // (non-awaited) and replaces the optimistic data when it completes —
    // hopefully when the user is not mid-interaction.
    queryClient.invalidateQueries({
      queryKey: scientificQueryKeys.formulas(tableId),
    })
    if (reconcileRows) {
      await queryClient.invalidateQueries({ queryKey: allRowsKey })
    }
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
  // Refs that hold the latest values for the coordinator callbacks. The
  // coordinator is created once and its callbacks capture these refs, so
  // they always read current state without being recreated.
  const tableRef = useRef<ScientificTableWire | null>(table ?? null)
  tableRef.current = table ?? null
  const formulaByCellRef = useRef(formulaByCell)
  formulaByCellRef.current = formulaByCell
  const readOnlyRef = useRef(readOnly)
  readOnlyRef.current = readOnly
  const refreshCalculationRef = useRef(refreshCalculation)
  refreshCalculationRef.current = refreshCalculation
  // Mirror `selected` into a ref so the coordinator's
  // onProvisionalRowReplaced callback can migrate the active selection when
  // a provisional row ID is swapped for the server-assigned UUID. Without
  // this, the formula bar and address box would keep pointing at the stale
  // `prov:` id after the insert resolves, so a subsequent formula-bar
  // commit would target the wrong (now-removed) identity.
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  // The coordinator replaces the per-afterChange mutation pattern with a
  // coalesced, ordered, status-aware write pipeline. It persists edits with
  // a ~300ms coalescing window, serialises literal and formula writes
  // against one canonical snapshot, and exposes save status states.
  const coordinator = useMemo(
    () =>
      new GridOperationCoordinator({
        client: scientificDataClient,
        coalesceMs: 300,
        getCanonicalRows: () =>
          queryClient.getQueryData<ScientificRowWire[]>(allRowsKey) ?? [],
        getFormulaByCell: () => formulaByCellRef.current,
        getTable: () => tableRef.current,
        isReadOnly: () => readOnlyRef.current,
        onRowsUpdated: (rows) =>
          queryClient.setQueryData<ScientificRowWire[]>(
            allRowsKey,
            (old = []) => {
              const map = new Map(old.map((r) => [r.id, r]))
              for (const row of rows) map.set(row.id, row)
              return [...map.values()]
            },
          ),
        onProvisionalRowReplaced: (provisionalId, realId) => {
          queryClient.setQueryData<ScientificRowWire[]>(
            allRowsKey,
            (old = []) =>
              old.map((row) =>
                row.id === provisionalId
                  ? { ...row, id: realId, version: 1 }
                  : row,
              ),
          )
          // Migrate the active selection off the stale provisional id so the
          // formula bar, address box, and subsequent commits target the real
          // UUID after the insert resolves.
          if (selectedRef.current?.rowId === provisionalId) {
            setSelected({ ...selectedRef.current, rowId: realId })
          }
          // Migrate any in-flight draft keys that still reference the
          // provisional id (e.g. an empty cell the user typed into but
          // hasn't committed yet).
          setDrafts((current) => {
            const prefix = `${provisionalId}:`
            let changed = false
            const next: typeof current = {}
            for (const [key, value] of Object.entries(current)) {
              if (key.startsWith(prefix)) {
                next[`${realId}:${key.slice(prefix.length)}`] = value
                changed = true
              } else {
                next[key] = value
              }
            }
            return changed ? next : current
          })
        },
        onDraftsCleared: (cells) =>
          setDrafts((current) => {
            const next = { ...current }
            for (const cell of cells) {
              const key = `${cell.rowId ?? `new:${cell.rowIndex}`}:${cell.columnId}`
              // The draft may have been discarded or replaced while this
              // request was in flight; keep the optional lookup intentionally.
              // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
              if (next[key]?.generation === cell.generation) delete next[key]
            }
            return next
          }),
        onIssues: setIssues,
        onStatusChange: setSaveStatus,
        onCalculationNeeded: (reconcileRows) =>
          void refreshCalculationRef.current(reconcileRows),
        onRefetchRows: () =>
          void queryClient.invalidateQueries({ queryKey: allRowsKey }),
        onFormulaPersisted: (target, source) => {
          // Optimistically update the formulas query cache so the formula
          // bar shows the source expression immediately after a formula
          // write, without waiting for the refetch in onCalculationNeeded.
          // The refetch will replace this with the full server-side
          // formula definition (including engine_expression, template,
          // bindings, etc.) shortly after.
          queryClient.setQueryData<FormulaDefinitionWire[]>(
            scientificQueryKeys.formulas(tableId),
            (old = []) => {
              if (source === null)
                return old.filter(
                  (formula) =>
                    formula.target_row_id !== target.rowId ||
                    formula.target_column_id !== target.columnId,
                )
              const normalized = normalizeExponentiation(source)
              const idx = old.findIndex(
                (f) =>
                  f.target_row_id === target.rowId &&
                  f.target_column_id === target.columnId,
              )
              const entry: FormulaDefinitionWire = {
                id: idx >= 0 ? old[idx].id : '',
                target_table_id: target.tableId,
                target_row_id: target.rowId,
                target_column_id: target.columnId,
                source_expression: normalized,
                template: idx >= 0 ? old[idx].template : null,
                bindings: idx >= 0 ? old[idx].bindings : [],
                engine_expression: `(${normalized})`,
                syntax_profile: 'sheetbase-hf-en-us-v1',
                function_profile: 'scientific-core-v2',
                literal_profile: 'sheetbase-literal-v1',
                engine_version: '3.3.0',
                status: 'supported',
                version: idx >= 0 ? old[idx].version : 1,
                created_at:
                  idx >= 0 ? old[idx].created_at : new Date().toISOString(),
              }
              if (idx >= 0) {
                const next = [...old]
                next[idx] = entry
                return next
              }
              return [...old, entry]
            },
          )
        },
      }),
    [queryClient, allRowsKey, tableId],
  )
  // Destroy the coordinator on unmount.
  useEffect(() => () => coordinator.destroy(), [coordinator])
  // Warn before route exit if durable writes remain unsent.
  useEffect(() => {
    if (readOnly) return
    const handler = (event: BeforeUnloadEvent) => {
      if (coordinator.hasPendingEdits()) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [coordinator, readOnly])

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
    // Provisional rows (optimistic Add Row) must route through the
    // coordinator, which will insert the row first and then apply the
    // formula to the server-created UUID. Calling mutateScientificFormula
    // directly with a `prov:` ID would fail because the server doesn't
    // know about the row yet.
    if (selected.rowId.startsWith('prov:')) {
      const column = table.columns.find((c) => c.id === selected.columnId)
      if (!column) return
      const rowIndex = (allRowsQuery.data ?? []).findIndex(
        (item) => item.id === selected.rowId,
      )
      coordinator.enqueue([
        {
          rowIndex:
            rowIndex >= 0 ? rowIndex : (allRowsQuery.data ?? []).length - 1,
          rowId: selected.rowId,
          columnId: selected.columnId,
          fieldName: column.field_name,
          raw: normalized,
          generation: ++nextGeneration.current,
        },
      ])
      setFormulaStatus('')
      return
    }
    const row = (allRowsQuery.data ?? []).find(
      (item) => item.id === selected.rowId,
    )
    if (!row) {
      // The row may have been removed by a refetch after a failed insert.
      // Don't tell the user to "save the row" — that's confusing when the
      // formula already evaluated locally. Route through the coordinator
      // which will re-insert if needed.
      coordinator.enqueue([
        {
          rowIndex: selectedCoords?.row ?? 0,
          rowId: selected.rowId,
          columnId: selected.columnId,
          fieldName:
            table.columns.find((c) => c.id === selected.columnId)?.field_name ??
            '',
          raw: normalized,
          generation: ++nextGeneration.current,
        },
      ])
      setFormulaStatus('')
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
      // Optimistically update the formulas query cache so the formula bar
      // shows the source expression immediately. The refetch in
      // refreshCalculation will replace this with the full server-side
      // formula definition shortly after.
      queryClient.setQueryData<FormulaDefinitionWire[]>(
        scientificQueryKeys.formulas(tableId),
        (old = []) => {
          const idx = old.findIndex(
            (f) =>
              f.target_row_id === selected.rowId &&
              f.target_column_id === selected.columnId,
          )
          const entry: FormulaDefinitionWire = {
            id: idx >= 0 ? old[idx].id : '',
            target_table_id: selected.tableId,
            target_row_id: selected.rowId,
            target_column_id: selected.columnId,
            source_expression: normalized,
            template: idx >= 0 ? old[idx].template : null,
            bindings: idx >= 0 ? old[idx].bindings : [],
            engine_expression: `(${normalized})`,
            syntax_profile: 'sheetbase-hf-en-us-v1',
            function_profile: 'scientific-core-v2',
            literal_profile: 'sheetbase-literal-v1',
            engine_version: '3.3.0',
            status: 'supported',
            version: idx >= 0 ? old[idx].version : 1,
            created_at:
              idx >= 0 ? old[idx].created_at : new Date().toISOString(),
          }
          if (idx >= 0) {
            const next = [...old]
            next[idx] = entry
            return next
          }
          return [...old, entry]
        },
      )
      setFormulaStatus('')
      // Don't reconcile rows for formula bar commits. Formula writes change
      // row versions on the server but don't change the row data that
      // gridData uses. Avoiding the allRows invalidation prevents a
      // background refetch that would recompute gridData → settings →
      // updateSettings on HotTable, which calls loadData() and can
      // overwrite the formula expression in the source data. If a stale
      // version error occurs on a subsequent literal edit, the coordinator
      // handles it by refetching.
      await refreshCalculationRef.current(false)
    } catch (error) {
      setFormulaStatus(
        error instanceof Error ? error.message : 'Could not save the formula.',
      )
    }
  }, [
    selected,
    selectedCoords,
    table,
    formulaSource,
    selectedFormula,
    allRowsQuery.data,
    coordinator,
  ])

  // gridData: canonical rows + formula overlays, WITHOUT drafts.
  //
  // This is the data passed to Handsontable via settings.data. It is
  // deliberately NOT overlaid with draft (optimistic) values because
  // Handsontable's editor already writes optimistic values to its internal
  // data source via saveValue(). If we also put drafts in settings.data,
  // every setDrafts() call (fired synchronously inside afterChange, which
  // fires inside super.finishEditing()) would give settings.data a new array
  // identity. That causes the HotTable wrapper to call updateSettings({data}),
  // which triggers loadData(), which disrupts the editor mid-commit — the
  // editor is in WAITING state (validation pending) and never completes its
  // close cycle. The editor stays open, blocking autofill and all other
  // grid interactions.
  //
  // By keeping drafts OUT of gridData, settings.data keeps the same array
  // reference across draft changes. The settings memo doesn't recompute,
  // HotTable doesn't call updateSettings, and the editor closes normally.
  // Drafts are still tracked in React state (for refetch recovery and
  // coordinator cleanup) and overlaid in `localRows` for the footer row
  // count and localRowsRef — just not in the data passed to Handsontable.
  const gridData = useMemo(() => {
    const detached: Array<Record<string, unknown>> = (
      allRowsQuery.data ?? []
    ).map((row) => {
      const copy = { ...row }
      for (const column of table?.columns ?? [])
        if (column.logical_type === 'category')
          copy[column.field_name] =
            column.options.find((o) => o.id === row[column.field_name])
              ?.label ?? row[column.field_name]
      return copy
    })
    for (const row of detached) {
      if (typeof row.id !== 'string') continue
      for (const column of table?.columns ?? []) {
        const formula = formulaByCell.get(`${row.id}/${column.id}`)
        if (!formula) continue
        // Same-sheet formulas (no `!` cross-sheet prefix) are injected as
        // engine expressions so the Handsontable formulas plugin recognises
        // the cell as a formula, computes it inline, and — crucially —
        // enables formula-preserving copy-paste and autofill. This does NOT
        // require `tableWorkbook`: the grid's own `gridEngine` (configured
        // in `formulasConfig`) evaluates the expression.
        const isSameSheet =
          formula.status === 'supported' &&
          !!formula.engine_expression &&
          !formula.engine_expression.includes('!')
        if (isSameSheet) {
          row[column.field_name] = formula.engine_expression
        } else if (tableWorkbook) {
          // Cross-sheet formulas fall back to the pre-computed workbook
          // result. This branch DOES require `tableWorkbook` because only
          // the notebook-level engine has cross-sheet references.
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
  }, [formulaByCell, allRowsQuery.data, table, tableId, tableWorkbook])

  // localRows: gridData + draft overlays. Used for localRowsRef (read by
  // afterChange/afterSelectionEnd callbacks to get row IDs) and the footer
  // row count. NOT passed to Handsontable — see gridData comment above.
  const localRows = useMemo(() => {
    const detached = gridData.map((row) => ({ ...row }))
    for (const draft of Object.values(drafts)) {
      const rowIndex = draft.rowId
        ? detached.findIndex((row) => row.id === draft.rowId)
        : draft.rowIndex
      if (rowIndex < 0) continue
      detached[rowIndex] ??= {}
      detached[rowIndex][draft.fieldName] = draft.raw
    }
    return detached
  }, [gridData, drafts])
  // Mirror `localRows` into a ref so the afterChange and afterSelectionEnd
  // callbacks can read current grid data without depending on `localRows` in
  // their useCallback deps. This keeps the callbacks stable across renders,
  // which prevents the settings memo from being recreated on every edit —
  // recreating settings triggers updateSettings, which reloads the grid data
  // and can interfere with the formulas plugin during multi-cell operations
  // like autofill.
  const localRowsRef = useRef(localRows)
  localRowsRef.current = localRows
  // Track the source range of the last copy/cut so beforePaste can
  // translate relative A1 references by the row/column offset.
  const copySourceRef = useRef<{ startRow: number; startCol: number } | null>(
    null,
  )
  // Add Row: creates a provisional row optimistically in the query cache,
  // registers it with the coordinator for persistence, and selects its
  // first editable cell. The coordinator sends the insert RPC and swaps
  // the provisional ID for the server-created UUID on success.
  const addRow = useCallback(() => {
    if (readOnly || !table) return
    const provisionalId = `prov:${crypto.randomUUID()}`
    queryClient.setQueryData<ScientificRowWire[]>(allRowsKey, (old = []) => [
      ...old,
      { id: provisionalId, version: 0 },
    ])
    coordinator.registerProvisionalRow(provisionalId)
    // COMP-06 step 2: the table backend owns selection and scrolling. No
    // imperative select/scroll is exposed through `SheetbaseGridProps`, so the
    // old post-insert focus (`selectCell`/`scrollViewportTo`) cannot be carried
    // over yet: the provisional row is still added and re-rendered, but the
    // engine decides where the active cell lands. See the ticket's deferred
    // list for the neutral handle this needs.
  }, [readOnly, table, coordinator, queryClient, allRowsKey])
  // Row deletion: captures row IDs before removal, then persists via
  // deleteScientificRows. If the DB trigger blocks deletion (formula
  // dependencies), refetches to restore the row and surfaces the error.
  const removedRowIdsRef = useRef<string[]>([])
  const handleBeforeRemoveRow = useCallback(
    (rowIndex: number, amount: number) => {
      if (readOnly) return
      const rows = localRowsRef.current
      const ids: string[] = []
      let hasContent = false
      for (let i = rowIndex; i < rowIndex + amount; i++) {
        if (i >= rows.length) continue
        const row = rows[i]
        if (typeof row.id === 'string') {
          if (row.id.startsWith('prov:')) continue
          ids.push(row.id)
        }
        for (const column of table?.columns ?? []) {
          if (
            row[column.field_name] !== null &&
            row[column.field_name] !== undefined
          ) {
            hasContent = true
            break
          }
        }
      }
      // Preflight: check if any formula depends on the rows being deleted.
      // The DB trigger blocks deletion of rows referenced by formulas
      // (SQLSTATE 23514); surfacing this before the request gives a clearer
      // error than a post-failure refetch.
      const deps = dependenciesQuery.data ?? []
      const blockedIds = new Set(ids)
      const blockingFormulas = deps.filter((d) =>
        blockedIds.has(d.source_row_id),
      )
      if (blockingFormulas.length) {
        const formulaIds = [
          ...new Set(blockingFormulas.map((d) => d.formula_id)),
        ]
        setIssues(
          formulaIds.map((fid) => ({
            key: `${fid}:delete-block`,
            message: `Cannot remove row: formula ${fid.slice(0, 8)}… references it. Remove the formula first.`,
          })),
        )
        return false
      }
      removedRowIdsRef.current = ids
      // Confirm non-empty or multi-row deletion.
      if (hasContent || amount > 1) {
        const message =
          amount > 1
            ? `Remove ${amount} rows?`
            : 'Remove this row? It contains data.'
        return window.confirm(message)
      }
    },
    [readOnly, table, dependenciesQuery.data],
  )
  const handleAfterRemoveRow = useCallback(
    async (_rowIndex: number, _amount: number, source: string) => {
      if (readOnly || !table) return
      if (source === 'formula' || source === 'load') return
      const rowIds = removedRowIdsRef.current
      removedRowIdsRef.current = []
      if (rowIds.length === 0) return
      try {
        await deleteScientificRows(
          scientificDataClient,
          table.resource_name,
          rowIds,
        )
        setIssues([])
        void refreshCalculationRef.current(true)
      } catch (error) {
        // The DB trigger blocks deletion of rows with formula dependencies.
        // Refetch to restore the row in the grid (Handsontable already
        // removed it locally) and surface the error. Drafts are preserved
        // because they live in React state, not the query cache.
        await queryClient.invalidateQueries({ queryKey: allRowsKey })
        const message =
          error instanceof Error
            ? error.message.includes('formula') ||
              error.message.includes('23514')
              ? 'Cannot remove rows referenced by formulas. Remove the formulas first.'
              : error.message
            : 'Could not remove row.'
        setIssues(
          rowIds.map((id) => ({
            key: `${id}:delete`,
            message,
          })),
        )
      }
    },
    // refreshCalculation is NOT in the deps because it's a non-memoized
    // function that gets a new reference on every render. Including it
    // here would give handleAfterRemoveRow a new reference on every
    // render, which flows into the settings memo, which causes
    // SheetbaseGridClient to re-render and HotTable to call
    // updateSettings() — reloading all data and reverting formulas set
    // by autofill. Use the ref instead.
    [readOnly, table, allRowsKey, queryClient],
  )
  // Memoize columns, colHeaders, and formulas config so they don't get new
  // object references on every re-render. Without this, React reconciliation
  // (e.g. setSelected from afterSelectionEnd) would give HotTable "changed"
  // props and reinitialize the grid, killing the cell editor.
  // COMP-06 step 1: the caller speaks Sheetbase terms only. Column types,
  // formula editing, the formula-reference clipboard and row-removal
  // persistence are expressed neutrally; the wrapper owns the engine mapping.
  const sheetColumns = useMemo(
    () =>
      table?.columns.map((column) => sheetbaseColumn(column, readOnly)) ?? [],
    [table?.columns, readOnly],
  )
  // gridData keeps the same value identity across draft changes (see the
  // gridData comment): the neutral rows are derived from it without overlaying
  // drafts, so the editor commit cycle is never disrupted.
  const sheetRows = useMemo(
    () =>
      table
        ? gridData.map((row) => ({
            id: typeof row.id === 'string' ? String(row.id) : undefined,
            cells: table.columns.map(
              (column) => row[column.field_name] ?? null,
            ),
          }))
        : [],
    [gridData, table],
  )
  const columnWidthsKey = `sheetbase:column-widths:${tableId}`
  const columnOrderKey = `sheetbase:column-order:${tableId}`
  const initialColumnWidths = useMemo(() => {
    if (!table) return undefined
    const stored = readColumnPreferences<Partial<Record<string, number>>>(
      columnWidthsKey,
      {},
    )
    return table.columns.map(
      (column) => stored[column.id] ?? column.width ?? 120,
    )
  }, [columnWidthsKey, table])
  const initialColumnOrder = useMemo(() => {
    if (!table) return undefined
    const stored = readColumnPreferences<string[]>(columnOrderKey, [])
    const currentIds = new Set(table.columns.map((column) => column.id))
    return [
      ...stored.filter((id) => currentIds.has(id)),
      ...table.columns
        .map((column) => column.id)
        .filter((id) => !stored.includes(id)),
    ]
  }, [columnOrderKey, table])
  const formulasConfig = useMemo(() => {
    if (!gridEngine || !table) return undefined
    try {
      return {
        engine: gridEngine,
        sheetName: scientificSheetName(table.id),
      }
    } catch {
      return undefined
    }
  }, [gridEngine, table?.id])

  // Memoize the change handler so it doesn't get a new function reference on
  // every render (which would reconfigure the grid and can kill the editor).
  const handleCellsChange = useCallback(
    (
      changes: readonly SheetbaseGridCellChange[],
      source: SheetbaseGridWriteSource,
    ) => {
      if (readOnly || source === 'load' || source === 'formula') return
      const generation = ++nextGeneration.current
      const rows = localRowsRef.current
      const cells: CoordinatorCell[] = changes.flatMap((change) => {
        const column = table?.columns.find(
          (candidate) => candidate.id === change.columnId,
        )
        if (!column || !table) return []
        const rowId =
          change.rowId ??
          (typeof rows[change.rowIndex]?.id === 'string'
            ? String(rows[change.rowIndex].id)
            : null)
        return [
          {
            rowIndex: change.rowIndex,
            rowId,
            columnId: column.id,
            fieldName: column.field_name,
            raw: change.next,
            generation,
          },
        ]
      })
      // Defer setDrafts() to a microtask so the React state update does not
      // interfere with the editor commit cycle (it fires synchronously inside
      // the editor's finishEditing → saveValue path).
      queueMicrotask(() => {
        setDrafts((current) => {
          const next = { ...current }
          for (const cell of cells) {
            const key = `${cell.rowId ?? `new:${cell.rowIndex}`}:${cell.columnId}`
            next[key] = { ...cell, generation }
          }
          return next
        })
      })
      coordinator.enqueue(cells)
    },
    [readOnly, table, coordinator],
  )

  // Memoize selection handling so it stays stable across renders.
  const handleSelectionChange = useCallback(
    (selection: SheetbaseGridSelection | null) => {
      if (!selection || !table) return
      const column = table.columns.find(
        (candidate) => candidate.id === selection.columnId,
      )
      const displayIndex = table.columns.findIndex(
        (candidate) => candidate.id === selection.columnId,
      )
      const rowId = selection.rowId ?? null
      setSelectedCoords({ row: selection.rowIndex, col: displayIndex })
      setSelected(
        rowId && column
          ? { tableId: table.id, rowId, columnId: column.id }
          : null,
      )
      // Don't show "Save the row before adding a formula" — provisional rows
      // (prov:…) and spare rows have no rowId, but the user can still enter
      // formulas. The coordinator handles persistence for provisional rows;
      // spare-row edits become inserts automatically.
      if (!rowId) setFormulaStatus('')
    },
    [table],
  )

  const preserveFormulaClipboard = useCallback(
    (
      data: SheetbaseGridCellValue[][],
      range: {
        startRow: number
        startColumn: number
        endRow: number
        endColumn: number
      },
    ) => {
      if (!table) return
      // Record the source start for paste-time reference translation.
      copySourceRef.current = {
        startRow: range.startRow,
        startCol: range.startColumn,
      }
      const rows = localRowsRef.current
      for (let rowOffset = 0; rowOffset < data.length; rowOffset++) {
        for (
          let colOffset = 0;
          colOffset < (data[rowOffset]?.length ?? 0);
          colOffset++
        ) {
          const rowIndex = range.startRow + rowOffset
          const row = rows.at(rowIndex)
          // The table backend renders columns in the passed `columns` order
          // (the adapter has no reorder surface), so the display column index
          // maps straight onto `table.columns` — no vendor physical-column
          // lookup is needed.
          const column = table.columns.at(range.startColumn + colOffset)
          if (!row || !column || typeof row.id !== 'string') continue
          const formula = formulaByCellRef.current.get(`${row.id}/${column.id}`)
          const source = formula?.source_expression ?? row[column.field_name]
          if (typeof source === 'string' && source.startsWith('='))
            data[rowOffset][colOffset] = source
        }
      }
    },
    [table],
  )

  const handlePaste = useCallback(
    (
      data: SheetbaseGridCellValue[][],
      target: { row: number; column: number },
    ) => {
      // Translate relative A1 references in pasted formulas by the row/column
      // offset between the copy source and paste target.
      const source = copySourceRef.current
      const rowOffset = source ? target.row - source.startRow : 0
      const colOffset = source ? target.column - source.startCol : 0
      for (const row of data)
        for (let column = 0; column < row.length; column++) {
          const value = row[column]
          if (typeof value === 'string' && value.startsWith('='))
            row[column] = shiftFormulaReferences(value, rowOffset, colOffset)
        }
      // Clear so a subsequent external paste doesn't use a stale offset.
      copySourceRef.current = null
    },
    [],
  )

  const handleColumnResize = useCallback(
    (columnId: string, newSize: number) => {
      const widths = readColumnPreferences<Partial<Record<string, number>>>(
        columnWidthsKey,
        {},
      )
      writeColumnPreferences(columnWidthsKey, {
        ...widths,
        [columnId]: newSize,
      })
    },
    [columnWidthsKey],
  )

  const handleColumnOrderChange = useCallback(
    (columnIds: string[]) => {
      writeColumnPreferences(columnOrderKey, columnIds)
    },
    [columnOrderKey],
  )

  const contextMenu = useMemo<SheetbaseGridMenuEntry[]>(
    () => [
      'insert-row-above',
      'insert-row-below',
      'remove-row',
      'separator',
      'cut',
      'copy',
      'paste',
      { id: 'clear-contents', label: 'Clear contents', skipEmpty: false },
      'separator',
      'undo',
      'redo',
      'separator',
      {
        id: 'configure-columns',
        label: 'Configure columns…',
        onSelect: () => setConfigurationOpen(true),
      },
    ],
    [],
  )
  if (!tableId) return <p role="alert">Invalid sheet block.</p>
  if (tableQuery.isPending || (table && allRowsQuery.isPending))
    return <p role="status">Loading scientific sheet…</p>
  if (tableQuery.isError || allRowsQuery.isError)
    return <p role="alert">Could not load scientific sheet.</p>
  if (!table) return <p role="alert">Scientific sheet not found.</p>
  return (
    <div className="group/sheet border-t border-border/50 pt-1.5">
      {issues.length ? (
        <ul
          role="alert"
          className="mb-2 space-y-0.5 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-danger-text"
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
          className="mb-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-danger-text"
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
          className="mb-2 flex items-center gap-1.5 border-y bg-surface-muted/20 px-3 py-2 text-xs"
        >
          <span
            className="flex h-5 w-12 shrink-0 items-center justify-center rounded bg-surface font-mono text-[10px] font-semibold text-fg-muted"
            aria-label="Active cell address"
          >
            {selectedCoords ? toA1(selectedCoords.row, selectedCoords.col) : ''}
          </span>
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-surface-muted font-mono text-[10px] font-semibold italic text-fg-muted">
            fx
          </span>
          <div className="relative flex-1">
            <Input
              ref={formulaInputRef}
              aria-label="Formula source"
              placeholder={selected ? '' : 'Select a cell'}
              value={formulaSource}
              disabled={!selected}
              onChange={(event) => setFormulaSource(event.target.value)}
              onKeyDown={(event) => {
                formulaAutocomplete.handleKeyDown(event)
                if (event.defaultPrevented) return
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void commitFormula()
                } else if (event.key === 'Escape') {
                  event.preventDefault()
                  setFormulaSource(selectedCellDisplay())
                  setFormulaStatus('')
                }
              }}
              className="h-6 min-w-40 flex-1 border-muted font-mono text-xs"
            />
            <FunctionAutocompleteDropdown
              suggestions={formulaAutocomplete.suggestions}
              activeIndex={formulaAutocomplete.activeIndex}
              listRef={formulaAutocomplete.listRef}
              onSelect={formulaAutocomplete.selectSuggestion}
            />
          </div>
          {exponentHint ? (
            <span
              role="status"
              className="shrink-0 text-[10px] text-fg-muted italic"
            >
              ** converted to ^
            </span>
          ) : null}
          {formulaStatus ? (
            <span role="status" className="text-fg-muted">
              {formulaStatus}
            </span>
          ) : null}
        </section>
      )}

      <SheetbaseTableGrid
        columns={sheetColumns}
        rows={sheetRows}
        ariaLabel={table.name}
        rowHeaders
        readOnly={readOnly}
        spareRows={readOnly ? 0 : 1}
        stretch="all"
        height={Math.min(
          Math.max(
            (gridData.length + 1) * 30 + 40,
            table.columns.length > 0 ? 80 : 48,
          ),
          600,
        )}
        initialColumnWidths={initialColumnWidths}
        columnOrder={initialColumnOrder}
        formulas={formulasConfig}
        clipboard={{
          onCopy: preserveFormulaClipboard,
          onCut: preserveFormulaClipboard,
          onPaste: handlePaste,
        }}
        contextMenuItems={readOnly ? false : contextMenu}
        onCellsChange={handleCellsChange}
        onSelectionChange={handleSelectionChange}
        onColumnResize={handleColumnResize}
        onColumnOrderChange={handleColumnOrderChange}
        onBeforeRowsRemove={handleBeforeRemoveRow}
        onRowsRemoved={handleAfterRemoveRow}
      />

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-fg-muted">
        <div className="flex items-center gap-2">
          <span>
            {localRows.length} {localRows.length === 1 ? 'row' : 'rows'}
          </span>
          {readOnly ? null : (
            <SaveStatusIndicator
              status={saveStatus}
              onRetry={() => void coordinator.retry()}
            />
          )}
        </div>
        <div className="flex items-center gap-1">
          {!readOnly ? (
            <Button
              type="button"
              variant="quiet"
              size="sm"
              className="h-7 text-xs"
              aria-label="Add row"
              onClick={addRow}
            >
              + Add row
            </Button>
          ) : null}
          <Button
            variant="quiet"
            size="sm"
            className="h-7 text-xs"
            render={
              <a href={`/datasets?dataset=${encodeURIComponent(tableId)}`} />
            }
          >
            Explore dataset
          </Button>
          {!readOnly ? (
            <Button
              type="button"
              variant="quiet"
              size="icon"
              aria-label="Configure table"
              onClick={() => setConfigurationOpen(true)}
            >
              <Settings className="size-4" />
            </Button>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="quiet"
                  size="icon"
                  aria-label="Sheet tools"
                  icon="more"
                />
              }
            />
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setTransferOpen(true)}>
                Export CSV
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setInspectorOpen(true)}>
                API inspector
              </DropdownMenuItem>
              {readOnly ? null : (
                <DropdownMenuItem
                  disabled={calculationResultsQuery.isFetching}
                  onClick={() => void refreshCalculation()}
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
            rowMutationPending={
              saveStatus === 'saving' || saveStatus === 'retrying'
            }
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
          <DialogHeader
            title="Sheet export"
            description="Export this Sheet with schema and unit metadata. Laboratory file import lives on Datasets and Records, not leftover scientific CSV."
          />
          <ScientificTransferPanel
            table={table}
            rows={allRowsQuery.data ?? []}
            readOnly={readOnly}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={inspectorOpen} onOpenChange={setInspectorOpen}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader
            title="API inspector"
            description="Sheet identity, fields, and authenticated request examples."
          />
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
