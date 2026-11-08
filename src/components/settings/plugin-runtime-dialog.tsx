import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { Notice } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { Field, Input } from '#/components/ui/input'
import { Status } from '#/components/ui/status'
import type { Tone } from '#/components/ui/status'
import { toast } from '#/components/ui/sonner'
import { t } from '#/copy'
import {
  pluginRuntimeQueryKey,
  reinstallPluginPackages,
  setPluginLimits,
} from '#/lib/extensions/runtime-client'
import {
  DEFAULT_PLUGIN_LIMITS,
  PLUGIN_LIMIT_KEYS,
} from '#/lib/extensions/runtime-config'
import type {
  PluginEnvironmentState,
  PluginLimitOverrides,
  PluginLimits,
  PluginRuntimeInfo,
} from '#/lib/extensions/runtime-config'

export const environmentTone: Record<PluginEnvironmentState, Tone> = {
  none: 'none',
  building: 'progress',
  ready: 'ok',
  failed: 'bad',
  unavailable: 'warn',
}

type Form = Record<keyof PluginLimits, string>

const formFrom = (overrides: PluginLimitOverrides): Form =>
  Object.fromEntries(
    PLUGIN_LIMIT_KEYS.map((key) => {
      const value = overrides[key]
      return [key, typeof value === 'number' ? String(value) : '']
    }),
  ) as Form

const shown = (key: keyof PluginLimits) => {
  const value = DEFAULT_PLUGIN_LIMITS[key]
  return value === null ? t('plugins.admin.runtime.noLimit') : String(value)
}

/** What the form says, as the settings to save, or the first field that isn't a number. */
function parseForm(form: Form): {
  overrides: PluginLimitOverrides
  invalid: Partial<Record<keyof PluginLimits, string>>
} {
  const overrides: Record<string, number> = {}
  const invalid: Partial<Record<keyof PluginLimits, string>> = {}
  for (const key of PLUGIN_LIMIT_KEYS) {
    const text = form[key].trim()
    if (text === '') continue
    const value = Number(text)
    const whole = key !== 'cpus'
    if (
      !Number.isFinite(value) ||
      value <= 0 ||
      (whole && !Number.isInteger(value))
    ) {
      invalid[key] = whole
        ? t('plugins.admin.runtime.invalid')
        : t('plugins.admin.runtime.invalidDecimal')
      continue
    }
    // Same as the default: nothing to remember.
    if (value === DEFAULT_PLUGIN_LIMITS[key]) continue
    overrides[key] = value
  }
  return { overrides, invalid }
}

/**
 * Python settings for one plugin: the packages it installs and where they
 * stand, the hosts you approved, and how much one call may use.
 */
export function PluginRuntimeDialog({
  name,
  info,
  loading,
  onClose,
}: {
  name: string
  info: PluginRuntimeInfo | undefined
  loading: boolean
  onClose: () => void
}) {
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent className="w-[min(720px,calc(100vw-32px))]">
        <DialogHeader
          title={t('plugins.admin.runtime.title', { name })}
          description={t('plugins.admin.runtime.intro')}
        />
        {info ? (
          <RuntimeForm
            key={info.extensionId}
            name={name}
            info={info}
            onClose={onClose}
          />
        ) : (
          <DialogBody>
            {loading ? null : (
              <Notice tone="bad">{t('plugins.admin.runtime.loadError')}</Notice>
            )}
          </DialogBody>
        )}
      </DialogContent>
    </Dialog>
  )
}

function RuntimeForm({
  name,
  info,
  onClose,
}: {
  name: string
  info: PluginRuntimeInfo
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<Form>(() => formFrom(info.overrides))
  const parsed = useMemo(() => parseForm(form), [form])
  const invalid = Object.keys(parsed.invalid).length > 0

  const save = useMutation({
    mutationFn: (overrides: PluginLimitOverrides) =>
      setPluginLimits(info.extensionId, overrides),
    onSuccess: () => {
      toast(t('plugins.admin.runtime.saved', { name }))
      void queryClient.invalidateQueries({ queryKey: pluginRuntimeQueryKey })
      onClose()
    },
    onError: () => toast.error(t('plugins.admin.couldNotChange')),
  })

  const reinstall = useMutation({
    mutationFn: () => reinstallPluginPackages(info.extensionId),
    onSuccess: () => {
      toast(t('plugins.admin.runtime.reinstalled', { name }))
      void queryClient.invalidateQueries({ queryKey: pluginRuntimeQueryKey })
    },
    onError: () => toast.error(t('plugins.admin.couldNotChange')),
  })

  const { environment } = info
  const packageVersion = (requirement: string) => {
    if (!environment.packages) return null
    const base = /^[A-Za-z0-9._-]+/.exec(requirement)?.[0]
    if (!base) return null
    const key = base.toLowerCase().replace(/[-_.]+/g, '-')
    return environment.packages[key] ?? null
  }

  return (
    <>
      <DialogBody>
        <section
          aria-labelledby="runtime-packages"
          className="flex flex-col gap-2"
        >
          <div className="flex items-center justify-between gap-3">
            <h3 id="runtime-packages" className="text-body font-medium text-fg">
              {t('plugins.admin.runtime.packages')}
            </h3>
            {info.requirements.length > 0 ? (
              <Status tone={environmentTone[environment.state]}>
                {t(`plugins.admin.runtime.state.${environment.state}`)}
              </Status>
            ) : null}
          </div>
          {info.requirements.length === 0 ? (
            <p className="text-body text-fg-muted">
              {t('plugins.admin.runtime.packagesNone')}
            </p>
          ) : (
            <>
              <ul className="flex flex-col gap-0.5 text-body text-fg">
                {info.requirements.map((requirement) => {
                  const version = packageVersion(requirement)
                  return (
                    <li key={requirement} className="flex flex-wrap gap-x-2">
                      <span className="font-mono text-label">
                        {requirement}
                      </span>
                      {version ? (
                        <span className="text-caption text-fg-muted">
                          {t('plugins.admin.runtime.installedAs', { version })}
                        </span>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
              {environment.state === 'failed' && environment.error ? (
                <Notice tone="bad">
                  <pre className="whitespace-pre-wrap font-mono text-label">
                    {environment.error}
                  </pre>
                </Notice>
              ) : (
                <p className="text-caption text-fg-muted">
                  {t('plugins.admin.runtime.packagesHint')}
                </p>
              )}
              {environment.state === 'failed' ||
              environment.state === 'unavailable' ? (
                <div>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={reinstall.isPending}
                    onClick={() => reinstall.mutate()}
                  >
                    {reinstall.isPending
                      ? t('plugins.admin.runtime.reinstalling')
                      : t('plugins.admin.runtime.reinstall')}
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </section>

        <section
          aria-labelledby="runtime-network"
          className="flex flex-col gap-2"
        >
          <h3 id="runtime-network" className="text-body font-medium text-fg">
            {t('plugins.admin.runtime.network')}
          </h3>
          {info.network.length === 0 ? (
            <p className="text-body text-fg-muted">
              {t('plugins.admin.runtime.networkNone')}
            </p>
          ) : (
            <>
              <ul className="flex flex-wrap gap-1.5">
                {info.network.map((host) => (
                  <li
                    key={host}
                    className="rounded-md border border-border-subtle bg-surface-sunken px-1.5 py-0.5 font-mono text-label text-fg"
                  >
                    {host}
                  </li>
                ))}
              </ul>
              <p className="text-caption text-fg-muted">
                {t('plugins.admin.runtime.networkHint')}
              </p>
            </>
          )}
        </section>

        <section
          aria-labelledby="runtime-limits"
          className="flex flex-col gap-2"
        >
          <div>
            <h3 id="runtime-limits" className="text-body font-medium text-fg">
              {t('plugins.admin.runtime.limits')}
            </h3>
            <p className="text-caption text-fg-muted">
              {t('plugins.admin.runtime.limitsHint')}
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {PLUGIN_LIMIT_KEYS.map((key) => {
              const copy = {
                label: t(`plugins.admin.runtime.fields.${key}.label`),
                unit: t(`plugins.admin.runtime.fields.${key}.unit`),
                hint: t(`plugins.admin.runtime.fields.${key}.hint`),
              }
              return (
                <Field
                  key={key}
                  label={`${copy.label} (${copy.unit})`}
                  hint={`${copy.hint} ${t('plugins.admin.runtime.defaultIs', { value: shown(key) })}`}
                  error={parsed.invalid[key]}
                >
                  <Input
                    inputMode="decimal"
                    value={form[key]}
                    placeholder={shown(key)}
                    aria-invalid={parsed.invalid[key] ? true : undefined}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        [key]: event.target.value,
                      }))
                    }
                  />
                </Field>
              )
            })}
          </div>
        </section>
      </DialogBody>
      <DialogFooter>
        <Button
          type="button"
          variant="secondary"
          disabled={save.isPending}
          onClick={() => setForm(formFrom({}))}
        >
          {t('plugins.admin.runtime.useDefaults')}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={save.isPending}
          onClick={onClose}
        >
          {t('plugins.admin.runtime.close')}
        </Button>
        <Button
          type="button"
          disabled={invalid || save.isPending}
          onClick={() => save.mutate(parsed.overrides)}
        >
          {save.isPending
            ? t('plugins.admin.runtime.saving')
            : t('plugins.admin.runtime.save')}
        </Button>
      </DialogFooter>
    </>
  )
}
