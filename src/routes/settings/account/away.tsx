import { SearchableSelect } from '#/components/record-picker/searchable-select'
import { useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/ui/button'
import { Notice } from '#/components/ui/alert'
import { Field, Input } from '#/components/ui/input'
import { Muted, Section } from '#/components/ui/layout'
import { Status } from '#/components/ui/status'
import { toast } from '#/components/ui/sonner'
import { TableBox } from '#/components/ui/table'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { HandoverDialog } from '#/components/settings/handover-dialog'
import {
  SettingsBody,
  SettingsHeader,
} from '#/components/settings/settings-page'
import {
  absenceKeys,
  absenceState,
  cancelAbsence,
  fetchAbsences,
  setAbsence,
  today,
} from '#/lib/absences'
import type { Absence } from '#/lib/absences'
import { createDataClient } from '#/lib/data-client'
import { formatDate } from '#/lib/format-date'
import { useUserNames } from '#/lib/user-names'
import {
  adminQueryKeys,
  describeAdminError,
  fetchWorkspaceMembers,
} from '#/lib/workspace-admin'
import { t } from '#/copy'

/** Out of office: the dates you're away and the colleague who covers the
 * reviews waiting on you, and where to hand your work over for good. */
export const Route = createFileRoute('/settings/account/away')({
  component: Away,
})

const dataClient = createDataClient()

function range(absence: Absence): string {
  return t('people.away.range', {
    from: formatDate(absence.startsOn),
    to: formatDate(absence.endsOn),
  })
}

function Away() {
  const { context } = Route.useRouteContext()
  const workspaceId = context.workspace?.id ?? ''
  const me = context.user.id
  const queryClient = useQueryClient()
  const [startsOn, setStartsOn] = useState(today)
  const [endsOn, setEndsOn] = useState('')
  const [delegate, setDelegate] = useState('')
  const [note, setNote] = useState('')
  const [handingOver, setHandingOver] = useState(false)

  const members = useQuery({
    queryKey: adminQueryKeys.members(workspaceId),
    queryFn: () => fetchWorkspaceMembers(dataClient, workspaceId),
    enabled: Boolean(workspaceId),
  })

  const absences = useQuery({
    queryKey: absenceKeys.all(workspaceId),
    queryFn: () => fetchAbsences(dataClient, workspaceId),
    enabled: Boolean(workspaceId),
  })

  const names = useUserNames(
    [
      ...(members.data ?? []).map((m) => m.userId),
      ...(absences.data ?? []).flatMap((a) =>
        a.delegateUserId ? [a.userId, a.delegateUserId] : [a.userId],
      ),
    ],
    context.user,
  )

  const candidates = useMemo(
    () =>
      (members.data ?? [])
        .filter(
          (m) =>
            m.userId !== me &&
            !m.suspendedAt &&
            m.role !== 'viewer' &&
            m.role !== 'client_viewer',
        )
        .map((m) => ({ id: m.userId, label: names.userLabel(m.userId) })),
    [members.data, me, names],
  )

  const mine = (absences.data ?? []).filter((a) => a.userId === me)
  const others = (absences.data ?? []).filter((a) => a.userId !== me)

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: absenceKeys.all(workspaceId) })

  const save = useMutation({
    mutationFn: () =>
      setAbsence(dataClient, {
        workspaceId,
        startsOn,
        endsOn,
        delegateUserId: delegate || null,
        note,
      }),
    onSuccess: async () => {
      toast(t('people.away.savedToast'))
      setEndsOn('')
      setNote('')
      await refresh()
    },
  })

  const cancel = useMutation({
    mutationFn: (id: string) => cancelAbsence(dataClient, id),
    onSuccess: async () => {
      toast(t('people.away.cancelledToast'))
      await refresh()
    },
    onError: (error) =>
      toast.error(t('people.away.couldNotSave'), {
        description: describeAdminError(error),
      }),
  })

  const stateCell = (absence: Absence) => (
    <Status tone={absenceState(absence) === 'away' ? 'warn' : 'none'}>
      {absenceState(absence) === 'away'
        ? t('people.away.stateAway')
        : t('people.away.stateComing')}
    </Status>
  )

  const mineColumns: RegistryColumn<Absence>[] = [
    {
      id: 'when',
      header: t('people.away.whenColumn'),
      cell: ({ row }) => (
        <span className="flex items-center gap-2">
          {range(row.original)}
          {stateCell(row.original)}
        </span>
      ),
    },
    {
      id: 'cover',
      header: t('people.away.coveredByColumn'),
      cell: ({ row }) =>
        row.original.delegateUserId
          ? names.userLabel(row.original.delegateUserId)
          : '—',
    },
    {
      id: 'note',
      header: t('people.away.noteColumn'),
      meta: { cellClassName: 'text-fg-muted' },
      cell: ({ row }) => row.original.note ?? '—',
    },
    {
      id: 'actions',
      header: '',
      enableHiding: false,
      meta: { headerClassName: 'text-right', cellClassName: 'text-right' },
      cell: ({ row }) => (
        <Button
          size="sm"
          variant="quiet"
          disabled={cancel.isPending}
          onClick={() => cancel.mutate(row.original.id)}
        >
          {t('people.away.cancel')}
        </Button>
      ),
    },
  ]

  const othersColumns: RegistryColumn<Absence>[] = [
    {
      id: 'person',
      header: t('people.away.otherPerson'),
      cell: ({ row }) => names.userLabel(row.original.userId),
    },
    ...mineColumns.slice(0, 2),
  ]

  const ready = Boolean(startsOn && endsOn && endsOn >= startsOn)

  return (
    <>
      <SettingsHeader title={t('people.away.title')}>
        {t('people.away.intro')}
      </SettingsHeader>
      <SettingsBody>
        <Section title={t('people.away.save')}>
          <div className="flex flex-wrap items-end gap-3">
            <Field label={t('people.away.from')}>
              <Input
                type="date"
                value={startsOn}
                min={today()}
                onChange={(e) => setStartsOn(e.target.value)}
              />
            </Field>
            <Field label={t('people.away.to')}>
              <Input
                type="date"
                value={endsOn}
                min={startsOn || today()}
                onChange={(e) => setEndsOn(e.target.value)}
              />
            </Field>
            <Field label={t('people.away.covering')}>
              <SearchableSelect
                noun="member"
                value={delegate}
                onValueChange={(value) => setDelegate(value)}
              >
                <option value="">{t('people.away.noOne')}</option>
                {candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </SearchableSelect>
            </Field>
            <Field
              label={t('people.away.note')}
              className="min-w-[240px] flex-1"
            >
              <Input
                value={note}
                maxLength={500}
                placeholder={t('people.away.notePlaceholder')}
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
            <Button
              variant="primary"
              disabled={!ready || save.isPending}
              onClick={() => save.mutate()}
            >
              {save.isPending ? t('people.away.saving') : t('people.away.save')}
            </Button>
          </div>
          {save.isError ? (
            <Notice tone="bad">{describeAdminError(save.error)}</Notice>
          ) : (
            <Muted>{t('people.away.datesHint')}</Muted>
          )}
        </Section>

        <Section title={t('people.away.tableLabel')}>
          {mine.length === 0 ? (
            <Muted>{t('people.away.none')}</Muted>
          ) : (
            <TableBox>
              <RegistryGrid
                label={t('people.away.tableLabel')}
                rows={mine}
                columns={mineColumns}
                getRowId={(a) => a.id}
                selectable={false}
                sortable={false}
              />
            </TableBox>
          )}
        </Section>

        <Section title={t('people.away.otherTitle')}>
          {others.length === 0 ? (
            <Muted>{t('people.away.otherNone')}</Muted>
          ) : (
            <TableBox>
              <RegistryGrid
                label={t('people.away.otherTitle')}
                rows={others}
                columns={othersColumns}
                getRowId={(a) => a.id}
                selectable={false}
                sortable={false}
              />
            </TableBox>
          )}
        </Section>

        <Section
          title={t('people.away.handOverTitle')}
          action={
            <Button onClick={() => setHandingOver(true)}>
              {t('people.away.handOverAction')}
            </Button>
          }
        >
          <Muted>{t('people.away.handOverBody')}</Muted>
        </Section>
      </SettingsBody>
      {handingOver ? (
        <HandoverDialog
          workspaceId={workspaceId}
          userId={me}
          name={context.user.name}
          self
          candidates={candidates}
          onClose={() => setHandingOver(false)}
        />
      ) : null}
    </>
  )
}
