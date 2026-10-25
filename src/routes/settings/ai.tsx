import { useEffect, useState } from 'react'
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
import { getAiSettingsFn, updateAiSettingsFn } from '#/lib/ai-settings-actions'
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
  'sheetbase-assist-1': 'Assistant — sheetbase-assist-1',
  'sheetbase-summarise-1': 'Summariser — sheetbase-summarise-1',
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
      toast('AI settings saved')
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : 'AI settings could not be saved.',
      )
    },
  })

  const view = query.data
  const settings = view?.settings
  const dirty = Boolean(form && settings && !sameForm(form, settings))
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
        title="AI"
        actions={
          <Button
            variant="primary"
            onClick={() => form && save.mutate(form)}
            disabled={!dirty || !valid || save.isPending || !canManage}
          >
            {save.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        }
      >
        Grounded assistance for this workspace. AI output is assistive: it never
        signs, approves or commits a change.
      </SettingsHeader>

      <SettingsBody data-testid="ai-settings">
        {query.isPending ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-6 w-64" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : null}

        {query.isError ? (
          <Notice tone="bad" title="AI settings could not be loaded">
            Reload the page. If the problem persists, a deployment administrator
            should check the server log.
          </Notice>
        ) : null}

        {view && form ? (
          <>
            <Notice
              tone={
                view.readiness.ready
                  ? 'info'
                  : view.readiness.reason === 'disabled'
                    ? 'info'
                    : 'warn'
              }
              title={
                view.readiness.ready
                  ? 'Assistant status'
                  : 'Assistant unavailable'
              }
            >
              {aiReadinessMessage(view.readiness)}
              {dirty ? ' Save your changes to apply the new policy.' : ''}
            </Notice>

            {view.providerConfigError ? (
              <Notice tone="bad" title="Provider configuration is invalid">
                {view.providerConfigError}
              </Notice>
            ) : null}

            {!canManage ? (
              <Notice tone="warn" title="Read-only">
                Only a workspace owner can change AI settings.
              </Notice>
            ) : null}

            <Section title="Assistant">
              <CheckRow
                title="Enable the assistant for this workspace"
                body="Members can ask grounded questions about objects they can already read. Turning this off is the workspace kill switch."
                checked={form.enabled}
                onCheckedChange={(enabled) => setForm({ ...form, enabled })}
                disabled={!canManage}
              />

              <div className="grid gap-4 md:grid-cols-2">
                <Field
                  label="Provider profile"
                  hint="Profiles are deployment configuration. The key stays on the server."
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
                    aria-label="Provider profile"
                  >
                    <option value="">
                      Built-in deterministic model (no external provider)
                    </option>
                    {view.profiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.label} — {profile.model}
                        {profile.dataClass === 'cloud'
                          ? ' (cloud)'
                          : ' (local)'}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field
                  label="Model role"
                  hint="The gateway allowlist decides this; the provider supplies the concrete model."
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
                    aria-label="Model role"
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
                      {selectedProfile.dataClass}
                    </span>
                    <span>{selectedProfile.model}</span>
                    <span>
                      {selectedProfile.keyAvailable
                        ? 'Key present'
                        : 'No key on this deployment'}
                    </span>
                  </div>
                  {selectedProfile.dataClass === 'cloud' ? (
                    <CheckRow
                      title="Allow prompts to leave this deployment"
                      body={`Notebook text and permitted record fields may be sent to ${selectedProfile.label}. Files are never included. This consent is recorded on the workspace.`}
                      checked={form.cloudEgressEnabled}
                      onCheckedChange={(cloudEgressEnabled) =>
                        setForm({ ...form, cloudEgressEnabled })
                      }
                      disabled={!canManage}
                    />
                  ) : null}
                  {!selectedProfile.keyAvailable ? (
                    <Notice tone="warn">
                      This profile has no API key. The assistant stays
                      unavailable until a deployment administrator sets the
                      environment variable named by the profile.
                    </Notice>
                  ) : null}
                </div>
              ) : null}
            </Section>

            <Section title="Limits">
              <div className="grid gap-4 md:grid-cols-2">
                <Field
                  label="Maximum tokens per call"
                  hint={`1–${AI_SETTINGS_MAX_TOKENS_CEILING.toLocaleString('en-GB')}. The gateway rejects a call before it leaves the server if the estimated context cannot fit.`}
                  error={
                    maxTokensValid
                      ? undefined
                      : 'Enter a whole number within the allowed range.'
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
                    aria-label="Maximum tokens per call"
                  />
                </Field>

                <Field
                  label="Maximum cost per call (micro-USD)"
                  hint="50,000 micro-USD = $0.05. The provider's reported cost is checked again after the call."
                  error={
                    maxCostValid
                      ? undefined
                      : 'Enter a whole number within the allowed range.'
                  }
                >
                  <Input
                    type="number"
                    min={0}
                    max={AI_SETTINGS_MAX_COST_CEILING}
                    step={1}
                    value={
                      Number.isFinite(form.maxCostMicrousdPerCall)
                        ? form.maxCostMicrousdPerCall
                        : ''
                    }
                    onChange={(event) =>
                      setForm({
                        ...form,
                        maxCostMicrousdPerCall: Number(event.target.value),
                      })
                    }
                    disabled={!canManage}
                    aria-label="Maximum cost per call in micro-USD"
                  />
                </Field>
              </div>
            </Section>

            <Section title="Agent access">
              <Muted>
                The MCP endpoint is <code>POST /api/mcp</code>. A coding agent
                or hosted MCP client authenticates with a personal token, sees
                only the tools its scopes allow, and can only propose changes
                through the canonical approval path. Signing and execution
                remain human.
              </Muted>
              <Muted>
                Create a scoped token under{' '}
                <Link to="/settings/api">API and SDK</Link>. The domain skills
                live in <code>.agents/skills/sheetbase-domain</code> and{' '}
                <code>.agents/skills/sheetbase-mcp</code>.
              </Muted>
            </Section>

            <Muted>
              Last changed{' '}
              {settings?.updatedAt
                ? new Date(settings.updatedAt).toLocaleString('en-GB')
                : 'at workspace creation'}
              {settings?.updatedByUserId ? ' by a workspace owner' : ''}.
            </Muted>
          </>
        ) : null}
      </SettingsBody>
    </>
  )
}
