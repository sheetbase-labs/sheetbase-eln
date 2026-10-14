import { useEffect, useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'

import { Button } from '#/components/v3/ui/button'
import { Field, Input } from '#/components/v3/ui/input'
import { Section } from '#/components/v3/ui/layout'
import { toast } from '#/components/v3/ui/sonner'
import { SettingsSessions } from '#/components/v3/settings/settings-sessions'
import {
  SettingsBody,
  SettingsHeader,
} from '#/components/v3/settings/settings-page'
import { updateProfileNameFn } from '#/components/v3/settings/settings-profile-data'
import { useTheme } from '#/components/v3/lib/theme'
import { createDataClient } from '#/lib/data-client'
import { setUserAppearance } from '#/lib/user-preferences'
import type { ThemePref } from '#/components/v3/lib/theme'
import { cn } from '#/lib/utils'

/** UI port (roadmap-4/ui-app3): your profile. The display name is saved through
 * Better Auth, or through the server when this deployment runs without sign-in;
 * the initials, job title and time zone app-3 shows have no field in this model
 * and are stated as gaps. Appearance and sessions are real. */
export const Route = createFileRoute('/settings/profile')({
  component: Profile,
})

const APPEARANCE: { value: ThemePref; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

function initialsOf(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join('') || '?'
  )
}

const appearanceClient = createDataClient()

function Profile() {
  const { context } = Route.useRouteContext()
  const router = useRouter()
  const user = context.user
  const theme = useTheme()
  // The local choice applies immediately (this browser's cookie), so a failed
  // account write must be stated rather than swallowed: the preference then
  // does not follow the user to another browser.
  const chooseAppearance = (value: ThemePref) => {
    theme.setPref(value)
    void setUserAppearance(appearanceClient, value).catch((error: unknown) => {
      toast('Appearance not saved to your account', {
        description: `It applies in this browser only. ${
          error instanceof Error ? error.message : 'The database refused it.'
        }`,
      })
    })
  }
  const [name, setName] = useState(user.name)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setName(user.name)
  }, [user.name])

  const error = name.trim() ? undefined : 'Enter your full name.'

  return (
    <>
      <SettingsHeader
        title="Profile"
        actions={
          <Button
            variant="primary"
            disabled={busy || Boolean(error)}
            onClick={async () => {
              setBusy(true)
              try {
                await updateProfileNameFn({ data: { name: name.trim() } })
                // The shell and this form both read the name from the resolved
                // route context, so re-resolve it rather than report a save the
                // rest of the app has not seen.
                await router.invalidate()
                toast('Changes saved')
              } catch (failure) {
                toast('Could not save your profile', {
                  description:
                    failure instanceof Error ? failure.message : 'Try again.',
                })
              } finally {
                setBusy(false)
              }
            }}
          >
            Save changes
          </Button>
        }
      >
        How you appear to others and on signed records
      </SettingsHeader>
      <SettingsBody>
        <div className="flex items-start gap-6 max-md:flex-col max-md:gap-4">
          <span
            aria-hidden="true"
            className="inline-flex size-14 shrink-0 items-center justify-center rounded-full bg-selection text-[18px] font-semibold"
          >
            {initialsOf(name)}
          </span>
          <div className="grid w-full grid-cols-1 gap-x-5 gap-y-3.5 md:w-auto md:grid-cols-[250px_250px]">
            <Field
              label="Full name"
              hint="Printed on signed records."
              error={error}
            >
              <Input
                value={name}
                aria-invalid={Boolean(error) || undefined}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field label="Email" hint="From your company sign-in.">
              <Input
                value={user.email}
                readOnly
                className="bg-surface-muted text-fg-muted"
              />
            </Field>
            <Field label="Role" hint="Set by an administrator.">
              <Input
                value={context.workspace?.role ?? '—'}
                readOnly
                className="bg-surface-muted text-fg-muted"
              />
            </Field>
          </div>
        </div>

        <Section title="Appearance">
          <div className="flex flex-wrap items-center gap-3.5">
            <div
              role="radiogroup"
              aria-label="Appearance"
              className="inline-flex rounded-md border border-border p-0.5"
            >
              {APPEARANCE.map((option) => {
                const on = theme.pref === option.value
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => chooseAppearance(option.value)}
                    className={cn(
                      'h-6 cursor-pointer rounded-sm border-0 bg-transparent px-2.5 text-label text-fg',
                      on && 'bg-selection font-medium',
                    )}
                  >
                    {option.label}
                  </button>
                )
              })}
            </div>
            <span className="text-label text-fg-muted">
              Applies to every Sheetbase screen open in this browser. System
              follows your computer’s setting.
            </span>
          </div>
        </Section>

        <Section title="Sessions">
          <SettingsSessions />
        </Section>
      </SettingsBody>
    </>
  )
}
