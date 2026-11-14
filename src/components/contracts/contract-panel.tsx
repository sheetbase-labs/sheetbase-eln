import { SearchableSelect } from '#/components/record-picker/searchable-select'
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
import { TableBox } from '#/components/ui/table'
import {
  RegistryGrid,
  rightAligned,
} from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
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

/** Every state a contract can be moved to, in the order the select offers them. */
const LIFECYCLES = [
  'draft',
  'active',
  'retired',
] as const satisfies readonly ContractLifecycle[]

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Caught transport failures are external; an Error supplies its message and a primitive rejection keeps its text form.
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The contract fields the standing panel can change. */
interface ContractPatch {
  lifecycle?: ContractLifecycle
  ownerUserId?: string
  scheduleMinutes?: number
  description?: string
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

/** The contract's lifecycle, as a select for an editor and as text for a reader. */
function LifecycleValue({
  contract,
  canEdit,
  update,
}: {
  contract: DataContract
  canEdit: boolean
  update: (patch: ContractPatch) => void
}) {
  if (!canEdit) return t(`contracts.lifecycle.${contract.lifecycle}`)

  const choose = (value: string) => {
    const lifecycle = LIFECYCLES.find((state) => state === value)

    if (lifecycle) update({ lifecycle })
  }

  return (
    <Select
      size="sm"
      aria-label={t('contracts.panel.state')}
      value={contract.lifecycle}
      onChange={(e) => choose(e.target.value)}
    >
      {LIFECYCLES.map((state) => (
        <option key={state} value={state}>
          {t(`contracts.lifecycle.${state}`)}
        </option>
      ))}
    </Select>
  )
}

/** The contract's owner: whoever the workspace names, or the reader's fallback. */
function OwnerValue({
  contract,
  canEdit,
  members,
  ownerName,
  update,
}: {
  contract: DataContract
  canEdit: boolean
  members: Record<string, string> | undefined
  ownerName: string | null
  update: (patch: ContractPatch) => void
}) {
  if (!canEdit) return ownerName ?? t('contracts.panel.noOwner')

  return (
    <SearchableSelect
      noun="member"
      size="sm"
      aria-label={t('contracts.panel.owner')}
      value={contract.ownerUserId ?? ''}
      onValueChange={(value) => {
        if (value) update({ ownerUserId: value })
      }}
    >
      {contract.ownerUserId ? null : (
        <option value="">{t('contracts.panel.noOwner')}</option>
      )}
      {Object.entries(members ?? {}).map(([id, name]) => (
        <option key={id} value={id}>
          {name}
        </option>
      ))}
    </SearchableSelect>
  )
}

/** How often the contract checks itself, as a select or as its schedule. */
function ScheduleValue({
  contract,
  canEdit,
  update,
}: {
  contract: DataContract
  canEdit: boolean
  update: (patch: ContractPatch) => void
}) {
  if (!canEdit) {
    return contract.scheduleMinutes
      ? t('contracts.panel.scheduleEvery', {
          every: describeMinutes(contract.scheduleMinutes),
        })
      : t('contracts.panel.scheduleOff')
  }

  return (
    <Select
      size="sm"
      aria-label={t('contracts.panel.schedule')}
      value={String(contract.scheduleMinutes ?? 0)}
      onChange={(e) => update({ scheduleMinutes: Number(e.target.value) })}
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
  )
}

/** The tab before any contract exists, and its start action. */
function ContractEmptyPanel({
  error,
  canEdit,
  starting,
  onStart,
}: {
  error: string
  canEdit: boolean
  starting: boolean
  onStart: () => void
}) {
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
            <Button variant="primary" disabled={starting} onClick={onStart}>
              {starting
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

/** Everything the contract says about itself: its standing, owner and schedule. */
function ContractStanding({
  contract,
  canEdit,
  members,
  ownerName,
  update,
}: {
  contract: DataContract
  canEdit: boolean
  members: Record<string, string> | undefined
  ownerName: string | null
  update: (patch: ContractPatch) => void
}) {
  return (
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
          <LifecycleValue
            contract={contract}
            canEdit={canEdit}
            update={update}
          />
        </dd>
      </div>
      <div>
        <dt className="text-caption text-fg-muted">
          {t('contracts.panel.owner')}
        </dt>
        <dd>
          <OwnerValue
            contract={contract}
            canEdit={canEdit}
            members={members}
            ownerName={ownerName}
            update={update}
          />
        </dd>
      </div>
      <div>
        <dt className="text-caption text-fg-muted">
          {t('contracts.panel.schedule')}
        </dt>
        <dd>
          <ScheduleValue
            contract={contract}
            canEdit={canEdit}
            update={update}
          />
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
                  update({ description: next })
              }}
            />
          </Field>
        </div>
      ) : contract.description ? (
        <div className="sm:col-span-2">{contract.description}</div>
      ) : null}
    </dl>
  )
}

/** Every rule the contract states, and what the latest check found for each. */
function ContractRulesSection({
  contract,
  canEdit,
  findings,
  fieldLabel,
  onAdd,
  onEdit,
  onRemove,
  removing,
}: {
  contract: DataContract
  canEdit: boolean
  findings: Map<string, ContractRuleResult[]>
  fieldLabel: (key: string | undefined) => string
  onAdd: () => void
  onEdit: (rule: ContractRule) => void
  onRemove: (ruleId: string) => void
  removing: boolean
}) {
  const columns: RegistryColumn<ContractRule>[] = [
    {
      id: 'rule',
      header: t('contracts.rules.columns.rule'),
      accessorFn: (rule) => kindLabel(rule.kind),
    },
    {
      id: 'field',
      header: t('contracts.rules.columns.field'),
      accessorFn: (rule) => (rule.field ? fieldLabel(rule.field) : ''),
    },
    {
      id: 'asks',
      header: t('contracts.rules.columns.asks'),
      accessorFn: (rule) => describeRule(rule),
    },
    {
      id: 'mode',
      header: t('contracts.rules.columns.mode'),
      accessorFn: (rule) => modeLabel(rule.mode),
    },
    {
      id: 'found',
      header: t('contracts.rules.columns.found'),
      enableSorting: false,
      cell: ({ row }) => {
        const rule = row.original
        const results = findings.get(rule.id)
        const failed = results?.find((r) => r.status === 'fail')

        return !results
          ? t('contracts.rules.notChecked')
          : failed
            ? describeFinding(failed, rule, fieldLabel(rule.field))
            : t('contracts.rules.passed')
      },
    },
    ...(canEdit
      ? [
          {
            id: 'actions',
            header: '',
            enableHiding: false,
            enableSorting: false,
            cell: ({ row }) => (
              <span className="flex justify-end gap-1">
                <Button
                  size="sm"
                  variant="quiet"
                  onClick={() => onEdit(row.original)}
                >
                  {t('contracts.rules.edit')}
                </Button>
                <Button
                  size="sm"
                  variant="quiet"
                  disabled={removing}
                  onClick={() => onRemove(row.original.id)}
                >
                  {t('contracts.rules.remove')}
                </Button>
              </span>
            ),
          } satisfies RegistryColumn<ContractRule>,
        ]
      : []),
  ]

  return (
    <Section
      title={t('contracts.rules.title')}
      count={contract.rules.length}
      action={
        canEdit ? (
          <Button onClick={onAdd}>{t('contracts.rules.add')}</Button>
        ) : null
      }
    >
      <TableBox>
        <RegistryGrid
          label={t('contracts.rules.title')}
          rows={contract.rules}
          columns={columns}
          getRowId={(rule) => rule.id}
          selectable={false}
          empty={t('contracts.rules.empty')}
        />
      </TableBox>
    </Section>
  )
}

/** The record of every check the contract has run. */
function ContractHistorySection({
  runs,
  datasetNames,
  loading,
}: {
  runs: ContractRun[]
  datasetNames: Record<string, string>
  loading: boolean
}) {
  const columns: RegistryColumn<ContractRun>[] = [
    {
      id: 'when',
      header: t('contracts.history.columns.when'),
      accessorFn: (run) => run.createdAt,
      cell: ({ row }) => formatNotebookDateTime(row.original.createdAt),
    },
    {
      id: 'data',
      header: t('contracts.history.columns.data'),
      enableSorting: false,
      cell: ({ row }) => {
        const run = row.original

        return run.datasetId ? (
          <Link
            to="/datasets/$datasetId"
            params={{ datasetId: run.datasetId }}
            className="text-link"
          >
            {datasetNames[run.datasetId] ?? run.datasetId}
          </Link>
        ) : run.scope === 'batch' ? (
          t('contracts.history.batch')
        ) : (
          t('contracts.history.wholeModel')
        )
      },
    },
    {
      id: 'result',
      header: t('contracts.history.columns.result'),
      accessorFn: (run) => run.status,
      cell: ({ row }) => (
        <>
          <ContractStatusBadge status={row.original.status} />
          {row.original.blocked ? ` · ${t('contracts.history.blocked')}` : ''}
        </>
      ),
    },
    {
      id: 'trigger',
      header: t('contracts.history.columns.trigger'),
      accessorFn: (run) => t(`contracts.history.trigger.${run.trigger}`),
    },
    {
      id: 'rows',
      header: t('contracts.history.columns.rows'),
      accessorFn: (run) => run.rowsChecked,
      ...rightAligned<ContractRun>(),
    },
    {
      id: 'problems',
      header: t('contracts.history.columns.problems'),
      accessorFn: (run) => run.failedRules,
      ...rightAligned<ContractRun>(),
    },
  ]

  return (
    <Section title={t('contracts.history.title')} count={runs.length}>
      <TableBox>
        <RegistryGrid
          label={t('contracts.history.title')}
          rows={runs}
          columns={columns}
          getRowId={(run) => run.id}
          selectable={false}
          isLoading={loading}
          empty={t('contracts.history.empty')}
        />
      </TableBox>
    </Section>
  )
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

  const fail = (cause: Error) => setError(messageOf(cause))

  const fieldLabel = (key: string | undefined) =>
    fields.find((option) => option.key === key)?.label ?? key ?? ''

  const start = useMutation({
    mutationFn: () => saveContract(notebookDataClient, { target }),
    onSuccess: (saved) => refresh(saved),
    onError: fail,
  })

  const update = useMutation({
    mutationFn: (patch: ContractPatch) =>
      saveContract(notebookDataClient, { target, ...patch }),
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
      <ContractEmptyPanel
        error={error}
        canEdit={canEdit}
        starting={start.isPending}
        onStart={() => start.mutate()}
      />
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
        <ContractStanding
          contract={contract}
          canEdit={canEdit}
          members={members.data}
          ownerName={ownerName}
          update={update.mutate}
        />
      </Section>

      <ContractRulesSection
        contract={contract}
        canEdit={canEdit}
        findings={findings}
        fieldLabel={fieldLabel}
        onAdd={() => {
          setEditing(null)
          setRuleOpen(true)
        }}
        onEdit={(rule) => {
          setEditing(rule)
          setRuleOpen(true)
        }}
        onRemove={remove.mutate}
        removing={remove.isPending}
      />

      <ContractHistorySection
        runs={runs.data ?? []}
        datasetNames={datasetNames.data ?? {}}
        loading={runs.isLoading}
      />

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
