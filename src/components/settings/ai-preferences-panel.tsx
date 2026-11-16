/**
 * AI preferences: what the assistant remembers about how a person and their
 * lab like things done. A person's own list is theirs to edit; the lab's list
 * is for everyone and only someone who manages the AI settings changes it.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { Textarea } from '#/components/inventory/list'
import { SettingsBody } from '#/components/settings/settings-page'
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
import { EmptyState } from '#/components/ui/empty-state'
import { Field, Input } from '#/components/ui/input'
import { Muted, Section } from '#/components/ui/layout'
import { Skeleton } from '#/components/ui/skeleton'
import { toast } from '#/components/ui/sonner'
import { TableBox } from '#/components/ui/table'
import { t } from '#/copy'
import { formatDate } from '#/lib/format-date'
import { notebookDataClient } from '#/lib/notebook-data'

const client = notebookDataClient
const KEY = ['ai-preferences'] as const
const MAX = 300

interface PreferenceRow {
  id: string
  scope: 'workspace' | 'user'
  topic: string | null
  body: string
  updated_at: string
}

const fetchPreferences = () =>
  client.list<PreferenceRow>(
    'ai_preferences',
    '?select=id,scope,topic,body,updated_at&order=created_at.asc',
  )

function messageOf(error: Error, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

type Editing = { scope: 'workspace' | 'user'; row: PreferenceRow | null } | null

export function AiPreferencesPanel({
  workspaceId,
  canManageLab,
}: {
  workspaceId: string
  canManageLab: boolean
}) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<Editing>(null)

  const preferences = useQuery({
    queryKey: KEY,
    queryFn: fetchPreferences,
    enabled: Boolean(workspaceId),
  })

  const remove = useMutation({
    mutationFn: (row: PreferenceRow) =>
      client.rpc('delete_ai_preference', { p_preference_id: row.id }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: KEY })
      toast(t('features.aiPreferences.page.removed'))
    },
    onError: (error) =>
      toast.error(
        messageOf(error, t('features.aiPreferences.page.couldNotRemove')),
      ),
  })

  const rows = preferences.data ?? []
  const mine = rows.filter((row) => row.scope === 'user')
  const lab = rows.filter((row) => row.scope === 'workspace')

  return (
    <SettingsBody>
      {preferences.error ? (
        <Notice tone="bad">{t('features.aiPreferences.page.loadError')}</Notice>
      ) : null}

      <PreferenceSection
        title={t('features.aiPreferences.page.yours')}
        hint={t('features.aiPreferences.page.yoursHint')}
        label={t('features.aiPreferences.page.tableYours')}
        empty={t('features.aiPreferences.page.emptyYours')}
        rows={mine}
        loading={preferences.isLoading}
        canChange
        removing={remove.isPending}
        onAdd={() => setEditing({ scope: 'user', row: null })}
        onEdit={(row) => setEditing({ scope: 'user', row })}
        onRemove={(row) => remove.mutate(row)}
      />

      <PreferenceSection
        title={t('features.aiPreferences.page.lab')}
        hint={
          canManageLab
            ? t('features.aiPreferences.page.labHint')
            : t('features.aiPreferences.page.labViewOnly')
        }
        label={t('features.aiPreferences.page.tableLab')}
        empty={
          canManageLab
            ? t('features.aiPreferences.page.emptyLab')
            : t('features.aiPreferences.page.empty')
        }
        rows={lab}
        loading={preferences.isLoading}
        canChange={canManageLab}
        removing={remove.isPending}
        onAdd={() => setEditing({ scope: 'workspace', row: null })}
        onEdit={(row) => setEditing({ scope: 'workspace', row })}
        onRemove={(row) => remove.mutate(row)}
      />

      {editing ? (
        <PreferenceDialog
          key={editing.row?.id ?? editing.scope}
          editing={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            void queryClient.invalidateQueries({ queryKey: KEY })
            toast(t('features.aiPreferences.page.saved'))
          }}
        />
      ) : null}
    </SettingsBody>
  )
}

function PreferenceSection({
  title,
  hint,
  label,
  empty,
  rows,
  loading,
  canChange,
  removing,
  onAdd,
  onEdit,
  onRemove,
}: {
  title: string
  hint: string
  label: string
  empty: string
  rows: PreferenceRow[]
  loading: boolean
  canChange: boolean
  removing: boolean
  onAdd: () => void
  onEdit: (row: PreferenceRow) => void
  onRemove: (row: PreferenceRow) => void
}) {
  const columns: RegistryColumn<PreferenceRow>[] = [
    {
      id: 'topic',
      header: t('features.aiPreferences.page.topic'),
      size: 180,
      accessorFn: (row) => row.topic ?? '',
      cell: ({ row }) => (
        <span className="font-medium text-fg">{row.original.topic ?? ''}</span>
      ),
    },
    {
      id: 'body',
      size: 640,
      header: t('features.aiPreferences.page.preference'),
      accessorFn: (row) => row.body,
      cell: ({ row }) => (
        <span className="whitespace-normal text-fg">{row.original.body}</span>
      ),
    },
    {
      id: 'updated',
      header: t('features.aiPreferences.page.updated'),
      size: 140,
      accessorFn: (row) => row.updated_at,
      cell: ({ row }) => (
        <span className="text-fg-muted">
          {formatDate(row.original.updated_at)}
        </span>
      ),
    },
    {
      id: 'actions',
      header: '',
      size: 150,
      enableHiding: false,
      meta: { headerClassName: 'text-right', cellClassName: 'text-right' },
      cell: ({ row }) =>
        canChange ? (
          <span className="inline-flex gap-1.5">
            <Button size="sm" onClick={() => onEdit(row.original)}>
              {t('features.aiPreferences.page.edit')}
            </Button>
            <Button
              size="sm"
              disabled={removing}
              onClick={() => onRemove(row.original)}
            >
              {t('features.aiPreferences.page.remove')}
            </Button>
          </span>
        ) : null,
    },
  ]

  return (
    <Section
      title={title}
      count={rows.length > 0 ? rows.length : undefined}
      action={
        canChange ? (
          <Button size="sm" onClick={onAdd}>
            {t('features.aiPreferences.page.add')}
          </Button>
        ) : null
      }
    >
      <Muted>{hint}</Muted>
      {loading ? (
        <Skeleton className="h-24 w-full" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon="spark"
          title={title}
          description={empty}
          action={
            canChange ? (
              <Button size="sm" onClick={onAdd}>
                {t('features.aiPreferences.page.add')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <TableBox>
          <RegistryGrid
            label={label}
            rows={rows}
            columns={columns}
            getRowId={(row) => row.id}
            selectable={false}
          />
        </TableBox>
      )}
    </Section>
  )
}

function PreferenceDialog({
  editing,
  onClose,
  onSaved,
}: {
  editing: NonNullable<Editing>
  onClose: () => void
  onSaved: () => void
}) {
  const [topic, setTopic] = useState(editing.row?.topic ?? '')
  const [body, setBody] = useState(editing.row?.body ?? '')

  const save = useMutation({
    mutationFn: () =>
      editing.row
        ? client.rpc('update_ai_preference', {
            p_preference_id: editing.row.id,
            p_body: body.trim(),
            p_topic: topic.trim() || null,
          })
        : client.rpc('save_ai_preference', {
            p_body: body.trim(),
            p_scope: editing.scope,
            p_topic: topic.trim() || null,
          }),
    onSuccess: onSaved,
    onError: (error) =>
      toast.error(
        messageOf(error, t('features.aiPreferences.page.couldNotSave')),
      ),
  })

  const ready = body.trim().length > 0 && body.trim().length <= MAX

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="w-[min(520px,calc(100vw-32px))]">
        <DialogHeader
          title={
            editing.row
              ? t('features.aiPreferences.page.dialogEdit')
              : t('features.aiPreferences.page.dialogAdd')
          }
          description={t('features.aiPreferences.page.dialogDescription')}
        />
        <DialogBody>
          <Field
            label={t('features.aiPreferences.page.topic')}
            hint={t('features.aiPreferences.page.topicHint')}
          >
            <Input
              value={topic}
              maxLength={60}
              placeholder={t('features.aiPreferences.page.topicPlaceholder')}
              onChange={(event) => setTopic(event.target.value)}
            />
          </Field>
          <Field
            label={t('features.aiPreferences.page.preference')}
            hint={`${body.trim().length} / ${MAX}`}
          >
            <Textarea
              rows={4}
              value={body}
              maxLength={MAX}
              placeholder={t('features.aiPreferences.page.bodyPlaceholder')}
              onChange={(event) => setBody(event.target.value)}
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>
            {t('features.aiPreferences.page.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={!ready || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending
              ? t('features.aiPreferences.page.saving')
              : t('features.aiPreferences.page.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
