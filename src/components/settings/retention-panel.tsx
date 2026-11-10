/**
 * Settings > Retention and holds: how long records of each model are kept, the
 * records now due for archiving, and the legal holds that freeze records.
 * Everything here is a lab choice, switched on under General.
 */
import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

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
import { Status } from '#/components/ui/status'
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
import { SettingsBody } from '#/components/settings/settings-page'
import { t } from '#/copy'
import { formatDate } from '#/lib/format-date'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  applyRetention,
  createLegalHold,
  fetchDueRecords,
  fetchHoldCounts,
  fetchLegalHolds,
  fetchRetentionRules,
  keepTimeLabel,
  messageOf,
  qualityKeys,
  releaseLegalHold,
  saveRetentionRule,
  useQualityOptions,
} from '#/lib/result-quality'
import type { LegalHold, RetentionRule } from '#/lib/result-quality'

const client = notebookDataClient

interface ModelOption {
  key: string
  name: string
}

interface ProjectOption {
  id: string
  title: string
}

function useRetentionOverview(on: boolean) {
  const models = useQuery({
    queryKey: ['quality', 'models'],
    queryFn: () =>
      client.list<ModelOption>(
        'record_models',
        '?select=key,name&order=name.asc',
      ),
    enabled: on,
  })

  const projects = useQuery({
    queryKey: ['quality', 'projects'],
    queryFn: () =>
      client.list<ProjectOption>(
        'projects',
        '?select=id,title&order=title.asc',
      ),
    enabled: on,
  })

  const rules = useQuery({
    queryKey: qualityKeys.rules,
    queryFn: () => fetchRetentionRules(client),
    enabled: on,
  })

  const due = useQuery({
    queryKey: qualityKeys.due,
    queryFn: () => fetchDueRecords(client),
    enabled: on,
  })

  const holds = useQuery({
    queryKey: qualityKeys.holds,
    queryFn: () => fetchLegalHolds(client),
    enabled: on,
  })

  const counts = useQuery({
    queryKey: qualityKeys.holdCounts,
    queryFn: () => fetchHoldCounts(client),
    enabled: on,
  })

  const ruleOf = new Map(
    (rules.data ?? []).map((rule) => [rule.kind, rule] as const),
  )

  const dueRows = due.data ?? []
  const dueByKind = new Map<string, number>()

  for (const row of dueRows)
    dueByKind.set(row.kind, (dueByKind.get(row.kind) ?? 0) + 1)

  return {
    models: models.data ?? [],
    projects: projects.data ?? [],
    holds: holds.data ?? [],
    counts: counts.data,
    failed: rules.error ?? due.error ?? holds.error,
    ruleOf,
    dueRows,
    dueByKind,
  }
}

export function RetentionPanel({
  workspaceId,
  canManage,
}: {
  workspaceId: string
  canManage: boolean
}) {
  const options = useQualityOptions(workspaceId)
  const queryClient = useQueryClient()
  const on = options.retention

  const {
    models,
    projects,
    holds,
    counts,
    failed,
    ruleOf,
    dueRows,
    dueByKind,
  } = useRetentionOverview(on)

  const [editing, setEditing] = useState<string | null>(null)
  const [placing, setPlacing] = useState(false)
  const [releasing, setReleasing] = useState<LegalHold | null>(null)

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: qualityKeys.all })

  const archive = useMutation({
    mutationFn: () => applyRetention(client),
    onSuccess: (count) => {
      void refresh()
      toast.success(t('quality.retention.due.archived', { count }))
    },
    onError: (e) =>
      toast.error(messageOf(e, t('quality.retention.due.couldNotArchive'))),
  })

  if (!on) {
    return (
      <SettingsBody>
        <Notice>{t('quality.retention.off')}</Notice>
      </SettingsBody>
    )
  }

  if (failed) {
    return (
      <SettingsBody>
        <Notice tone="bad" title={t('quality.retention.loadError')}>
          {messageOf(failed, '')}
        </Notice>
      </SettingsBody>
    )
  }

  const modelName = (key: string) =>
    models.find((m) => m.key === key)?.name ?? key

  const projectName = (id: string | null) =>
    projects.find((p) => p.id === id)?.title ?? ''

  return (
    <SettingsBody>
      {!canManage ? <Notice>{t('quality.retention.viewOnly')}</Notice> : null}

      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="m-0 text-body font-semibold">
            {t('quality.retention.rules.title')}
          </h2>
          <p className="m-0 max-w-prose text-label text-fg-muted">
            {t('quality.retention.rules.intro')}
          </p>
        </div>
        <RetentionRulesTable
          models={models}
          rules={ruleOf}
          dueByKind={dueByKind}
          canManage={canManage}
          onEdit={setEditing}
        />
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="m-0 text-body font-semibold">
            {t('quality.retention.due.title')}
          </h2>
          {canManage && dueRows.length > 0 ? (
            <Button
              disabled={archive.isPending}
              onClick={() => {
                if (window.confirm(t('quality.retention.due.confirm'))) {
                  archive.mutate()
                }
              }}
            >
              {archive.isPending
                ? t('quality.retention.due.archiving')
                : t('quality.retention.due.archive', { count: dueRows.length })}
            </Button>
          ) : null}
        </div>
        {dueRows.length === 0 ? (
          <Muted>{t('quality.retention.due.empty')}</Muted>
        ) : (
          <TableBox>
            <Table caption={t('quality.retention.due.tableLabel')}>
              <TableHeader>
                <tr>
                  <TableHead>{t('quality.retention.due.number')}</TableHead>
                  <TableHead>{t('quality.retention.due.name')}</TableHead>
                  <TableHead>{t('quality.retention.due.kind')}</TableHead>
                  <TableHead>
                    {t('quality.retention.due.lastChanged')}
                  </TableHead>
                </tr>
              </TableHeader>
              <TableBody>
                {dueRows.slice(0, 200).map((row) => (
                  <TableRow key={row.record_id}>
                    <TableCell className="mono text-fg-muted">
                      {row.identifier}
                    </TableCell>
                    <TableCell>
                      <Link
                        to="/models/$modelId/records/$recordId"
                        params={{ modelId: row.kind, recordId: row.record_id }}
                        className="text-link"
                      >
                        {row.title}
                      </Link>
                    </TableCell>
                    <TableCell>{modelName(row.kind)}</TableCell>
                    <TableCell className="text-fg-muted">
                      {formatDate(row.last_changed)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableBox>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div className="flex flex-col gap-1">
            <h2 className="m-0 text-body font-semibold">
              {t('quality.retention.holds.title')}
            </h2>
            <p className="m-0 max-w-prose text-label text-fg-muted">
              {t('quality.retention.holds.intro')}
            </p>
          </div>
          {canManage ? (
            <Button icon="plus" onClick={() => setPlacing(true)}>
              {t('quality.retention.holds.add')}
            </Button>
          ) : null}
        </div>
        <LegalHoldsTable
          holds={holds}
          counts={counts}
          canManage={canManage}
          onRelease={setReleasing}
          modelName={modelName}
          projectName={projectName}
        />
      </section>

      {editing ? (
        <RuleDialog
          modelKey={editing}
          modelName={modelName(editing)}
          rule={ruleOf.get(editing) ?? null}
          onClose={() => setEditing(null)}
          onSaved={() => void refresh()}
        />
      ) : null}
      {placing ? (
        <PlaceHoldDialog
          models={models}
          projects={projects}
          onClose={() => setPlacing(false)}
          onSaved={() => void refresh()}
        />
      ) : null}
      {releasing ? (
        <ReleaseHoldDialog
          hold={releasing}
          onClose={() => setReleasing(null)}
          onSaved={() => void refresh()}
        />
      ) : null}
    </SettingsBody>
  )
}

function RetentionRulesTable({
  models,
  rules,
  dueByKind,
  canManage,
  onEdit,
}: {
  models: ModelOption[]
  rules: ReadonlyMap<string, RetentionRule>
  dueByKind: ReadonlyMap<string, number>
  canManage: boolean
  onEdit: (key: string) => void
}) {
  return (
    <TableBox>
      <Table caption={t('quality.retention.rules.tableLabel')}>
        <TableHeader>
          <tr>
            {[
              t('quality.retention.rules.model'),
              t('quality.retention.rules.keep'),
              t('quality.retention.rules.due'),
              t('quality.retention.rules.note'),
            ].map((label) => (
              <TableHead key={label}>{label}</TableHead>
            ))}
            <TableHead>
              <span className="sr-only">
                {t('quality.retention.rules.change')}
              </span>
            </TableHead>
          </tr>
        </TableHeader>
        <TableBody>
          {models.map((model) => {
            const rule = rules.get(model.key)

            return (
              <TableRow key={model.key}>
                <TableCell>
                  <span className="font-medium text-fg">{model.name}</span>
                </TableCell>
                <TableCell>
                  {rule ? (
                    keepTimeLabel(rule.keep_months)
                  ) : (
                    <span className="text-fg-muted">
                      {t('quality.retention.rules.noRule')}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  {rule ? (dueByKind.get(model.key) ?? 0) : ''}
                </TableCell>
                <TableCell className="text-fg-muted">
                  <span className="block max-w-[28rem] truncate">
                    {rule?.note ?? ''}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  {canManage ? (
                    <Button size="sm" onClick={() => onEdit(model.key)}>
                      {rule
                        ? t('quality.retention.rules.change')
                        : t('quality.retention.rules.set')}
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </TableBox>
  )
}

function holdCoverage(
  hold: LegalHold,
  modelName: (key: string) => string,
  projectName: (id: string | null) => string,
) {
  if (hold.project_id && hold.kind)
    return t('quality.retention.holds.coversModelInProject', {
      model: modelName(hold.kind),
      project: projectName(hold.project_id),
    })

  if (hold.project_id)
    return t('quality.retention.holds.coversProject', {
      project: projectName(hold.project_id),
    })

  if (hold.kind)
    return t('quality.retention.holds.coversModel', {
      model: modelName(hold.kind),
    })

  return t('quality.retention.holds.coversPicked')
}

function LegalHoldsTable({
  holds,
  counts,
  canManage,
  onRelease,
  modelName,
  projectName,
}: {
  holds: LegalHold[]
  counts: Awaited<ReturnType<typeof fetchHoldCounts>> | undefined
  canManage: boolean
  onRelease: (hold: LegalHold) => void
  modelName: (key: string) => string
  projectName: (id: string | null) => string
}) {
  if (holds.length === 0)
    return <Muted>{t('quality.retention.holds.none')}</Muted>

  return (
    <TableBox>
      <Table caption={t('quality.retention.holds.tableLabel')}>
        <TableHeader>
          <tr>
            {[
              t('quality.retention.holds.name'),
              t('quality.retention.holds.covers'),
              t('quality.retention.holds.records'),
              t('quality.retention.holds.placed'),
              t('quality.retention.holds.status'),
            ].map((label) => (
              <TableHead key={label}>{label}</TableHead>
            ))}
            <TableHead>
              <span className="sr-only">
                {t('quality.retention.holds.release')}
              </span>
            </TableHead>
          </tr>
        </TableHeader>
        <TableBody>
          {holds.map((hold) => (
            <TableRow key={hold.id}>
              <TableCell>
                <span className="block max-w-[16rem] truncate font-medium text-fg">
                  {hold.name}
                </span>
                {hold.reason ? (
                  <span
                    className="block max-w-[16rem] truncate text-label text-fg-muted"
                    title={hold.reason}
                  >
                    {hold.reason}
                  </span>
                ) : null}
              </TableCell>
              <TableCell>
                <span className="block max-w-[14rem] whitespace-normal">
                  {holdCoverage(hold, modelName, projectName)}
                </span>
              </TableCell>
              <TableCell>{counts?.get(hold.id) ?? ''}</TableCell>
              <TableCell className="text-fg-muted">
                {formatDate(hold.created_at)}
              </TableCell>
              <TableCell>
                <Status tone={hold.released_at ? 'none' : 'warn'}>
                  {hold.released_at
                    ? t('quality.retention.holds.released')
                    : t('quality.retention.holds.active')}
                </Status>
              </TableCell>
              <TableCell className="text-right">
                {canManage && !hold.released_at ? (
                  <Button size="sm" onClick={() => onRelease(hold)}>
                    {t('quality.retention.holds.release')}
                  </Button>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableBox>
  )
}

function RuleDialog({
  modelKey,
  modelName,
  rule,
  onClose,
  onSaved,
}: {
  modelKey: string
  modelName: string
  rule: RetentionRule | null
  onClose: () => void
  onSaved: () => void
}) {
  const [months, setMonths] = useState(rule ? String(rule.keep_months) : '')
  const [note, setNote] = useState(rule?.note ?? '')
  const parsed = Number(months)
  const valid = Number.isInteger(parsed) && parsed >= 1 && parsed <= 1200

  const save = useMutation({
    mutationFn: (keep: number | null) =>
      saveRetentionRule(client, modelKey, keep, note),
    onSuccess: (_data, keep) => {
      toast.success(
        keep === null
          ? t('quality.retention.rules.removed')
          : t('quality.retention.rules.saved'),
      )
      onSaved()
      onClose()
    },
    onError: (e) =>
      toast.error(messageOf(e, t('quality.retention.rules.couldNotSave'))),
  })

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="w-[min(440px,calc(100vw-32px))]">
        <DialogHeader
          title={t('quality.retention.rules.dialogTitle', { name: modelName })}
        />
        <DialogBody>
          <div className="flex flex-col gap-4">
            <Field
              label={t('quality.retention.rules.months')}
              hint={t('quality.retention.rules.monthsHint')}
              error={
                months !== '' && !valid
                  ? t('quality.retention.rules.monthsRequired')
                  : undefined
              }
            >
              <Input
                inputMode="numeric"
                value={months}
                onChange={(e) => setMonths(e.target.value)}
                className="w-32"
              />
            </Field>
            <Field
              label={t('quality.retention.rules.noteLabel')}
              hint={t('quality.retention.rules.noteHint')}
            >
              <Input value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </div>
        </DialogBody>
        <DialogFooter>
          {rule ? (
            <Button
              variant="quiet"
              disabled={save.isPending}
              onClick={() => save.mutate(null)}
            >
              {t('quality.retention.rules.remove')}
            </Button>
          ) : null}
          <DialogClose render={<Button variant="quiet" />}>
            {t('quality.retention.rules.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={!valid || save.isPending}
            onClick={() => save.mutate(parsed)}
          >
            {save.isPending
              ? t('quality.retention.rules.saving')
              : t('quality.retention.rules.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PlaceHoldDialog({
  models,
  projects,
  onClose,
  onSaved,
}: {
  models: ModelOption[]
  projects: ProjectOption[]
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState('')
  const [reason, setReason] = useState('')
  const [projectId, setProjectId] = useState('')
  const [kind, setKind] = useState('')
  const covered = projectId !== '' || kind !== ''

  const create = useMutation({
    mutationFn: () =>
      createLegalHold(client, {
        name: name.trim(),
        reason: reason.trim(),
        projectId: projectId || null,
        kind: kind || null,
      }),
    onSuccess: () => {
      toast.success(t('quality.retention.holds.created'))
      onSaved()
      onClose()
    },
    onError: (e) =>
      toast.error(messageOf(e, t('quality.retention.holds.couldNotCreate'))),
  })

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="w-[min(480px,calc(100vw-32px))]">
        <DialogHeader title={t('quality.retention.holds.dialogTitle')} />
        <DialogBody>
          <div className="flex flex-col gap-4">
            <Field
              label={t('quality.retention.holds.nameLabel')}
              hint={t('quality.retention.holds.nameHint')}
              required
            >
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label={t('quality.retention.holds.reasonLabel')}>
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
            <Field
              label={t('quality.retention.holds.projectLabel')}
              hint={t('quality.retention.holds.coverageHint')}
            >
              <Select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
              >
                <option value="">
                  {t('quality.retention.holds.anyProject')}
                </option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label={t('quality.retention.holds.modelLabel')}
              error={
                !covered
                  ? t('quality.retention.holds.coverageRequired')
                  : undefined
              }
            >
              <Select value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="">
                  {t('quality.retention.holds.anyModel')}
                </option>
                {models.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button variant="quiet" />}>
            {t('quality.retention.holds.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={!name.trim() || !covered || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending
              ? t('quality.retention.holds.creating')
              : t('quality.retention.holds.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ReleaseHoldDialog({
  hold,
  onClose,
  onSaved,
}: {
  hold: LegalHold
  onClose: () => void
  onSaved: () => void
}) {
  const [note, setNote] = useState('')

  const release = useMutation({
    mutationFn: () => releaseLegalHold(client, hold.id, note.trim()),
    onSuccess: () => {
      toast.success(t('quality.retention.holds.releasedToast'))
      onSaved()
      onClose()
    },
    onError: (e) =>
      toast.error(messageOf(e, t('quality.retention.holds.couldNotRelease'))),
  })

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="w-[min(440px,calc(100vw-32px))]">
        <DialogHeader
          title={t('quality.retention.holds.releaseTitle', { name: hold.name })}
        />
        <DialogBody>
          <div className="flex flex-col gap-4">
            <p className="m-0 text-body text-fg-muted">
              {t('quality.retention.holds.releaseBody')}
            </p>
            <Field label={t('quality.retention.holds.releaseNote')}>
              <Input value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button variant="quiet" />}>
            {t('quality.retention.holds.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={release.isPending}
            onClick={() => release.mutate()}
          >
            {release.isPending
              ? t('quality.retention.holds.releasing')
              : t('quality.retention.holds.releaseConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
