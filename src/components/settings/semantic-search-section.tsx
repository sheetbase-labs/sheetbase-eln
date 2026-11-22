import { memo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Notice } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { ConfirmPrompt } from '#/components/ui/confirm-prompt'
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

/** Whether the chosen model is an outside service that has not been allowed. */
function blockedByConsent(
  view: SemanticSettingsView,
  profile: string | null,
  cloudAllowed: boolean,
) {
  const chosen = view.profiles.find((entry) => entry.id === profile)

  return chosen?.dataClass === 'cloud' && !cloudAllowed
}

/** Keep the server snapshot and mutation receipts in sync. */
function useSemanticSettings(workspaceId: string) {
  const queryClient = useQueryClient()
  const key = semanticKey(workspaceId)

  const query = useQuery({
    queryKey: key,
    queryFn: () => getSemanticSettingsFn({ data: { workspaceId } }),
    enabled: Boolean(workspaceId),
    // Progress moves while the page is open.
    refetchInterval: (state) =>
      state.state.data?.settings.enabled ? 15_000 : false,
  })

  /** Show the change at once, save it, and put the screen back on a failure.
   * The toast offers Undo for a saved change. */
  const commit = async (patch: Partial<FormState>, undo = true) => {
    const current = queryClient.getQueryData<SemanticSettingsView>(key)

    if (!current) return

    const before = toForm(current)
    const next = { ...before, ...patch }

    queryClient.setQueryData<SemanticSettingsView>(key, {
      ...current,
      settings: { ...current.settings, ...next },
    })

    try {
      const saved = await updateSemanticSettingsFn({
        data: {
          workspaceId,
          enabled: next.enabled,
          profile: next.profile,
          literatureEnabled: next.literatureEnabled,
        },
      })

      queryClient.setQueryData(key, saved)

      toast(t('settings.semanticSearch.saved'), {
        action: undo
          ? {
              label: t('common.actions.undo'),
              onClick: () => void commit(before, false),
            }
          : undefined,
      })
    } catch (error) {
      queryClient.setQueryData(key, current)

      toast.error(
        error instanceof Error
          ? error.message
          : t('settings.semanticSearch.couldNotSave'),
      )
    }
  }

  const reread = useMutation({
    mutationFn: () => reindexEmbeddingsFn({ data: { workspaceId } }),
    onSuccess: (next) => {
      queryClient.setQueryData(key, next)
      toast(t('settings.semanticSearch.rereadDone'))
    },
    onError: () => toast.error(t('settings.semanticSearch.rereadFailed')),
  })

  return { query, commit, reread }
}

/** What keeps search by meaning off, in one banner; an owner gets a link to
 * the assistant setting that fixes each line. */
function SemanticNotices({
  noModels,
  assistantOff,
  needsConsent,
  canFix,
}: {
  noModels: boolean
  assistantOff: boolean
  needsConsent: boolean
  canFix: boolean
}) {
  const lines = [
    noModels && { text: t('settings.semanticSearch.noModels') },
    assistantOff && {
      text: t('settings.semanticSearch.needsAssistant'),
      fix: t('settings.semanticSearch.turnOnAssistant'),
    },
    needsConsent && {
      text: t('settings.semanticSearch.needsConsent'),
      fix: t('settings.semanticSearch.allowCloud'),
    },
  ].filter((line) => line !== false)

  if (!lines.length) return null

  return (
    <Notice tone={needsConsent ? 'warn' : 'info'}>
      <ul
        className={
          lines.length > 1 ? 'm-0 list-disc pl-4' : 'm-0 list-none p-0'
        }
      >
        {lines.map((line) => (
          <li key={line.text}>
            {line.text}
            {line.fix && canFix ? (
              <>
                {' '}
                <a href="#ai-assistant" className="text-link underline">
                  {line.fix}
                </a>
              </>
            ) : null}
          </li>
        ))}
      </ul>
    </Notice>
  )
}

export const SemanticSearchSection = memo(function SemanticSearchSection({
  workspaceId,
  cloudAllowed,
  assistantOn,
}: {
  workspaceId: string
  /** The workspace has recorded consent for cloud models (assistant section). */
  cloudAllowed: boolean
  /** The assistant switch above: search by meaning follows it. */
  assistantOn: boolean
}) {
  const { query, commit, reread } = useSemanticSettings(workspaceId)

  const [confirmingReread, setConfirmingReread] = useState(false)

  const view = query.data

  if (query.isPending) return <Skeleton className="h-24 w-full" />

  if (!view) return null

  const form = toForm(view)

  const blocked =
    form.enabled && blockedByConsent(view, form.profile, cloudAllowed)

  return (
    <Section title={t('settings.semanticSearch.title')}>
      <Muted>{t('settings.semanticSearch.intro')}</Muted>
      {confirmingReread ? (
        <ConfirmPrompt
          message={t('settings.semanticSearch.rereadConfirm')}
          confirmLabel={t('settings.semanticSearch.reread')}
          onConfirm={() => reread.mutate()}
          onClose={() => setConfirmingReread(false)}
        />
      ) : null}

      <CheckRow
        title={t('settings.semanticSearch.enable')}
        checked={form.enabled}
        onCheckedChange={(enabled) => {
          // Turning it on with no model chosen picks the first one that runs
          // here, or the first one offered, so it is one step.
          const profile =
            form.profile ??
            (
              view.profiles.find((entry) => entry.dataClass !== 'cloud') ??
              view.profiles[0]
            )?.id ??
            null

          void commit(enabled ? { enabled, profile } : { enabled })
        }}
        disabled={!view.canManage || view.profiles.length === 0}
      />

      <SemanticModelPicker
        view={view}
        profile={form.profile}
        onChange={(profile) => void commit({ profile })}
      />

      <SemanticNotices
        noModels={view.profiles.length === 0}
        assistantOff={!assistantOn}
        needsConsent={blocked}
        canFix={view.canManage}
      />

      <CheckRow
        title={t('settings.semanticSearch.literature')}
        body={t('settings.semanticSearch.literatureBody')}
        checked={form.literatureEnabled}
        onCheckedChange={(literatureEnabled) =>
          void commit({ literatureEnabled })
        }
        disabled={!view.canManage}
      />

      <div className="flex flex-wrap items-center gap-3">
        <SemanticProgress settings={view.settings} />
        {view.canManage && view.settings.enabled ? (
          <Button
            onClick={() => setConfirmingReread(true)}
            disabled={reread.isPending}
          >
            {t('settings.semanticSearch.reread')}
          </Button>
        ) : null}
      </div>
    </Section>
  )
})

function SemanticModelPicker({
  view,
  profile,
  onChange,
}: {
  view: SemanticSettingsView
  profile: string | null
  onChange: (profile: string | null) => void
}) {
  if (view.profiles.length === 0) return null

  return (
    <Field
      label={t('settings.semanticSearch.model')}
      hint={t('settings.semanticSearch.modelHint')}
    >
      <Select
        value={profile ?? ''}
        onChange={(event) => onChange(event.target.value || null)}
        disabled={!view.canManage}
        aria-label={t('settings.semanticSearch.model')}
      >
        <option value="">{t('settings.semanticSearch.chooseModel')}</option>
        {view.profiles.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label} (
            {option.dataClass === 'cloud'
              ? t('settings.semanticSearch.cloud')
              : t('settings.semanticSearch.local')}
            )
          </option>
        ))}
      </Select>
    </Field>
  )
}

function SemanticProgress({
  settings,
}: {
  settings: SemanticSettingsView['settings']
}) {
  const { enabled, indexedDocuments, totalDocuments } = settings

  return (
    <Muted data-testid="semantic-progress">
      {t('settings.semanticSearch.progress')}:{' '}
      {!enabled
        ? t('settings.semanticSearch.progressOff')
        : indexedDocuments === 0
          ? t('settings.semanticSearch.progressWaiting')
          : t('settings.semanticSearch.progressValue', {
              indexed: indexedDocuments.toLocaleString('en-GB'),
              total: totalDocuments.toLocaleString('en-GB'),
            })}
    </Muted>
  )
}
