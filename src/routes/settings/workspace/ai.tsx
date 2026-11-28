import { memo, useState } from 'react'
import { z } from 'zod'
import { formatDate } from '#/lib/format-date'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'

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
import { Muted, Section } from '#/components/ui/layout'
import { Select } from '#/components/ui/select'
import { AgentPermissionsPanel } from '#/components/settings/agent-permissions-panel'
import { AiChecksPanel } from '#/components/settings/ai-checks-panel'
import { Skeleton } from '#/components/ui/skeleton'
import { toast } from '#/components/ui/sonner'
import {
  CheckRow,
  SettingsBody,
  SettingsHeader,
} from '#/components/settings/settings-page'
import {
  getAiSettingsFn,
  updateAiFeatureFlagsFn,
  updateAiSettingsFn,
} from '#/lib/ai-settings-actions'
import { AI_FEATURE_FLAGS } from '#/lib/ai-feature-flags'
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
import { SemanticSearchSection } from '#/components/settings/semantic-search-section'
import { MODEL_NAMES } from '#/lib/metrics'
import { t } from '#/copy'

/**
 * AI-04 — workspace AI policy.
 *
 * One page owns the on/off switch, which AI the lab uses, the consent to send
 * data to an outside AI service, and the per-request budget. Every control
 * saves the moment it changes (the screen updates at once and a toast offers
 * Undo); nothing here has a Save button. Provider keys never appear here: a
 * profile names a server environment variable, and the page only shows
 * whether that key is present.
 */
export const Route = createFileRoute('/settings/workspace/ai')({
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

function tokensValid(value: number) {
  return (
    Number.isInteger(value) &&
    value >= 1 &&
    value <= AI_SETTINGS_MAX_TOKENS_CEILING
  )
}

function costValid(value: number) {
  return (
    Number.isInteger(value) &&
    value >= 0 &&
    value <= AI_SETTINGS_MAX_COST_CEILING
  )
}

function AiSettingsPage() {
  const { context } = Route.useRouteContext()
  const workspaceId = context.workspace?.id ?? ''

  return <WorkspaceAiSettingsForm key={workspaceId} workspaceId={workspaceId} />
}

/** What the person is about to switch on while consent is still missing. */
type ConsentIntent = Partial<Pick<FormState, 'enabled' | 'providerProfile'>>

function WorkspaceAiSettingsForm({ workspaceId }: { workspaceId: string }) {
  const queryClient = useQueryClient()
  const key = aiSettingsKey(workspaceId)

  const query = useQuery({
    queryKey: key,
    queryFn: () => getAiSettingsFn({ data: { workspaceId } }),
    enabled: Boolean(workspaceId),
  })

  const [asking, setAsking] = useState<ConsentIntent | null>(null)

  const view = query.data
  const settings = view?.settings
  const canManage = view?.canManage ?? false

  /** Apply a change on screen at once, save it, and put the screen back with
   * an error if the save fails. The toast offers Undo for a saved change. */
  const commit = async (patch: Partial<FormState>, undo = true) => {
    const current = queryClient.getQueryData<AiSettingsView>(key)

    if (!current) return

    const before = toForm(current.settings)
    const next = { ...before, ...patch }

    queryClient.setQueryData<AiSettingsView>(key, {
      ...current,
      settings: { ...current.settings, ...next },
    })

    try {
      const saved = await updateAiSettingsFn({ data: { workspaceId, ...next } })

      queryClient.setQueryData(key, saved)

      toast(t('settings.ai.aiSettingsSavedToast'), {
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
          : t('settings.ai.aiSettingsCould2'),
      )
    }
  }

  const commitFlag = async (flag: keyof AiFeatureFlags, on: boolean) => {
    const current = queryClient.getQueryData<AiSettingsView>(key)

    if (!current) return

    const before = current.featureFlags
    const next = { ...before, [flag]: on }

    queryClient.setQueryData<AiSettingsView>(key, {
      ...current,
      featureFlags: next,
    })

    try {
      const saved = await updateAiFeatureFlagsFn({
        data: { workspaceId, featureFlags: next },
      })

      queryClient.setQueryData(key, saved)

      toast(t('settings.ai.aiAccessFlagsToast'), {
        action: {
          label: t('common.actions.undo'),
          onClick: () => void commitFlag(flag, !on),
        },
      })
    } catch (error) {
      queryClient.setQueryData(key, current)

      toast.error(
        error instanceof Error ? error.message : t('settings.ai.aiAccessFlags'),
      )
    }
  }

  return (
    <>
      <SettingsHeader title={t('settings.ai.ai')}>
        {settings ? <AiSettingsChanged settings={settings} /> : null}
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

        {view && settings ? (
          <>
            <AiNotices
              readiness={view.readiness}
              providerConfigError={view.providerConfigError}
              canManage={canManage}
            />

            <div id="ai-assistant" className="scroll-mt-4">
              <AssistantConfiguration
                form={toForm(settings)}
                profiles={view.profiles}
                canManage={canManage}
                onChange={(patch) => void commit(patch)}
                onAskConsent={setAsking}
              />
            </div>

            <SemanticSearchSection
              workspaceId={workspaceId}
              cloudAllowed={settings.cloudEgressEnabled}
              assistantOn={settings.enabled}
            />

            <AiBudget
              key={`${settings.maxTokensPerCall}-${settings.maxCostMicrousdPerCall}`}
              maxTokens={settings.maxTokensPerCall}
              maxCost={settings.maxCostMicrousdPerCall}
              canManage={canManage}
              onChange={(patch) => void commit(patch)}
            />

            <Section
              title={t('settings.ai.agentAccess')}
              description={t('settings.ai.connectedCodingAgents')}
            >
              <Muted>
                {t('settings.ai.createScopedToken2')}{' '}
                <Link
                  to="/settings/account/api"
                  className="text-link underline"
                >
                  {t('settings.ai.apiSdk')}
                </Link>
              </Muted>

              <AiAccessFlags
                flags={view.featureFlags}
                canManage={canManage}
                onChange={(flag, on) => void commitFlag(flag, on)}
              />
            </Section>

            <AgentPermissionsPanel
              workspaceId={workspaceId}
              canManage={canManage}
            />

            <AiChecksPanel
              workspaceId={workspaceId}
              canManage={canManage}
              aiOn={settings.enabled}
            />
          </>
        ) : null}
      </SettingsBody>

      {asking && view ? (
        <ConsentDialog
          label={
            view.profiles.find(
              (profile) =>
                profile.id ===
                (asking.providerProfile ?? settings?.providerProfile),
            )?.label ?? ''
          }
          onClose={() => setAsking(null)}
          onAllow={() => {
            const intent = asking

            setAsking(null)
            void commit({ ...intent, enabled: true, cloudEgressEnabled: true })
          }}
        />
      ) : null}
    </>
  )
}

/** The one question asked before data can go to an outside AI service. */
function ConsentDialog({
  label,
  onClose,
  onAllow,
}: {
  label: string
  onClose: () => void
  onAllow: () => void
}) {
  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent>
        <DialogHeader title={t('settings.ai.consentTitle')} />
        <DialogBody className="flex flex-col gap-2">
          <p className="m-0">{t('settings.ai.consentBody', { label })}</p>
          <Muted>{t('settings.ai.consentNote')}</Muted>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>
            {t('settings.ai.consentCancel')}
          </DialogClose>
          <Button variant="primary" onClick={onAllow}>
            {t('settings.ai.consentAllow')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** One banner for everything that keeps the assistant from working, each
 * line pointing at the setting an owner changes to fix it. */
function AiNotices({
  readiness,
  providerConfigError,
  canManage,
}: {
  readiness: AiSettingsView['readiness']
  providerConfigError: string | null | undefined
  canManage: boolean
}) {
  const lines: { text: string; fix?: string }[] = []

  if (!canManage) lines.push({ text: t('settings.ai.onlyWorkspaceOwner') })

  if (providerConfigError)
    lines.push({ text: providerConfigError, fix: '#ai-assistant' })

  if (
    !readiness.ready &&
    readiness.reason !== 'disabled' &&
    readiness.reason !== 'feature_disabled' &&
    readiness.reason !== 'provider_config_invalid'
  )
    lines.push({ text: aiReadinessMessage(readiness), fix: '#ai-assistant' })

  if (!lines.length) return null

  return (
    <Notice tone={providerConfigError ? 'bad' : 'warn'}>
      <ul
        className={
          lines.length > 1 ? 'm-0 list-disc pl-4' : 'm-0 list-none p-0'
        }
      >
        {lines.map((line) => (
          <li key={line.text}>
            {line.text}
            {line.fix && canManage ? (
              <>
                {' '}
                <a href={line.fix} className="text-link underline">
                  {t('settings.ai.fixInAssistantSettings')}
                </a>
              </>
            ) : null}
          </li>
        ))}
      </ul>
    </Notice>
  )
}

function AiSettingsChanged({
  settings,
}: {
  settings: WorkspaceAiSettings | undefined
}) {
  return (
    <>
      {t('settings.ai.lastChanged')}{' '}
      {settings?.updatedAt
        ? formatDate(settings.updatedAt, { time: true })
        : 'at workspace creation'}
      {settings?.updatedByUserId ? ' by a workspace owner' : ''}.
    </>
  )
}

function AssistantConfiguration({
  form,
  profiles,
  onChange,
  onAskConsent,
  canManage,
}: {
  form: FormState
  profiles: AiSettingsView['profiles']
  onChange: (patch: Partial<FormState>) => void
  onAskConsent: (intent: ConsentIntent) => void
  canManage: boolean
}) {
  const selectedProfile = form.providerProfile
    ? profiles.find((profile) => profile.id === form.providerProfile)
    : undefined

  const outside = selectedProfile?.dataClass === 'cloud'

  return (
    <Section title={t('settings.ai.assistant')}>
      <CheckRow
        title={t('settings.ai.enableAssistantWorkspace')}
        body={t('settings.ai.membersAskGrounded')}
        checked={form.enabled}
        onCheckedChange={(enabled) => {
          if (enabled && outside && !form.cloudEgressEnabled)
            onAskConsent({ enabled: true })
          else onChange({ enabled })
        }}
        disabled={!canManage}
      />
      <div className="grid gap-4 md:grid-cols-2">
        <Field
          label={t('settings.ai.providerProfile')}
          hint={
            profiles.length === 0
              ? t('settings.ai.noProfilesHint')
              : t('settings.ai.profilesSetUpHint')
          }
        >
          <Select
            value={form.providerProfile ?? ''}
            onChange={(event) => {
              const id = event.target.value || null

              const next = id
                ? profiles.find((profile) => profile.id === id)
                : undefined

              if (next?.dataClass === 'cloud' && !form.cloudEgressEnabled)
                onAskConsent({ providerProfile: id })
              else onChange({ providerProfile: id })
            }}
            disabled={!canManage}
            aria-label={t('settings.ai.providerProfile')}
          >
            <option value="">{t('settings.ai.builtDeterministicModel')}</option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.label}
                {profile.dataClass === 'cloud'
                  ? t('settings.ai.outsideSuffix')
                  : t('settings.ai.runs')}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('settings.ai.modelRole')}>
          <Select
            value={form.model}
            onChange={(event) =>
              onChange({ model: z.enum(MODEL_NAMES).parse(event.target.value) })
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
        <div className="flex flex-col gap-3">
          <Muted>
            {selectedProfile.keyAvailable
              ? t('settings.ai.accessKeyPlace')
              : t('settings.ai.accessKeyYet')}
          </Muted>
          {outside ? (
            <CheckRow
              title={t('settings.ai.allowPromptsLeave')}
              body={t('settings.ai.notebookTextPermitted', {
                label: selectedProfile.label,
              })}
              checked={form.cloudEgressEnabled}
              onCheckedChange={(allowed) =>
                onChange(
                  allowed
                    ? { cloudEgressEnabled: true }
                    : { cloudEgressEnabled: false, enabled: false },
                )
              }
              disabled={!canManage}
            />
          ) : null}
          {!selectedProfile.keyAvailable ? (
            <Notice tone="warn">{t('settings.ai.profileAccessKey')}</Notice>
          ) : null}
        </div>
      ) : null}
    </Section>
  )
}

const AiAccessFlags = memo(function AiAccessFlags({
  flags,
  onChange,
  canManage,
}: {
  flags: AiFeatureFlags
  onChange: (flag: keyof AiFeatureFlags, on: boolean) => void
  canManage: boolean
}) {
  return (
    <>
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
                  checked={flags[flag.key]}
                  onCheckedChange={(enabled) => onChange(flag.key, enabled)}
                  disabled={!canManage}
                />
              ),
            )}
          </div>
        ))}
      </div>
      <Muted>{t('settings.ai.flagsOnlyReduce')}</Muted>
    </>
  )
})

function AiBudget({
  maxTokens,
  maxCost,
  onChange,
  canManage,
}: {
  maxTokens: number
  maxCost: number
  onChange: (patch: Partial<FormState>) => void
  canManage: boolean
}) {
  // react-doctor-disable-next-line react-doctor/no-derived-useState -- The caller keys this component by the saved values, so a save or an Undo remounts it with fresh text; typing is held here until the field is left.
  const [tokens, setTokens] = useState(maxTokens)
  // react-doctor-disable-next-line react-doctor/no-derived-useState -- Same as above.
  const [cost, setCost] = useState(maxCost)

  const tokensOk = tokensValid(tokens)
  const costOk = costValid(cost)

  return (
    <Section title={t('settings.ai.limits')}>
      <div className="grid gap-4 md:grid-cols-2">
        <Field
          label={t('settings.ai.maximumTokensPer')}
          hint={t('settings.ai.n1QuestionWouldHint', {
            AISETTINGSMAXTOKENSCEILING:
              AI_SETTINGS_MAX_TOKENS_CEILING.toLocaleString('en-GB'),
          })}
          error={tokensOk ? undefined : t('settings.ai.enterWholeNumber')}
        >
          <Input
            type="number"
            min={1}
            max={AI_SETTINGS_MAX_TOKENS_CEILING}
            step={1}
            value={Number.isFinite(tokens) ? tokens : ''}
            onChange={(event) => setTokens(Number(event.target.value))}
            onBlur={() => {
              if (tokensOk && tokens !== maxTokens)
                onChange({ maxTokensPerCall: tokens })
            }}
            disabled={!canManage}
            aria-label={t('settings.ai.maximumTokensPer')}
          />
        </Field>
        <Field
          label={t('settings.ai.maximumCostPer2')}
          error={costOk ? undefined : t('settings.ai.enterAmountWithin')}
        >
          <DollarInput
            micro={maxCost}
            onChange={setCost}
            onBlur={() => {
              if (costOk && cost !== maxCost)
                onChange({ maxCostMicrousdPerCall: cost })
            }}
            disabled={!canManage}
            aria-label={t('settings.ai.maximumCostPerAria2')}
          />
        </Field>
      </div>
    </Section>
  )
}
