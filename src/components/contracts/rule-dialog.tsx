import { useState } from 'react'
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
  ruleToDraft,
} from '#/lib/data-contracts/rules'
import type { RuleDraft } from '#/lib/data-contracts/rules'
import type {
  ContractPreviewEntry,
  ContractRule,
  DataContract,
} from '#/lib/data-contracts/types'
import { notebookDataClient } from '#/lib/notebook-data'
import type { ContractFieldOption } from './contract-data'
import { RuleConditionFields, RulePreviewPanel } from './rule-dialog-fields'
import type { RuleFinding } from './rule-dialog-fields'

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
  const [previewing, setPreviewing] = useState(false)
  const [error, setError] = useState('')

  // Re-seed the form whenever it is opened, or opened on another rule.
  const [seed, setSeed] = useState<{
    open: boolean
    rule: ContractRule | null
  }>({ open: false, rule: null })

  if (open !== seed.open || rule !== seed.rule) {
    setSeed({ open, rule })
    setDraft(rule ? ruleToDraft(rule) : BLANK_DRAFT)
    setPreview(null)
    setError('')
  }

  const problem = draftProblem(draft)

  const set = (patch: Partial<RuleDraft>) => {
    setDraft((current) => ({ ...current, ...patch }))
    setPreview(null)
  }

  const fieldLabel = (key: string) =>
    fields.find((field) => field.key === key)?.label ?? key

  const runPreview = () => {
    setPreviewing(true)

    const candidate = draftToRule(draft, rule?.id ?? 'preview')
    const others = contract.rules.filter((r) => r.id !== rule?.id)

    void previewRules(notebookDataClient, contract.id, [...others, candidate])
      .then((entries) => setPreview(entries))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setPreviewing(false))
  }

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
      .map((result): RuleFinding => ({
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
          <RuleConditionFields
            draft={draft}
            fields={fields}
            disabled={Boolean(rule)}
            onChange={set}
          />
          <RulePreviewPanel
            preview={preview}
            findings={findings}
            pending={previewing}
            disabled={Boolean(problem)}
            onRun={runPreview}
          />
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
