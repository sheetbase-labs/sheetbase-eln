import { useMemo, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

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
import { EmptyState } from '#/components/ui/empty-state'
import { Field, Input } from '#/components/ui/input'
import { Section } from '#/components/ui/layout'
import { Select } from '#/components/ui/select'
import { toast } from '#/components/ui/sonner'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { useWorkspaceMemberNames } from '#/components/pipelines/pipelines-data'
import {
  contractKeys,
  deleteContract,
  exportOdcs,
  importOdcs,
  removeRule,
  runCheck,
  saveContract,
} from '#/lib/data-contracts/client'
import { odcsFileName, odcsToYaml, parseOdcs } from '#/lib/data-contracts/odcs'
import {
  describeFinding,
  describeMinutes,
  describeRule,
  kindLabel,
  modeLabel,
} from '#/lib/data-contracts/rules'
import type {
  ContractLifecycle,
  ContractRule,
  ContractRuleResult,
  ContractRun,
  ContractTarget,
  DataContract,
} from '#/lib/data-contracts/types'
import { downloadTextFile } from '#/lib/download'
import { formatNotebookDateTime, notebookDataClient } from '#/lib/notebook-data'
import { ContractStatusBadge } from './contract-status'
import { useContractFields, useContractRuns } from './contract-data'
import { RuleDialog } from './rule-dialog'

const SCHEDULES = [0, 60, 360, 1440, 10080] as const

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The latest full check of each dataset, folded to what each rule found. */
function latestFindings(
  runs: ContractRun[],
): Map<string, ContractRuleResult[]> {
  const seen = new Set<string>()
  const byRule = new Map<string, ContractRuleResult[]>()
  for (const run of runs) {
    if (run.scope !== 'stored') continue
    const key = run.datasetId ?? ''
    if (seen.has(key)) continue
    seen.add(key)
    for (const result of run.results) {
      byRule.set(result.ruleId, [...(byRule.get(result.ruleId) ?? []), result])
    }
  }
  return byRule
}

/**
 * The Contract tab of a model: what good data looks like, whether the data
 * meets it, and the record of every check.
 */
export function ContractPanel({
  target,
  contract,
  canEdit,
}: {
  target: ContractTarget
  contract: DataContract | null
  canEdit: boolean
}) {
  const queryClient = useQueryClient()
  const fields = useContractFields(target)
  const runs = useContractRuns(contract?.id)
  const members = useWorkspaceMemberNames()
  const [editing, setEditing] = useState<ContractRule | null>(null)
  const [ruleOpen, setRuleOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)

  const refresh = (saved?: DataContract) => {
    if (saved) queryClient.setQueryData(contractKeys.target(target), saved)
    void queryClient.invalidateQueries({ queryKey: contractKeys.all })
  }
  const fail = (e: unknown) => setError(messageOf(e))
  const fieldLabel = (key: string | undefined) =>
    fields.find((option) => option.key === key)?.label ?? key ?? ''

  const start = useMutation({
    mutationFn: () => saveContract(notebookDataClient, { target }),
    onSuccess: (saved) => refresh(saved),
    onError: fail,
  })
  const update = useMutation({
    mutationFn: (patch: {
      lifecycle?: ContractLifecycle
      ownerUserId?: string
      scheduleMinutes?: number
      description?: string
    }) => saveContract(notebookDataClient, { target, ...patch }),
    onSuccess: (saved) => {
      refresh(saved)
      toast(t('contracts.panel.saved'))
    },
    onError: fail,
  })
  const check = useMutation({
    mutationFn: () => runCheck(notebookDataClient, contract?.id ?? ''),
    onSuccess: (outcome) => {
      refresh()
      toast(
        outcome.runs.length === 0
          ? t('contracts.panel.checkedNothing')
          : t('contracts.panel.checked'),
      )
    },
    onError: fail,
  })
  const remove = useMutation({
    mutationFn: (ruleId: string) =>
      removeRule(notebookDataClient, contract?.id ?? '', ruleId),
    onSuccess: (saved) => {
      refresh(saved)
      toast(t('contracts.rules.removed'))
    },
    onError: fail,
  })
  const destroy = useMutation({
    mutationFn: () => deleteContract(notebookDataClient, contract?.id ?? ''),
    onSuccess: () => {
      setConfirmDelete(false)
      refresh()
      toast(t('contracts.panel.deleted'))
    },
    onError: fail,
  })
  const importFile = useMutation({
    mutationFn: async (file: File) =>
      importOdcs(notebookDataClient, parseOdcs(await file.text()), target),
    onSuccess: (result) => {
      refresh(result.contract)
      toast(t('contracts.odcs.imported', { count: result.rulesImported }))
      if (result.ignored.length > 0)
        toast(t('contracts.odcs.left', { items: result.ignored.join(', ') }))
    },
    onError: fail,
  })
  const exportFile = useMutation({
    mutationFn: async () => {
      const document = await exportOdcs(notebookDataClient, contract?.id ?? '')
      downloadTextFile(
        odcsFileName(contract?.name ?? 'contract'),
        odcsToYaml(document),
        'application/yaml',
      )
    },
    onSuccess: () => toast(t('contracts.odcs.exported')),
    onError: fail,
  })

  const findings = useMemo(() => latestFindings(runs.data ?? []), [runs.data])
  const datasetNames = useQuery({
    queryKey: ['data-contracts', 'dataset-names', contract?.id],
    queryFn: async () => {
      const ids = [
        ...new Set(
          (runs.data ?? []).flatMap((run) =>
            run.datasetId ? [run.datasetId] : [],
          ),
        ),
      ]
      if (ids.length === 0) return {}
      const rows = await notebookDataClient.list<{
        id: string
        name: string
      }>('datasets', `?id=in.(${ids.join(',')})&select=id,name`)
      return Object.fromEntries(rows.map((row) => [row.id, row.name]))
    },
    enabled: (runs.data ?? []).length > 0,
  })

  if (!contract) {
    return (
      <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-auto px-4 py-5 md:px-6">
        <p className="text-fg-muted">{t('contracts.panel.intro')}</p>
        {error ? (
          <Banner tone="bad" title={t('contracts.panel.couldNotLoad')}>
            {error}
          </Banner>
        ) : null}
        <EmptyState
          icon="schema"
          title={t('contracts.panel.emptyTitle')}
          description={t('contracts.panel.emptyBody')}
          action={
            canEdit ? (
              <Button
                variant="primary"
                disabled={start.isPending}
                onClick={() => start.mutate()}
              >
                {start.isPending
                  ? t('contracts.panel.starting')
                  : t('contracts.panel.start')}
              </Button>
            ) : (
              <span className="text-fg-muted">
                {t('contracts.panel.readOnly')}
              </span>
            )
          }
        />
      </div>
    )
  }

  const ownerName = contract.ownerUserId
    ? (members.data?.[contract.ownerUserId] ?? null)
    : null

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5 overflow-auto px-4 py-5 md:px-6">
      <p className="text-fg-muted">{t('contracts.panel.intro')}</p>
      {error ? (
        <Banner tone="bad" title={t('contracts.panel.couldNotLoad')}>
          {error}
        </Banner>
      ) : null}
      {!canEdit ? (
        <Banner tone="info" title={t('contracts.panel.title')}>
          {t('contracts.panel.readOnly')}
        </Banner>
      ) : null}

      <Section
        title={t('contracts.panel.title')}
        action={
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={check.isPending || contract.rules.length === 0}
              onClick={() => check.mutate()}
            >
              {check.isPending
                ? t('contracts.panel.checking')
                : t('contracts.panel.checkNow')}
            </Button>
            <Button
              variant="quiet"
              disabled={exportFile.isPending}
              onClick={() => exportFile.mutate()}
            >
              {t('contracts.odcs.export')}
            </Button>
            {canEdit ? (
              <>
                <Button
                  variant="quiet"
                  disabled={importFile.isPending}
                  onClick={() => fileInput.current?.click()}
                >
                  {importFile.isPending
                    ? t('contracts.odcs.importing')
                    : t('contracts.odcs.import')}
                </Button>
                <input
                  ref={fileInput}
                  type="file"
                  accept=".yaml,.yml,.json,application/json,application/yaml"
                  className="sr-only"
                  aria-label={t('contracts.odcs.import')}
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    e.target.value = ''
                    if (file) importFile.mutate(file)
                  }}
                />
              </>
            ) : null}
          </div>
        }
      >
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-caption text-fg-muted">
              {t('contracts.panel.standing')}
            </dt>
            <dd>
              <ContractStatusBadge status={contract.lastStatus} />
            </dd>
          </div>
          <div>
            <dt className="text-caption text-fg-muted">
              {t('contracts.panel.state')}
            </dt>
            <dd>
              {canEdit ? (
                <Select
                  size="sm"
                  aria-label={t('contracts.panel.state')}
                  value={contract.lifecycle}
                  onChange={(e) =>
                    update.mutate({
                      lifecycle: e.target.value as ContractLifecycle,
                    })
                  }
                >
                  {(['draft', 'active', 'retired'] as const).map((state) => (
                    <option key={state} value={state}>
                      {t(`contracts.lifecycle.${state}`)}
                    </option>
                  ))}
                </Select>
              ) : (
                t(`contracts.lifecycle.${contract.lifecycle}`)
              )}
            </dd>
          </div>
          <div>
            <dt className="text-caption text-fg-muted">
              {t('contracts.panel.owner')}
            </dt>
            <dd>
              {canEdit ? (
                <Select
                  size="sm"
                  aria-label={t('contracts.panel.owner')}
                  value={contract.ownerUserId ?? ''}
                  onChange={(e) =>
                    e.target.value &&
                    update.mutate({ ownerUserId: e.target.value })
                  }
                >
                  {contract.ownerUserId ? null : (
                    <option value="">{t('contracts.panel.noOwner')}</option>
                  )}
                  {Object.entries(members.data ?? {}).map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </Select>
              ) : (
                (ownerName ?? t('contracts.panel.noOwner'))
              )}
            </dd>
          </div>
          <div>
            <dt className="text-caption text-fg-muted">
              {t('contracts.panel.schedule')}
            </dt>
            <dd>
              {canEdit ? (
                <Select
                  size="sm"
                  aria-label={t('contracts.panel.schedule')}
                  value={String(contract.scheduleMinutes ?? 0)}
                  onChange={(e) =>
                    update.mutate({ scheduleMinutes: Number(e.target.value) })
                  }
                >
                  {SCHEDULES.map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {minutes === 0
                        ? t('contracts.panel.scheduleOff')
                        : t('contracts.panel.scheduleEvery', {
                            every: describeMinutes(minutes),
                          })}
                    </option>
                  ))}
                </Select>
              ) : contract.scheduleMinutes ? (
                t('contracts.panel.scheduleEvery', {
                  every: describeMinutes(contract.scheduleMinutes),
                })
              ) : (
                t('contracts.panel.scheduleOff')
              )}
            </dd>
          </div>
          <div>
            <dt className="text-caption text-fg-muted">
              {t('contracts.panel.version')}
            </dt>
            <dd className="num">{contract.version}</dd>
          </div>
          <div>
            <dt className="text-caption text-fg-muted">
              {t('contracts.panel.lastChecked')}
            </dt>
            <dd>
              {contract.lastCheckedAt
                ? formatNotebookDateTime(contract.lastCheckedAt)
                : t('contracts.panel.never')}
            </dd>
          </div>
          {canEdit ? (
            <div className="sm:col-span-2">
              <Field label={t('contracts.panel.description')}>
                <Input
                  key={contract.updatedAt}
                  defaultValue={contract.description ?? ''}
                  placeholder={t('contracts.panel.descriptionHint')}
                  onBlur={(e) => {
                    const next = e.target.value.trim()
                    if (next !== (contract.description ?? ''))
                      update.mutate({ description: next })
                  }}
                />
              </Field>
            </div>
          ) : contract.description ? (
            <div className="sm:col-span-2">{contract.description}</div>
          ) : null}
        </dl>
      </Section>

      <Section
        title={t('contracts.rules.title')}
        count={contract.rules.length}
        action={
          canEdit ? (
            <Button
              onClick={() => {
                setEditing(null)
                setRuleOpen(true)
              }}
            >
              {t('contracts.rules.add')}
            </Button>
          ) : null
        }
      >
        <TableBox>
          <Table aria-label={t('contracts.rules.title')}>
            <TableHeader>
              <TableRow>
                <TableHead className="first:pl-3">
                  {t('contracts.rules.columns.rule')}
                </TableHead>
                <TableHead>{t('contracts.rules.columns.field')}</TableHead>
                <TableHead>{t('contracts.rules.columns.asks')}</TableHead>
                <TableHead>{t('contracts.rules.columns.mode')}</TableHead>
                <TableHead>{t('contracts.rules.columns.found')}</TableHead>
                {canEdit ? <TableHead /> : null}
              </TableRow>
            </TableHeader>
            <TableBody
              empty={t('contracts.rules.empty')}
              colSpan={canEdit ? 6 : 5}
            >
              {contract.rules.map((rule) => {
                const results = findings.get(rule.id)
                const failed = results?.find((r) => r.status === 'fail')
                return (
                  <TableRow key={rule.id}>
                    <TableCell className="first:pl-3">
                      {kindLabel(rule.kind)}
                    </TableCell>
                    <TableCell>
                      {rule.field ? fieldLabel(rule.field) : ''}
                    </TableCell>
                    <TableCell>{describeRule(rule)}</TableCell>
                    <TableCell>{modeLabel(rule.mode)}</TableCell>
                    <TableCell>
                      {!results
                        ? t('contracts.rules.notChecked')
                        : failed
                          ? describeFinding(
                              failed,
                              rule,
                              fieldLabel(rule.field),
                            )
                          : t('contracts.rules.passed')}
                    </TableCell>
                    {canEdit ? (
                      <TableCell align="right">
                        <Button
                          size="sm"
                          variant="quiet"
                          onClick={() => {
                            setEditing(rule)
                            setRuleOpen(true)
                          }}
                        >
                          {t('contracts.rules.edit')}
                        </Button>
                        <Button
                          size="sm"
                          variant="quiet"
                          disabled={remove.isPending}
                          onClick={() => remove.mutate(rule.id)}
                        >
                          {t('contracts.rules.remove')}
                        </Button>
                      </TableCell>
                    ) : null}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </TableBox>
      </Section>

      <Section title={t('contracts.history.title')} count={runs.data?.length}>
        <TableBox>
          <Table aria-label={t('contracts.history.title')}>
            <TableHeader>
              <TableRow>
                <TableHead className="first:pl-3">
                  {t('contracts.history.columns.when')}
                </TableHead>
                <TableHead>{t('contracts.history.columns.data')}</TableHead>
                <TableHead>{t('contracts.history.columns.result')}</TableHead>
                <TableHead>{t('contracts.history.columns.trigger')}</TableHead>
                <TableHead align="right">
                  {t('contracts.history.columns.rows')}
                </TableHead>
                <TableHead align="right">
                  {t('contracts.history.columns.problems')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody
              loading={runs.isLoading}
              empty={t('contracts.history.empty')}
              colSpan={6}
            >
              {(runs.data ?? []).map((run) => (
                <TableRow key={run.id}>
                  <TableCell className="first:pl-3">
                    {formatNotebookDateTime(run.createdAt)}
                  </TableCell>
                  <TableCell>
                    {run.datasetId ? (
                      <Link
                        to="/datasets/$datasetId"
                        params={{ datasetId: run.datasetId }}
                        className="text-link"
                      >
                        {datasetNames.data?.[run.datasetId] ?? run.datasetId}
                      </Link>
                    ) : run.scope === 'batch' ? (
                      t('contracts.history.batch')
                    ) : (
                      t('contracts.history.wholeModel')
                    )}
                  </TableCell>
                  <TableCell>
                    <ContractStatusBadge status={run.status} />
                    {run.blocked ? ` · ${t('contracts.history.blocked')}` : ''}
                  </TableCell>
                  <TableCell>
                    {t(`contracts.history.trigger.${run.trigger}`)}
                  </TableCell>
                  <TableCell align="right">{run.rowsChecked}</TableCell>
                  <TableCell align="right">{run.failedRules}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableBox>
      </Section>

      {canEdit ? (
        <div>
          <Button variant="quiet" onClick={() => setConfirmDelete(true)}>
            {t('contracts.panel.delete')}
          </Button>
        </div>
      ) : null}

      <RuleDialog
        contract={contract}
        rule={editing}
        fields={fields}
        open={ruleOpen}
        onOpenChange={setRuleOpen}
        onSaved={(saved) => {
          refresh(saved)
          toast(t(editing ? 'contracts.form.changed' : 'contracts.form.added'))
        }}
      />
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent role="alertdialog">
          <DialogHeader
            title={t('contracts.panel.deleteTitle')}
            description={t('contracts.panel.deleteBody')}
          />
          <DialogBody>{null}</DialogBody>
          <DialogFooter>
            <Button variant="quiet" onClick={() => setConfirmDelete(false)}>
              {t('common.actions.cancel')}
            </Button>
            <Button
              variant="danger"
              disabled={destroy.isPending}
              onClick={() => destroy.mutate()}
            >
              {t('contracts.panel.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
