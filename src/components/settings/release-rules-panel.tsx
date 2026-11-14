import { useLeaveGuard } from '#/components/settings/use-leave-guard'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
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
import { Field, Input } from '#/components/ui/input'
import { Muted } from '#/components/ui/layout'
import { Select } from '#/components/ui/select'
import { toast } from '#/components/ui/sonner'
import { TableBox } from '#/components/ui/table'
import { SettingsBody } from '#/components/settings/settings-page'
import { createDataClient } from '#/lib/data-client'
import type { DataClient } from '#/lib/data-client'
import {
  ALL_TYPES,
  BUILT_IN_RULES,
  RULE_KINDS,
  describeRule,
  fetchReleaseRuleSets,
  fetchSampleTypes,
  releaseRuleKeys,
  resetReleaseRules,
  saveReleaseRules,
  validateRule,
} from '#/lib/release-rules'
import type { ReleaseRule, ReleaseRuleKind } from '#/lib/release-rules'
import { t } from '#/copy'

const defaultClient = createDataClient()

function errorMessage(error: Error): string {
  return error instanceof Error
    ? error.message
    : t('settings.storageLocationsPanel.databaseRefused')
}

function blankRule(kind: ReleaseRuleKind): ReleaseRule {
  switch (kind) {
    case 'no_result':
      return { kind, result: 'fail' }
    case 'min_measurements':
      return { kind, count: 1 }
    case 'measurement_required':
      return { kind, measurement: '' }
    case 'measurement_range':
      return { kind, measurement: '' }
  }
}

/**
 * Release checks, per sample type. The table lists every type that has its own
 * checks and the one that covers the rest; picking one opens its checks beside
 * it. A type with none of its own uses "Every sample type", and that falls back
 * to the built-in check when nothing is set.
 */
export function ReleaseRulesPanel({
  workspaceId,
  canManage,
  client = defaultClient,
}: {
  workspaceId: string
  /** Whether this person may change release checks (the release capability). */
  canManage: boolean
  client?: DataClient
}) {
  const queryClient = useQueryClient()

  const sets = useQuery({
    queryKey: releaseRuleKeys.all(workspaceId),
    queryFn: () => fetchReleaseRuleSets(client),
    enabled: Boolean(workspaceId),
  })

  const [selected, setSelected] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: releaseRuleKeys.all(workspaceId),
    })

  if (sets.isError) {
    return (
      <SettingsBody>
        <Notice tone="bad">
          {t('settings.releaseRules.loadError')}
          {errorMessage(sets.error)}
        </Notice>
      </SettingsBody>
    )
  }

  if (!sets.data) {
    return (
      <SettingsBody>
        <Muted>{t('settings.releaseRules.loading')}</Muted>
      </SettingsBody>
    )
  }

  const byType = new Map(sets.data.map((set) => [set.sampleType, set]))

  // The row for every type is always there, so the fallback is visible.
  const types = [
    ALL_TYPES,
    ...sets.data
      .map((set) => set.sampleType)
      .filter((type) => type !== ALL_TYPES),
  ]

  const active = selected && types.includes(selected) ? selected : null

  const lines = types.map((type) => {
    const set = byType.get(type)

    return {
      id: type,
      type,
      own: Boolean(set),
      rules: set?.rules ?? [...BUILT_IN_RULES],
    }
  })

  const columns: RegistryColumn<(typeof lines)[number]>[] = [
    {
      id: 'sampleType',
      header: t('settings.releaseRules.sampleType'),
      accessorFn: (line) =>
        line.type === ALL_TYPES
          ? t('settings.releaseRules.allTypes')
          : line.type,
      cell: ({ row }) => (
        <span className="font-medium text-fg">
          {row.original.type === ALL_TYPES
            ? t('settings.releaseRules.allTypes')
            : row.original.type}
        </span>
      ),
    },
    {
      id: 'checks',
      header: t('settings.releaseRules.checks'),
      accessorFn: (line) => line.rules.map(describeRule).join('; '),
      cell: ({ row }) => {
        const { rules } = row.original

        return (
          <span
            className="block max-w-[34rem] truncate"
            title={rules.map(describeRule).join('; ')}
          >
            {rules.length
              ? rules.map(describeRule).join('; ')
              : t('settings.releaseRules.noChecks')}
          </span>
        )
      },
    },
    {
      id: 'source',
      header: t('settings.releaseRules.source'),
      accessorFn: (line) =>
        line.own
          ? t('settings.releaseRules.ownChecks')
          : t('settings.releaseRules.builtIn'),
      cell: ({ row }) => (
        <span className="text-fg-muted">
          {row.original.own
            ? t('settings.releaseRules.ownChecks')
            : t('settings.releaseRules.builtIn')}
        </span>
      ),
    },
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <SettingsBody className="min-w-0 flex-1">
        <p className="m-0 max-w-prose text-body text-fg-muted">
          {t('settings.releaseRules.intro')}
        </p>
        {canManage ? (
          <div>
            <Button icon="plus" onClick={() => setAdding(true)}>
              {t('settings.releaseRules.addType')}
            </Button>
          </div>
        ) : (
          <Notice>{t('settings.releaseRules.viewOnly')}</Notice>
        )}
        <TableBox>
          <RegistryGrid
            label={t('settings.releaseRules.title')}
            rows={lines}
            columns={columns}
            getRowId={(line) => line.id}
            rowSelection={active ? { [active]: true } : {}}
            onRowClick={(line) => setSelected(line.id)}
          />
        </TableBox>
      </SettingsBody>
      <aside
        aria-label={t('settings.releaseRules.title')}
        className="shrink-0 border-t border-border bg-surface p-4 lg:w-[380px] lg:border-l lg:border-t-0"
      >
        {active ? (
          <RuleEditor
            key={`${active}:${byType.get(active)?.updatedAt ?? 'built-in'}`}
            sampleType={active}
            saved={byType.get(active)?.rules ?? null}
            workspaceId={workspaceId}
            canManage={canManage}
            client={client}
            onChanged={refresh}
          />
        ) : (
          <Muted>{t('settings.releaseRules.pickRow')}</Muted>
        )}
      </aside>
      {adding ? (
        <AddTypeDialog
          client={client}
          existing={types}
          onClose={() => setAdding(false)}
          onAdd={(type) => {
            setAdding(false)
            // A new type starts from the built-in check, saved so it appears.
            void saveReleaseRules(client, workspaceId, type, BUILT_IN_RULES)
              .then(() => refresh())
              .then(() => setSelected(type))
              .catch((error) => toast.error(errorMessage(error)))
          }}
        />
      ) : null}
    </div>
  )
}

function RuleEditor({
  sampleType,
  saved,
  workspaceId,
  canManage,
  client,
  onChanged,
}: {
  sampleType: string
  /** The checks stored for this type, or null when it uses the built-in one. */
  saved: ReleaseRule[] | null
  workspaceId: string
  canManage: boolean
  client: DataClient
  onChanged: () => void
}) {
  const [drafts, setDrafts] = useState(() =>
    (saved ?? BUILT_IN_RULES).map((rule) => ({
      id: crypto.randomUUID(),
      rule,
    })),
  )

  const rules = drafts.map((draft) => draft.rule)

  const problem = rules.map(validateRule).find(Boolean) ?? null

  const dirty =
    JSON.stringify(rules) !== JSON.stringify(saved ?? BUILT_IN_RULES)

  const save = useMutation({
    mutationFn: () => saveReleaseRules(client, workspaceId, sampleType, rules),
    onSuccess: () => {
      toast(t('settings.releaseRules.saved'))
      onChanged()
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const reset = useMutation({
    mutationFn: () => resetReleaseRules(client, sampleType),
    onSuccess: () => {
      toast(t('settings.releaseRules.reset'))
      onChanged()
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  useLeaveGuard({
    dirty: dirty && canManage,
    label: t('settings.releaseRules.editTitle', { type: sampleType }),
    canSave: problem === null,
    save: async () => {
      try {
        await save.mutateAsync()

        return true
      } catch {
        return false
      }
    },
    discard: () =>
      setDrafts(
        (saved ?? BUILT_IN_RULES).map((rule) => ({
          id: crypto.randomUUID(),
          rule,
        })),
      ),
  })

  const update = (index: number, replacement: ReleaseRule) =>
    setDrafts((current) =>
      current.map((draft, i) =>
        i === index ? { ...draft, rule: replacement } : draft,
      ),
    )

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="m-0 text-section">
          {sampleType === ALL_TYPES
            ? t('settings.releaseRules.allTypes')
            : t('settings.releaseRules.editTitle', { type: sampleType })}
        </h2>
        {sampleType === ALL_TYPES ? null : (
          <p className="m-0 mt-0.5 text-label text-fg-muted">
            {t('settings.releaseRules.typeHint')}
          </p>
        )}
      </div>
      <fieldset
        disabled={!canManage}
        className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0"
      >
        {rules.length === 0 ? (
          <Muted>{t('settings.releaseRules.noChecks')}</Muted>
        ) : null}
        {drafts.map(({ id, rule }, index) => (
          <div
            key={id}
            className="flex flex-col gap-2 rounded-md border border-border p-3"
          >
            <div className="flex items-end gap-2">
              <Field
                label={t('settings.releaseRules.check')}
                className="min-w-0 flex-1"
              >
                <Select
                  value={rule.kind}
                  onChange={(event) => {
                    const kind = RULE_KINDS.find(
                      (option) => option === event.target.value,
                    )

                    if (!kind) return
                    update(index, blankRule(kind))
                  }}
                >
                  {RULE_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {t(`settings.releaseRules.kinds.${kind}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button
                size="sm"
                variant="quiet"
                aria-label={t('settings.releaseRules.removeCheck')}
                onClick={() =>
                  setDrafts((current) => current.filter((_, i) => i !== index))
                }
              >
                {t('common.actions.remove')}
              </Button>
            </div>
            {rule.kind === 'no_result' ? (
              <Field label={t('settings.releaseRules.result')}>
                <Select
                  value={rule.result}
                  onChange={(event) =>
                    update(index, { ...rule, result: event.target.value })
                  }
                >
                  <option value="fail">fail</option>
                  <option value="warning">warning</option>
                </Select>
              </Field>
            ) : null}
            {rule.kind === 'min_measurements' ? (
              <Field label={t('settings.releaseRules.count')}>
                <Input
                  inputMode="numeric"
                  value={String(rule.count)}
                  onChange={(event) =>
                    update(index, {
                      ...rule,
                      count: Number(event.target.value),
                    })
                  }
                />
              </Field>
            ) : null}
            {rule.kind === 'measurement_required' ||
            rule.kind === 'measurement_range' ? (
              <Field label={t('settings.releaseRules.measurement')}>
                <Input
                  value={rule.measurement}
                  onChange={(event) =>
                    update(index, { ...rule, measurement: event.target.value })
                  }
                />
              </Field>
            ) : null}
            {rule.kind === 'measurement_range' ? (
              <div className="grid grid-cols-2 gap-2">
                <Field label={t('settings.releaseRules.lowest')}>
                  <Input
                    inputMode="decimal"
                    value={rule.min === undefined ? '' : String(rule.min)}
                    onChange={(event) =>
                      update(index, {
                        ...rule,
                        min:
                          event.target.value.trim() === ''
                            ? undefined
                            : Number(event.target.value),
                      })
                    }
                  />
                </Field>
                <Field label={t('settings.releaseRules.highest')}>
                  <Input
                    inputMode="decimal"
                    value={rule.max === undefined ? '' : String(rule.max)}
                    onChange={(event) =>
                      update(index, {
                        ...rule,
                        max:
                          event.target.value.trim() === ''
                            ? undefined
                            : Number(event.target.value),
                      })
                    }
                  />
                </Field>
              </div>
            ) : null}
            <Field label={t('settings.releaseRules.labelOptional')}>
              <Input
                value={rule.label ?? ''}
                onChange={(event) =>
                  update(index, { ...rule, label: event.target.value })
                }
              />
            </Field>
          </div>
        ))}
        <div>
          <Button
            icon="plus"
            onClick={() =>
              setDrafts([
                ...drafts,
                {
                  id: crypto.randomUUID(),
                  rule: blankRule('measurement_range'),
                },
              ])
            }
          >
            {t('settings.releaseRules.addCheck')}
          </Button>
        </div>
      </fieldset>
      {canManage ? (
        <div className="flex flex-col items-start gap-2">
          {dirty && problem ? (
            <span className="text-label text-danger-text">{problem}</span>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              disabled={!dirty || Boolean(problem) || save.isPending}
              onClick={() => save.mutate()}
            >
              {save.isPending
                ? t('common.states.saving')
                : t('settings.releaseRules.save')}
            </Button>
            {saved ? (
              <Button disabled={reset.isPending} onClick={() => reset.mutate()}>
                {t('settings.releaseRules.useBuiltIn')}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function AddTypeDialog({
  client,
  existing,
  onClose,
  onAdd,
}: {
  client: DataClient
  existing: readonly string[]
  onClose: () => void
  onAdd: (type: string) => void
}) {
  const [name, setName] = useState('')

  const types = useQuery({
    queryKey: ['release-rules', 'sample-types'],
    queryFn: () => fetchSampleTypes(client),
    retry: false,
  })

  const trimmed = name.trim()

  const taken = existing.some(
    (type) => type.toLowerCase() === trimmed.toLowerCase(),
  )

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(420px,calc(100vw-32px))]">
        <DialogHeader title={t('settings.releaseRules.addType')} />
        <DialogBody>
          <Field
            label={t('settings.releaseRules.newTypeName')}
            hint={t('settings.releaseRules.newTypeHint')}
            error={taken ? t('settings.releaseRules.typeExists') : undefined}
          >
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              list="release-rule-types"
              autoComplete="off"
              autoFocus
            />
          </Field>
          <datalist id="release-rule-types">
            {(types.data ?? []).map((type) => (
              <option key={type} value={type} />
            ))}
          </datalist>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={!trimmed || taken}
            onClick={() => onAdd(trimmed)}
          >
            {t('settings.releaseRules.add')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
