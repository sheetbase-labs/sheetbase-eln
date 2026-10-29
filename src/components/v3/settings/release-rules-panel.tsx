import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Notice } from '#/components/v3/ui/alert'
import { Button } from '#/components/v3/ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { Field, Input } from '#/components/v3/ui/input'
import { Muted } from '#/components/v3/ui/layout'
import { Select } from '#/components/v3/ui/select'
import { toast } from '#/components/v3/ui/sonner'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import { SettingsBody } from '#/components/v3/settings/settings-page'
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

function errorMessage(error: unknown): string {
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
          <Table caption={t('settings.releaseRules.title')}>
            <TableHeader>
              <tr>
                <TableHead>{t('settings.releaseRules.sampleType')}</TableHead>
                <TableHead>{t('settings.releaseRules.checks')}</TableHead>
                <TableHead>{t('settings.releaseRules.source')}</TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {types.map((type) => {
                const set = byType.get(type)
                const rules = set?.rules ?? [...BUILT_IN_RULES]
                return (
                  <TableRow
                    key={type}
                    selected={type === active}
                    className="cursor-pointer"
                    tabIndex={0}
                    onClick={() => setSelected(type)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        setSelected(type)
                      }
                    }}
                  >
                    <TableCell>
                      <span className="font-medium text-fg">
                        {type === ALL_TYPES
                          ? t('settings.releaseRules.allTypes')
                          : type}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span
                        className="block max-w-[34rem] truncate"
                        title={rules.map(describeRule).join('; ')}
                      >
                        {rules.length
                          ? rules.map(describeRule).join('; ')
                          : t('settings.releaseRules.noChecks')}
                      </span>
                    </TableCell>
                    <TableCell className="text-fg-muted">
                      {set
                        ? t('settings.releaseRules.ownChecks')
                        : t('settings.releaseRules.builtIn')}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
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
  const [rules, setRules] = useState<ReleaseRule[]>(
    () => saved ?? [...BUILT_IN_RULES],
  )
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
  const update = (index: number, patch: Partial<ReleaseRule>) =>
    setRules(
      rules.map((rule, i) =>
        i === index ? ({ ...rule, ...patch } as ReleaseRule) : rule,
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
        {rules.map((rule, index) => (
          <div
            key={index}
            className="flex flex-col gap-2 rounded-md border border-border p-3"
          >
            <div className="flex items-end gap-2">
              <Field
                label={t('settings.releaseRules.check')}
                className="min-w-0 flex-1"
              >
                <Select
                  value={rule.kind}
                  onChange={(event) =>
                    setRules(
                      rules.map((r, i) =>
                        i === index
                          ? blankRule(event.target.value as ReleaseRuleKind)
                          : r,
                      ),
                    )
                  }
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
                onClick={() => setRules(rules.filter((_, i) => i !== index))}
              >
                {t('common.actions.remove')}
              </Button>
            </div>
            {rule.kind === 'no_result' ? (
              <Field label={t('settings.releaseRules.result')}>
                <Select
                  value={rule.result}
                  onChange={(event) =>
                    update(index, { result: event.target.value })
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
                    update(index, { count: Number(event.target.value) })
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
                    update(index, { measurement: event.target.value })
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
                  update(index, { label: event.target.value })
                }
              />
            </Field>
          </div>
        ))}
        <div>
          <Button
            icon="plus"
            onClick={() => setRules([...rules, blankRule('measurement_range')])}
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
