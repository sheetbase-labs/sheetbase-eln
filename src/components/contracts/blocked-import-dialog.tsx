import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { t } from '#/copy'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { contractKeys, fetchContractById } from '#/lib/data-contracts/client'
import { describeFinding, kindLabel, contractTarget  } from '#/lib/data-contracts/rules'
import { blockingResults } from '#/lib/data-contracts/gate'
import type { ContractGateReport } from '#/lib/data-contracts/types'
import { notebookDataClient } from '#/lib/notebook-data'
import { useContractFields } from './contract-data'

/**
 * What an import was refused for: the blocking rules that were broken, with the
 * rows that broke them, and a way to the contract.
 */
export function BlockedImportDialog({
  report,
  open,
  onOpenChange,
}: {
  report: ContractGateReport | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const contractId = report?.contractId
  const contract = useQuery({
    queryKey: [...contractKeys.all, 'by-id', contractId],
    queryFn: () => fetchContractById(notebookDataClient, contractId ?? ''),
    enabled: open && Boolean(contractId),
  })
  const fields = useContractFields(
    contract.data ? contractTarget(contract.data) : null,
  )
  const fieldLabel = (key: string) =>
    fields.find((field) => field.key === key)?.label ?? key
  const modelId =
    contract.data?.datasetSchemaId ?? contract.data?.recordModelKey ?? null
  const results = report ? blockingResults(report) : []

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader
          title={t('contracts.blocked.title')}
          description={t('contracts.blocked.body', {
            contract: report?.contractName ?? '',
          })}
        />
        <DialogBody>
          <ul className="flex flex-col gap-3">
            {results.map((result) => {
              const rule = contract.data?.rules.find(
                (candidate) => candidate.id === result.ruleId,
              )
              const rows = (result.samples ?? []).map((sample) => sample.row)
              return (
                <li key={result.ruleId} className="flex flex-col gap-0.5">
                  <span className="font-medium">
                    {result.field
                      ? t('contracts.blocked.rule', {
                          rule: kindLabel(result.kind),
                          field: fieldLabel(result.field),
                        })
                      : t('contracts.blocked.ruleNoField', {
                          rule: kindLabel(result.kind),
                        })}
                  </span>
                  <span className="text-fg-muted">
                    {describeFinding(
                      result,
                      rule,
                      fieldLabel(result.field ?? ''),
                    )}
                  </span>
                  {rows.length > 0 ? (
                    <span className="text-caption text-fg-muted">
                      {t('contracts.blocked.rows', { rows: rows.join(', ') })}
                    </span>
                  ) : null}
                </li>
              )
            })}
          </ul>
          <p className="text-caption text-fg-muted">
            {t('contracts.blocked.fix')}
          </p>
        </DialogBody>
        <DialogFooter>
          {modelId ? (
            <Button
              variant="quiet"
              render={
                <Link to="/models/$modelId/contract" params={{ modelId }} />
              }
            >
              {t('contracts.blocked.viewContract')}
            </Button>
          ) : null}
          <Button onClick={() => onOpenChange(false)}>
            {t('common.actions.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
