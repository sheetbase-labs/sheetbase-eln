import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Notice } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { Field } from '#/components/ui/input'
import { Muted, Section } from '#/components/ui/layout'
import { Select } from '#/components/ui/select'
import { Skeleton } from '#/components/ui/skeleton'
import { toast } from '#/components/ui/sonner'
import { CheckRow } from '#/components/settings/settings-page'
import {
  getSemanticSettingsFn,
  reindexEmbeddingsFn,
  updateSemanticSettingsFn,
} from '#/lib/semantic-search-actions'
import type { SemanticSettingsView } from '#/lib/semantic-search-actions'
import { t } from '#/copy'

/**
 * Settings, AI: search by meaning. Opt-in per workspace; names which model
 * reads the text and shows how much has been read so far.
 */

const semanticKey = (workspaceId: string) => ['semantic-settings', workspaceId]

interface FormState {
  enabled: boolean
  profile: string | null
  literatureEnabled: boolean
}

function toForm(view: SemanticSettingsView): FormState {
  return {
    enabled: view.settings.enabled,
    profile: view.settings.profile,
    literatureEnabled: view.settings.literatureEnabled,
  }
}

export function SemanticSearchSection({
  workspaceId,
  cloudAllowed,
}: {
  workspaceId: string
  /** The workspace has recorded consent for cloud models (assistant section). */
  cloudAllowed: boolean
}) {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: semanticKey(workspaceId),
    queryFn: () => getSemanticSettingsFn({ data: { workspaceId } }),
    enabled: Boolean(workspaceId),
    // Progress moves while the page is open.
    refetchInterval: (state) =>
      state.state.data?.settings.enabled ? 15_000 : false,
  })
  const view = query.data
  const [form, setForm] = useState<FormState | null>(null)
  useEffect(() => {
    if (view && form === null) setForm(toForm(view))
  }, [view, form])

  const apply = (next: SemanticSettingsView) => {
    queryClient.setQueryData(semanticKey(workspaceId), next)
    setForm(toForm(next))
  }
  const save = useMutation({
    mutationFn: (next: FormState) =>
      updateSemanticSettingsFn({
        data: {
          workspaceId,
          enabled: next.enabled,
          profile: next.profile,
          literatureEnabled: next.literatureEnabled,
        },
      }),
    onSuccess: (next) => {
      apply(next)
      toast(t('settings.semanticSearch.saved'))
    },
    onError: (error) =>
      toast.error(
        error instanceof Error
          ? error.message
          : t('settings.semanticSearch.couldNotSave'),
      ),
  })
  const reread = useMutation({
    mutationFn: () => reindexEmbeddingsFn({ data: { workspaceId } }),
    onSuccess: (next) => {
      apply(next)
      toast(t('settings.semanticSearch.rereadDone'))
    },
    onError: () => toast.error(t('settings.semanticSearch.rereadFailed')),
  })

  if (query.isPending) return <Skeleton className="h-24 w-full" />
  if (!view || !form) return null

  const chosen = view.profiles.find((profile) => profile.id === form.profile)
  const dirty =
    form.enabled !== view.settings.enabled ||
    form.profile !== view.settings.profile ||
    form.literatureEnabled !== view.settings.literatureEnabled
  const blockedByConsent =
    form.enabled && chosen?.dataClass === 'cloud' && !cloudAllowed
  const canSave =
    view.canManage &&
    dirty &&
    !save.isPending &&
    !blockedByConsent &&
    (!form.enabled || form.profile !== null)
  const { indexedDocuments, totalDocuments } = view.settings

  return (
    <Section title={t('settings.semanticSearch.title')}>
      <Muted>{t('settings.semanticSearch.intro')}</Muted>

      <CheckRow
        title={t('settings.semanticSearch.enable')}
        body={t('settings.semanticSearch.enableBody')}
        checked={form.enabled}
        onCheckedChange={(enabled) => setForm({ ...form, enabled })}
        disabled={!view.canManage || view.profiles.length === 0}
      />

      {view.profiles.length === 0 ? (
        <Notice tone="info">{t('settings.semanticSearch.noModels')}</Notice>
      ) : (
        <Field
          label={t('settings.semanticSearch.model')}
          hint={t('settings.semanticSearch.modelHint')}
        >
          <Select
            value={form.profile ?? ''}
            onChange={(event) =>
              setForm({ ...form, profile: event.target.value || null })
            }
            disabled={!view.canManage}
            aria-label={t('settings.semanticSearch.model')}
          >
            <option value="">{t('settings.semanticSearch.chooseModel')}</option>
            {view.profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.label} (
                {profile.dataClass === 'cloud'
                  ? t('settings.semanticSearch.cloud')
                  : t('settings.semanticSearch.local')}
                )
              </option>
            ))}
          </Select>
        </Field>
      )}

      {blockedByConsent ? (
        <Notice tone="warn">{t('settings.semanticSearch.needsConsent')}</Notice>
      ) : null}

      <CheckRow
        title={t('settings.semanticSearch.literature')}
        body={t('settings.semanticSearch.literatureBody')}
        checked={form.literatureEnabled}
        onCheckedChange={(literatureEnabled) =>
          setForm({ ...form, literatureEnabled })
        }
        disabled={!view.canManage}
      />

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          onClick={() => save.mutate(form)}
          disabled={!canSave}
        >
          {save.isPending
            ? t('common.states.saving')
            : t('settings.semanticSearch.save')}
        </Button>
        <Muted data-testid="semantic-progress">
          {t('settings.semanticSearch.progress')}:{' '}
          {!view.settings.enabled
            ? t('settings.semanticSearch.progressOff')
            : indexedDocuments === 0
              ? t('settings.semanticSearch.progressWaiting')
              : t('settings.semanticSearch.progressValue', {
                  indexed: indexedDocuments.toLocaleString('en-GB'),
                  total: totalDocuments.toLocaleString('en-GB'),
                })}
        </Muted>
        {view.canManage && view.settings.enabled ? (
          <Button
            onClick={() => {
              if (window.confirm(t('settings.semanticSearch.rereadConfirm'))) {
                reread.mutate()
              }
            }}
            disabled={reread.isPending}
          >
            {t('settings.semanticSearch.reread')}
          </Button>
        ) : null}
      </div>
    </Section>
  )
}
