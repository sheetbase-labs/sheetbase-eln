import { t } from '#/copy'
import { Button } from '#/components/ui/button'
import { Field, Input } from '#/components/ui/input'
import { Select } from '#/components/ui/select'
import { isFieldRule, kindLabel, modeLabel } from '#/lib/data-contracts/rules'
import type { RuleDraft } from '#/lib/data-contracts/rules'
import { CONTRACT_RULE_KINDS } from '#/lib/data-contracts/types'
import type { ContractPreviewEntry } from '#/lib/data-contracts/types'
import type { ContractFieldOption } from './contract-data'

/**
 * The internals of the contract rule dialog: the condition fields each rule
 * kind needs, and the preview that shows what the rule would flag. They are
 * kept apart from the dialog so each renders one thing and the dialog itself
 * stays a short sequence of decisions.
 */

const MAX_AGE_UNITS = ['minutes', 'hours', 'days'] as const
const RULE_MODES = ['warn', 'block'] as const

/** One option of a native select, decoded back to the rule's own union. */
function oneOf<T extends string>(
  options: readonly T[],
  value: string,
  fallback: T,
): T {
  return options.find((option) => option === value) ?? fallback
}

/** The fields that describe a rule's condition, for the kind it is. */
export function RuleConditionFields({
  draft,
  fields,
  onChange,
  disabled,
}: {
  draft: RuleDraft
  fields: ContractFieldOption[]
  onChange: (patch: Partial<RuleDraft>) => void
  disabled: boolean
}) {
  const field = isFieldRule(draft.kind)

  return (
    <>
      <Field label={t('contracts.form.kind')}>
        <Select
          value={draft.kind}
          disabled={disabled}
          onChange={(e) =>
            onChange({
              kind: oneOf(CONTRACT_RULE_KINDS, e.target.value, draft.kind),
            })
          }
        >
          {CONTRACT_RULE_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {kindLabel(kind)}
            </option>
          ))}
        </Select>
      </Field>
      {field ? (
        <Field label={t('contracts.form.field')}>
          <Select
            value={draft.field}
            onChange={(e) => onChange({ field: e.target.value })}
          >
            <option value="">{t('contracts.form.pickField')}</option>
            {fields.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      {draft.kind === 'range' || draft.kind === 'row_count' ? (
        <div className="grid grid-cols-2 gap-3">
          <Field
            label={t(
              draft.kind === 'range'
                ? 'contracts.form.min'
                : 'contracts.form.minRows',
            )}
          >
            <Input
              inputMode="decimal"
              value={draft.min}
              onChange={(e) => onChange({ min: e.target.value })}
            />
          </Field>
          <Field
            label={t(
              draft.kind === 'range'
                ? 'contracts.form.max'
                : 'contracts.form.maxRows',
            )}
          >
            <Input
              inputMode="decimal"
              value={draft.max}
              onChange={(e) => onChange({ max: e.target.value })}
            />
          </Field>
        </div>
      ) : null}
      {draft.kind === 'units' ? (
        <Field
          label={t('contracts.form.units')}
          hint={t('contracts.form.unitsHint')}
        >
          <Input
            value={draft.units}
            onChange={(e) => onChange({ units: e.target.value })}
          />
        </Field>
      ) : null}
      {draft.kind === 'completeness' ? (
        <Field label={t('contracts.form.threshold')}>
          <Input
            inputMode="decimal"
            value={draft.threshold}
            onChange={(e) => onChange({ threshold: e.target.value })}
          />
        </Field>
      ) : null}
      {draft.kind === 'freshness' ? (
        <div className="grid grid-cols-[1fr_auto] items-end gap-3">
          <Field label={t('contracts.form.maxAge')}>
            <Input
              inputMode="numeric"
              value={draft.maxAge}
              onChange={(e) => onChange({ maxAge: e.target.value })}
            />
          </Field>
          <Select
            aria-label={t('contracts.form.maxAge')}
            value={draft.maxAgeUnit}
            onChange={(e) =>
              onChange({
                maxAgeUnit: oneOf(
                  MAX_AGE_UNITS,
                  e.target.value,
                  draft.maxAgeUnit,
                ),
              })
            }
          >
            {MAX_AGE_UNITS.map((unit) => (
              <option key={unit} value={unit}>
                {t(`contracts.durationUnit.${unit}`)}
              </option>
            ))}
          </Select>
        </div>
      ) : null}
      <Field
        label={t('contracts.form.mode')}
        hint={t(`contracts.modeHint.${draft.mode}`)}
      >
        <Select
          value={draft.mode}
          onChange={(e) =>
            onChange({ mode: oneOf(RULE_MODES, e.target.value, draft.mode) })
          }
        >
          {RULE_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {modeLabel(mode)}
            </option>
          ))}
        </Select>
      </Field>
    </>
  )
}

/** One finding the preview reports, named by the dataset it was seen in. */
export interface RuleFinding {
  key: string
  text: string
  dataset?: string
}

/** The preview block: run the rule, and show what it would flag. */
export function RulePreviewPanel({
  preview,
  findings,
  pending,
  disabled,
  onRun,
}: {
  preview: ContractPreviewEntry[] | null
  findings: RuleFinding[]
  pending: boolean
  disabled: boolean
  onRun: () => void
}) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border-subtle p-3">
      <div className="font-medium">{t('contracts.form.previewTitle')}</div>
      <p className="text-caption text-fg-muted">
        {t('contracts.form.previewBody')}
      </p>
      {preview === null ? null : findings.length === 0 ? (
        <p className="text-fg-muted">
          {preview.length === 0
            ? t('contracts.form.previewNoData')
            : t('contracts.form.previewClean')}
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {findings.map((finding) => (
            <li key={finding.key}>
              {finding.dataset
                ? t('contracts.form.previewDataset', {
                    dataset: finding.dataset,
                    finding: finding.text,
                  })
                : finding.text}
            </li>
          ))}
        </ul>
      )}
      <div>
        <Button disabled={disabled || pending} onClick={onRun}>
          {pending
            ? t('contracts.form.previewing')
            : t('contracts.form.previewRun')}
        </Button>
      </div>
    </div>
  )
}
