import { t } from '#/copy'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Icon } from '#/components/icons'
import {
  preflightScientificConversion,
  preflightScientificRetirement,
  scientificDataClient,
  updateScientificColumnDisplay,
} from '#/lib/scientific-sheet-data'
import type {
  ScientificColumnWire,
  ScientificLogicalType,
  ScientificSchemaEvidence,
} from '#/lib/scientific-sheet-data'

type SchemaMutation = (run: (version: number) => PromiseLike<object>) => void

type Confirmation =
  | {
      kind: 'convert'
      targetType: ScientificLogicalType
      column: ScientificColumnWire
      evidence: ScientificSchemaEvidence
    }
  | {
      kind: 'retire'
      column: ScientificColumnWire
      evidence: ScientificSchemaEvidence
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

const selectClass =
  'h-8 rounded-md border border-border bg-surface px-2 text-xs shadow-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50'

export function ScientificSchemaColumn({
  column,
  index,
  last,
  disabled,
  blocked,
  schemaVersion,
  mutate,
  onStatus,
  onConfirm,
}: {
  column: ScientificColumnWire
  index: number
  last: boolean
  disabled: boolean
  blocked: boolean
  schemaVersion: () => number
  mutate: SchemaMutation
  onStatus: (message: string) => void
  onConfirm: (confirmation: Confirmation) => void
}) {
  const checkConversion = async (next: ScientificLogicalType) => {
    try {
      onStatus(
        t('notebook.scientificSheetBlock.checkingConversionConsequences'),
      )

      const evidence = await preflightScientificConversion(
        scientificDataClient,
        column.id,
        schemaVersion(),
        next,
      )

      if (!('hash' in evidence)) return
      onConfirm({ kind: 'convert', targetType: next, column, evidence })
      onStatus(t('notebook.scientificSheetBlock.reviewAndConfirmThe'))
    } catch (error) {
      onStatus(
        t('notebook.scientificSheetBlock.conversionRejected', {
          reason: error instanceof Error ? error.message : '',
        }),
      )
    }
  }

  const checkRetirement = async () => {
    try {
      onStatus(
        t('notebook.scientificSheetBlock.checkingRetirementConsequences'),
      )

      const evidence = await preflightScientificRetirement(
        scientificDataClient,
        column.id,
        schemaVersion(),
      )

      if (!('hash' in evidence)) return
      onConfirm({ kind: 'retire', column, evidence })
      onStatus(t('notebook.scientificSheetBlock.reviewAndConfirmRetirement'))
    } catch (error) {
      onStatus(
        t('notebook.scientificSheetBlock.retirementCheckFailed', {
          reason: error instanceof Error ? error.message : '',
        }),
      )
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-2 rounded-md border bg-surface/40 p-2">
      <Input
        aria-label={t('notebook.scientificSheetBlock.labelForLabelAriaLabel', {
          label: column.label,
        })}
        defaultValue={column.label}
        onBlur={(e) => {
          const label = e.target.value

          if (label !== column.label)
            mutate((v) =>
              updateScientificColumnDisplay(
                scientificDataClient,
                column.id,
                v,
                label,
                null,
              ),
            )
        }}
        className="h-8 min-w-36 flex-1"
      />
      <Badge variant="chg">{column.logical_type}</Badge>
      <Badge variant="kind">{column.nullable ? 'nullable' : 'required'}</Badge>
      <select
        aria-label={t('notebook.scientificSheetBlock.convertLabelAriaLabel', {
          label: column.label,
        })}
        defaultValue=""
        className={selectClass}
        disabled={disabled || blocked}
        onChange={(e) => {
          const next = LOGICAL_TYPES.find((value) => value === e.target.value)
          e.target.value = ''

          if (next) void checkConversion(next)
        }}
      >
        <option value="">{t('notebook.scientificSheetBlock.convert')}</option>
        {LOGICAL_TYPES.flatMap((value) =>
          value !== column.logical_type
            ? [<option key={value}>{value}</option>]
            : [],
        )}
      </select>
      <Button
        type="button"
        variant="quiet"
        size="icon"
        aria-label={t('notebook.scientificSheetBlock.moveLeftAriaLabel')}
        disabled={disabled || index === 0}
        onClick={() =>
          mutate((v) =>
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
        <Icon name="chevronRight" className="size-4 rotate-180" />
      </Button>
      <Button
        type="button"
        variant="quiet"
        size="icon"
        aria-label={t('notebook.scientificSheetBlock.moveRightAriaLabel')}
        disabled={disabled || last}
        onClick={() =>
          mutate((v) =>
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
        <Icon name="chevronRight" className="size-4" />
      </Button>
      <Button
        type="button"
        variant="quiet"
        size="sm"
        disabled={disabled || blocked}
        onClick={() => void checkRetirement()}
      >
        {t('notebook.scientificSheetBlock.retire')}
      </Button>
    </li>
  )
}

export function ScientificSchemaConfirmation({
  confirmation,
  blocked,
  disabled,
  dependencyCount,
  mutate,
  onCancel,
}: {
  confirmation: Confirmation
  blocked: boolean
  disabled: boolean
  dependencyCount: number
  mutate: SchemaMutation
  onCancel: () => void
}) {
  return (
    <div
      role="alert"
      aria-label={t(
        'notebook.scientificSheetBlock.confirmSchemaChangeAriaLabel',
      )}
      className="space-y-2 rounded-md border border-destructive/50 bg-destructive/5 p-3 text-xs"
    >
      <strong className="font-medium">
        {t('notebook.scientificSheetBlock.confirmKindOfLabel', {
          kind: confirmation.kind,
          label: confirmation.column.label,
        })}
      </strong>
      <p>
        {t('notebook.scientificSheetBlock.nonNullRowsNonnullrows', {
          nonNullRows: confirmation.evidence.nonNullRows ?? 'n/a',
          invalidRows: confirmation.evidence.invalidRows ?? 'n/a',
          formulaMarkers: confirmation.evidence.formulaMarkers,
          size: dependencyCount,
        })}
      </p>
      <p className="text-fg-muted">
        {t('notebook.scientificSheetBlock.thisCanAffectFormulas', {
          field_name: confirmation.column.field_name,
        })}
      </p>
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant="danger"
          disabled={
            disabled ||
            blocked ||
            (confirmation.kind === 'convert' &&
              ((confirmation.evidence.invalidRows ?? 0) > 0 ||
                confirmation.evidence.formulaMarkers > 0))
          }
          onClick={() =>
            mutate(() =>
              confirmation.kind === 'convert'
                ? preflightScientificConversion(
                    scientificDataClient,
                    confirmation.column.id,
                    confirmation.evidence.schemaVersion,
                    confirmation.targetType,
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
          {t('notebook.scientificSheetBlock.confirmChange')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={disabled}
          onClick={onCancel}
        >
          {t('common.actions.cancel')}
        </Button>
      </div>
    </div>
  )
}
