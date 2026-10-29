import { useEffect, useState } from 'react'
import { formatDate } from '#/lib/format-date'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Notice } from '#/components/v3/ui/alert'
import { Button } from '#/components/v3/ui/button'
import { Field, Input } from '#/components/v3/ui/input'
import { Muted, Section } from '#/components/v3/ui/layout'
import { Select } from '#/components/v3/ui/select'
import { Skeleton } from '#/components/v3/ui/skeleton'
import { toast } from '#/components/v3/ui/sonner'
import {
  CheckRow,
  SettingsBody,
  SettingsHeader,
} from '#/components/v3/settings/settings-page'
import {
  getAiSettingsFn,
  updateAiFeatureFlagsFn,
  updateAiSettingsFn,
} from '#/lib/ai-settings-actions'
import { AI_FEATURE_FLAGS, AI_FEATURE_FLAG_KEYS } from '#/lib/ai-feature-flags'
import type { AiFeatureFlags } from '#/lib/ai-feature-flags'
import {
  AI_SETTINGS_MAX_COST_CEILING,
  AI_SETTINGS_MAX_TOKENS_CEILING,
  aiReadinessMessage,
} from '#/lib/ai-settings'
import type {
  AiModel,
  AiSettingsView,
  WorkspaceAiSettings,
} from '#/lib/ai-settings'
import { MODEL_NAMES } from '#/lib/metrics'
import { t } from '#/copy'

/**
 * AI-04 — workspace AI policy.
 *
 * One page owns the kill switch, the provider profile, cloud-egress consent
 * and the per-call budget. Provider keys never appear here: a profile names a
 * server environment variable, and the page only shows whether that key is
 * present.
 */
export const Route = createFileRoute('/settings/ai')({
  component: AiSettingsPage,
})

const MODEL_LABELS: Record<AiModel, string> = {
  'sheetbase-assist-1': 'Assistant',
  'sheetbase-summarise-1': 'Summariser',
}

interface FormState {
  enabled: boolean
  providerProfile: string | null
  model: AiModel
  cloudEgressEnabled: boolean
  maxTokensPerCall: number
  maxCostMicrousdPerCall: number
}

function toForm(settings: WorkspaceAiSettings): FormState {
  return {
    enabled: settings.enabled,
    providerProfile: settings.providerProfile,
    model: settings.model,
    cloudEgressEnabled: settings.cloudEgressEnabled,
    maxTokensPerCall: settings.maxTokensPerCall,
    maxCostMicrousdPerCall: settings.maxCostMicrousdPerCall,
  }
}

function sameForm(a: FormState, b: WorkspaceAiSettings): boolean {
  return (
    a.enabled === b.enabled &&
    a.providerProfile === b.providerProfile &&
    a.model === b.model &&
    a.cloudEgressEnabled === b.cloudEgressEnabled &&
    a.maxTokensPerCall === b.maxTokensPerCall &&
    a.maxCostMicrousdPerCall === b.maxCostMicrousdPerCall
  )
}

const aiSettingsKey = (workspaceId: string) => ['ai-settings', workspaceId]

const MICRO_PER_DOLLAR = 1_000_000

/** A dollar amount for a field the server keeps in millionths of a dollar. The
 * text is held here so a half-typed "0." is not rounded away under the cursor. */
function DollarInput({
  micro,
  onChange,
  ...props
}: {
  micro: number
  onChange: (micro: number) => void
} & Omit<React.ComponentProps<typeof Input>, 'value' | 'onChange'>) {
  const [text, setText] = useState(() =>
    Number.isFinite(micro) ? String(micro / MICRO_PER_DOLLAR) : '',
  )
  return (
    <Input
      type="number"
      min={0}
      step={0.01}
      inputMode="decimal"
      value={text}
      onChange={(event) => {
        setText(event.target.value)
        onChange(
          event.target.value === ''
            ? Number.NaN
            : Math.round(Number(event.target.value) * MICRO_PER_DOLLAR),
        )
      }}
      {...props}
    />
  )
}

function AiSettingsPage() {
  const { context } = Route.useRouteContext()
  const workspaceId = context.workspace?.id ?? ''
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: aiSettingsKey(workspaceId),
    queryFn: () => getAiSettingsFn({ data: { workspaceId } }),
    enabled: Boolean(workspaceId),
  })
  const [form, setForm] = useState<FormState | null>(null)

  useEffect(() => {
    if (query.data && form === null) setForm(toForm(query.data.settings))
  }, [query.data, form])

  const save = useMutation({
    mutationFn: async (next: FormState) => {
      return updateAiSettingsFn({
        data: { workspaceId, ...next },
      })
    },
    onSuccess: (view: AiSettingsView) => {
      queryClient.setQueryData(aiSettingsKey(workspaceId), view)
      setForm(toForm(view.settings))
      toast(t('settings.ai.aiSettingsSavedToast'))
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : t('settings.ai.aiSettingsCould2'),
      )
    },
  })

  const view = query.data
  const [featureFlags, setFeatureFlags] = useState<AiFeatureFlags | null>(null)

  useEffect(() => {
    if (view && featureFlags === null) setFeatureFlags(view.featureFlags)
  }, [view, featureFlags])

  const saveFlags = useMutation({
    mutationFn: (next: AiFeatureFlags) =>
      updateAiFeatureFlagsFn({
        data: { workspaceId, featureFlags: next },
      }),
    onSuccess: (nextView: AiSettingsView) => {
      queryClient.setQueryData(aiSettingsKey(workspaceId), nextView)
      setFeatureFlags(nextView.featureFlags)
      toast(t('settings.ai.aiAccessFlagsToast'))
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : t('settings.ai.aiAccessFlags'),
      )
    },
  })

  const settings = view?.settings
  const dirty = Boolean(form && settings && !sameForm(form, settings))
  const flagsDirty = Boolean(
    featureFlags &&
    view &&
    AI_FEATURE_FLAG_KEYS.some(
      (key) => featureFlags[key] !== view.featureFlags[key],
    ),
  )
  const maxTokensValid =
    form !== null &&
    Number.isInteger(form.maxTokensPerCall) &&
    form.maxTokensPerCall >= 1 &&
    form.maxTokensPerCall <= AI_SETTINGS_MAX_TOKENS_CEILING
  const maxCostValid =
    form !== null &&
    Number.isInteger(form.maxCostMicrousdPerCall) &&
    form.maxCostMicrousdPerCall >= 0 &&
    form.maxCostMicrousdPerCall <= AI_SETTINGS_MAX_COST_CEILING
  const valid = maxTokensValid && maxCostValid
  const selectedProfile =
    form && view && form.providerProfile
      ? view.profiles.find((profile) => profile.id === form.providerProfile)
      : undefined
  const canManage = view?.canManage ?? false

  return (
    <>
      <SettingsHeader
        title={t('settings.ai.ai')}
        actions={
          <Button
            variant="primary"
            onClick={() => form && save.mutate(form)}
            disabled={!dirty || !valid || save.isPending || !canManage}
          >
            {save.isPending
              ? t('common.states.saving')
              : t('common.actions.saveChanges')}
          </Button>
        }
      >
        {t('settings.ai.groundedAssistanceWorkspace')}
      </SettingsHeader>

      <SettingsBody data-testid="ai-settings">
        {query.isPending ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-6 w-64" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : null}

        {query.isError ? (
          <Notice tone="bad" title={t('settings.ai.aiSettingsCould')}>
            {t('settings.ai.reloadPageProblem')}
          </Notice>
        ) : null}

        {view && form ? (
          <>
            {/* An assistant that is switched off says so in the checkboxes
                below; the notice is for what they cannot show. */}
            {view.readiness.ready ||
            (view.readiness.reason !== 'disabled' &&
              view.readiness.reason !== 'feature_disabled') ? (
              <Notice
                tone={view.readiness.ready ? 'info' : 'warn'}
                title={
                  view.readiness.ready
                    ? t('settings.ai.assistantStatus')
                    : t('settings.ai.assistantUnavailable')
                }
              >
                {aiReadinessMessage(view.readiness)}
                {dirty ? t('settings.ai.saveChangesApply') : ''}
              </Notice>
            ) : null}

            {view.providerConfigError ? (
              <Notice
                tone="bad"
                title={t('settings.ai.providerConfigurationInvalid')}
              >
                {view.providerConfigError}
              </Notice>
            ) : null}

            {!canManage ? (
              <Notice tone="warn" title={t('settings.ai.readOnly')}>
                {t('settings.ai.onlyWorkspaceOwner')}
              </Notice>
            ) : null}

            <Section title={t('settings.ai.assistant')}>
              <CheckRow
                title={t('settings.ai.enableAssistantWorkspace')}
                body={t('settings.ai.membersAskGrounded')}
                checked={form.enabled}
                onCheckedChange={(enabled) => setForm({ ...form, enabled })}
                disabled={!canManage}
              />

              <div className="grid gap-4 md:grid-cols-2">
                <Field
                  label={t('settings.ai.providerProfile')}
                  hint={t('settings.ai.profilesSetUpHint')}
                >
                  <Select
                    value={form.providerProfile ?? ''}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        providerProfile: event.target.value || null,
                      })
                    }
                    disabled={!canManage}
                    aria-label={t('settings.ai.providerProfile')}
                  >
                    <option value="">
                      {t('settings.ai.builtDeterministicModel')}
                    </option>
                    {view.profiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.label}
                        {profile.dataClass === 'cloud'
                          ? ' (cloud)'
                          : t('settings.ai.runs')}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field
                  label={t('settings.ai.modelRole')}
                  hint={t('settings.ai.administratorDecidesWhichHint')}
                >
                  <Select
                    value={form.model}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        model: event.target.value as AiModel,
                      })
                    }
                    disabled={!canManage}
                    aria-label={t('settings.ai.modelRole')}
                  >
                    {MODEL_NAMES.map((model) => (
                      <option key={model} value={model}>
                        {MODEL_LABELS[model]}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>

              {selectedProfile ? (
                <div className="flex flex-col gap-3 rounded-lg border border-border-subtle p-3">
                  <div className="flex flex-wrap items-center gap-2 text-label text-fg-muted">
                    <span className="rounded border border-border-subtle px-1.5 py-0.5 text-fg">
                      {selectedProfile.dataClass === 'cloud'
                        ? 'Cloud'
                        : t('settings.ai.runs2')}
                    </span>
                    <span>
                      {selectedProfile.keyAvailable
                        ? t('settings.ai.accessKeyPlace')
                        : t('settings.ai.accessKeyYet')}
                    </span>
                  </div>
                  {selectedProfile.dataClass === 'cloud' ? (
                    <CheckRow
                      title={t('settings.ai.allowPromptsLeave')}
                      body={t('settings.ai.notebookTextPermitted', {
                        label: selectedProfile.label,
                      })}
                      checked={form.cloudEgressEnabled}
                      onCheckedChange={(cloudEgressEnabled) =>
                        setForm({ ...form, cloudEgressEnabled })
                      }
                      disabled={!canManage}
                    />
                  ) : null}
                  {!selectedProfile.keyAvailable ? (
                    <Notice tone="warn">
                      {t('settings.ai.profileAccessKey')}
                    </Notice>
                  ) : null}
                </div>
              ) : null}
            </Section>

            <Section title={t('settings.ai.limits')}>
              <div className="grid gap-4 md:grid-cols-2">
                <Field
                  label={t('settings.ai.maximumTokensPer')}
                  hint={t('settings.ai.n1QuestionWouldHint', {
                    AISETTINGSMAXTOKENSCEILING:
                      AI_SETTINGS_MAX_TOKENS_CEILING.toLocaleString('en-GB'),
                  })}
                  error={
                    maxTokensValid
                      ? undefined
                      : t('settings.ai.enterWholeNumber')
                  }
                >
                  <Input
                    type="number"
                    min={1}
                    max={AI_SETTINGS_MAX_TOKENS_CEILING}
                    step={1}
                    value={
                      Number.isFinite(form.maxTokensPerCall)
                        ? form.maxTokensPerCall
                        : ''
                    }
                    onChange={(event) =>
                      setForm({
                        ...form,
                        maxTokensPerCall: Number(event.target.value),
                      })
                    }
                    disabled={!canManage}
                    aria-label={t('settings.ai.maximumTokensPer')}
                  />
                </Field>

                <Field
                  label={t('settings.ai.maximumCostPer2')}
                  hint={t('settings.ai.example005Hint')}
                  error={
                    maxCostValid
                      ? undefined
                      : t('settings.ai.enterAmountWithin')
                  }
                >
                  <DollarInput
                    micro={form.maxCostMicrousdPerCall}
                    onChange={(maxCostMicrousdPerCall) =>
                      setForm({ ...form, maxCostMicrousdPerCall })
                    }
                    disabled={!canManage}
                    aria-label={t('settings.ai.maximumCostPerAria2')}
                  />
                </Field>
              </div>
            </Section>

            <Section title={t('settings.ai.agentAccess')}>
              <Muted>{t('settings.ai.connectedCodingAgents')}</Muted>
              <Muted>{t('settings.ai.connectedCodingAgents2')}</Muted>
              <Muted>
                {t('settings.ai.createScopedToken2')}
                <Link to="/settings/api">{t('settings.ai.apiSdk')}</Link>.
              </Muted>

              <div className="flex flex-col gap-4">
                {(['standard', 'privileged'] as const).map((risk) => (
                  <div key={risk} className="flex flex-col gap-3">
                    <p className="m-0 text-label font-medium text-fg-muted">
                      {risk === 'standard'
                        ? t('settings.ai.standardAccess')
                        : t('settings.ai.privilegedAccess')}
                    </p>
                    {AI_FEATURE_FLAGS.filter((flag) => flag.risk === risk).map(
                      (flag) => (
                        <CheckRow
                          key={flag.key}
                          title={flag.label}
                          body={flag.description}
                          checked={
                            featureFlags?.[flag.key] ?? flag.defaultValue
                          }
                          onCheckedChange={(enabled) =>
                            setFeatureFlags((current) =>
                              current
                                ? { ...current, [flag.key]: enabled }
                                : current,
                            )
                          }
                          disabled={!canManage || !featureFlags}
                        />
                      ),
                    )}
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="primary"
                  onClick={() => featureFlags && saveFlags.mutate(featureFlags)}
                  disabled={!flagsDirty || saveFlags.isPending || !canManage}
                >
                  {saveFlags.isPending
                    ? t('common.states.saving')
                    : t('settings.ai.saveAccessFlags')}
                </Button>
                <Muted>{t('settings.ai.flagsOnlyReduce')}</Muted>
              </div>
            </Section>

            <Muted>
              {t('settings.ai.lastChanged')}
              {settings?.updatedAt
                ? formatDate(settings.updatedAt, { time: true })
                : 'at workspace creation'}
              {settings?.updatedByUserId ? ' by a workspace owner' : ''}.
            </Muted>
          </>
        ) : null}
      </SettingsBody>
    </>
  )
}
