import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'

import { t } from '#/copy'
import { Banner } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { Field, Input } from '#/components/ui/input'
import { Select } from '#/components/ui/select'
import {
  addRule,
  previewRules,
  saveContract,
} from '#/lib/data-contracts/client'
import {
  BLANK_DRAFT,
  contractTarget,
  describeFinding,
  draftProblem,
  draftToRule,
  isFieldRule,
  kindLabel,
  modeLabel,
  ruleToDraft,
} from '#/lib/data-contracts/rules'
import type { RuleDraft } from '#/lib/data-contracts/rules'
import { CONTRACT_RULE_KINDS } from '#/lib/data-contracts/types'
import type {
  ContractPreviewEntry,
  ContractRule,
  DataContract,
} from '#/lib/data-contracts/types'
import { notebookDataClient } from '#/lib/notebook-data'
import type { ContractFieldOption } from './contract-data'

/** Add a rule, or change one. Changing one replaces it, keeping its id. */
export function RuleDialog({
  contract,
  rule,
  fields,
  open,
  onOpenChange,
  onSaved,
}: {
  contract: DataContract
  rule: ContractRule | null
  fields: ContractFieldOption[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: (contract: DataContract) => void
}) {
  const [draft, setDraft] = useState<RuleDraft>(BLANK_DRAFT)
  const [preview, setPreview] = useState<ContractPreviewEntry[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setDraft(rule ? ruleToDraft(rule) : BLANK_DRAFT)
    setPreview(null)
    setError('')
  }, [open, rule])

  const problem = draftProblem(draft)
  const set = (patch: Partial<RuleDraft>) => {
    setDraft((current) => ({ ...current, ...patch }))
    setPreview(null)
  }
  const fieldLabel = (key: string) =>
    fields.find((field) => field.key === key)?.label ?? key

  const check = useMutation({
    mutationFn: () => {
      const candidate = draftToRule(draft, rule?.id ?? 'preview')
      const others = contract.rules.filter((r) => r.id !== rule?.id)
      return previewRules(notebookDataClient, contract.id, [
        ...others,
        candidate,
      ])
    },
    onSuccess: (entries) => setPreview(entries),
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  })

  const save = useMutation({
    mutationFn: async () => {
      const next = draftToRule(draft, rule?.id)
      if (!rule) return addRule(notebookDataClient, contract.id, next)
      return saveContract(notebookDataClient, {
        target: contractTarget(contract),
        rules: contract.rules.map((r) => (r.id === rule.id ? next : r)),
      })
    },
    onSuccess: (saved) => {
      onSaved(saved)
      onOpenChange(false)
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  })

  const findings = (preview ?? []).flatMap((entry) =>
    entry.results
      .filter(
        (result) =>
          result.status === 'fail' && result.ruleId === (rule?.id ?? 'preview'),
      )
      .map((result) => ({
        key: `${entry.datasetId ?? 'all'}-${result.ruleId}`,
        text: describeFinding(
          result,
          contract.rules.find((r) => r.id === result.ruleId) ??
            draftToRule(draft),
          fieldLabel(result.field ?? ''),
        ),
        dataset: entry.datasetName,
      })),
  )
  const field = isFieldRule(draft.kind)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader
          title={t(
            rule ? 'contracts.form.editTitle' : 'contracts.form.addTitle',
          )}
          description={t(`contracts.kindHint.${draft.kind}`)}
        />
        <DialogBody>
          <Field label={t('contracts.form.kind')}>
            <Select
              value={draft.kind}
              disabled={Boolean(rule)}
              onChange={(e) =>
                set({ kind: e.target.value as RuleDraft['kind'] })
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
                onChange={(e) => set({ field: e.target.value })}
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
                  onChange={(e) => set({ min: e.target.value })}
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
                  onChange={(e) => set({ max: e.target.value })}
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
                onChange={(e) => set({ units: e.target.value })}
              />
            </Field>
          ) : null}
          {draft.kind === 'completeness' ? (
            <Field label={t('contracts.form.threshold')}>
              <Input
                inputMode="decimal"
                value={draft.threshold}
                onChange={(e) => set({ threshold: e.target.value })}
              />
            </Field>
          ) : null}
          {draft.kind === 'freshness' ? (
            <div className="grid grid-cols-[1fr_auto] items-end gap-3">
              <Field label={t('contracts.form.maxAge')}>
                <Input
                  inputMode="numeric"
                  value={draft.maxAge}
                  onChange={(e) => set({ maxAge: e.target.value })}
                />
              </Field>
              <Select
                aria-label={t('contracts.form.maxAge')}
                value={draft.maxAgeUnit}
                onChange={(e) =>
                  set({ maxAgeUnit: e.target.value as RuleDraft['maxAgeUnit'] })
                }
              >
                {(['minutes', 'hours', 'days'] as const).map((unit) => (
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
                set({ mode: e.target.value as RuleDraft['mode'] })
              }
            >
              {(['warn', 'block'] as const).map((mode) => (
                <option key={mode} value={mode}>
                  {modeLabel(mode)}
                </option>
              ))}
            </Select>
          </Field>

          <div className="flex flex-col gap-2 rounded-md border border-border-subtle p-3">
            <div className="font-medium">
              {t('contracts.form.previewTitle')}
            </div>
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
              <Button
                disabled={Boolean(problem) || check.isPending}
                onClick={() => check.mutate()}
              >
                {check.isPending
                  ? t('contracts.form.previewing')
                  : t('contracts.form.previewRun')}
              </Button>
            </div>
          </div>
          {problem ? (
            <p className="text-caption text-fg-muted">{problem}</p>
          ) : null}
          {error ? (
            <Banner tone="bad" title={t('contracts.panel.couldNotLoad')}>
              {error}
            </Banner>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="quiet" onClick={() => onOpenChange(false)}>
            {t('common.actions.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={Boolean(problem) || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending
              ? t('contracts.form.saving')
              : t(
                  rule
                    ? 'contracts.form.submitEdit'
                    : 'contracts.form.submitAdd',
                )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
