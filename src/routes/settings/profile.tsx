import { useEffect, useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'

import { Button } from '#/components/v3/ui/button'
import { Field, Input } from '#/components/v3/ui/input'
import { Section } from '#/components/v3/ui/layout'
import { toast } from '#/components/v3/ui/sonner'
import { SettingsSessions } from '#/components/v3/settings/settings-sessions'
import { SettingsTwoFactor } from '#/components/v3/settings/settings-two-factor'
import {
  SettingsBody,
  SettingsHeader,
} from '#/components/v3/settings/settings-page'
import { updateProfileNameFn } from '#/components/v3/settings/settings-profile-data'
import { useTheme } from '#/components/v3/lib/theme'
import { createDataClient } from '#/lib/data-client'
import { isUsableTimeZone, setDisplayTimeZone } from '#/lib/display-time-zone'
import {
  fetchMyProfile,
  myProfileQueryKey,
  setUserAppearance,
  setUserProfileFields,
  setUserTimeZone,
} from '#/lib/user-preferences'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ThemePref } from '#/components/v3/lib/theme'
import { cn } from '#/lib/utils'

/** UI port (roadmap-4/ui-app3): your profile. The display name is saved through
 * Better Auth, or through the server when this deployment runs without sign-in.
 * The time zone is yours alone: every time the app shows, audit and signature
 * times included, is read on that clock (stored instants stay UTC). Initials
 * and job title are yours to edit; the username is set by an administrator. */
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

/** Every IANA zone the browser knows, for the time zone field's suggestions. */
function knownTimeZones(): string[] {
  const supported = (
    Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
  ).supportedValuesOf
  const zones = supported ? supported('timeZone') : []
  return zones.includes('UTC') ? zones : ['UTC', ...zones]
}

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
  const savedTimeZone = context.timeZone
  const [timeZone, setTimeZone] = useState(savedTimeZone)
  const [busy, setBusy] = useState(false)
  const queryClient = useQueryClient()
  const profile = useQuery({
    queryKey: myProfileQueryKey,
    queryFn: () => fetchMyProfile(appearanceClient),
  })
  const [initials, setInitials] = useState('')
  const [jobTitle, setJobTitle] = useState('')
  useEffect(() => {
    if (profile.data) {
      setInitials(profile.data.initials)
      setJobTitle(profile.data.jobTitle)
    }
  }, [profile.data])

  useEffect(() => {
    setName(user.name)
  }, [user.name])
  useEffect(() => {
    setTimeZone(savedTimeZone)
  }, [savedTimeZone])

  const error = name.trim() ? undefined : 'Enter your full name.'
  const zone = timeZone.trim()
  const initialsError =
    initials.trim().length > 4 ? 'Use up to four letters.' : undefined
  const timeZoneError =
    zone && !isUsableTimeZone(zone)
      ? 'Use a time zone name such as Europe/London or America/New_York.'
      : undefined

  return (
    <>
      <SettingsHeader
        title="Profile"
        actions={
          <Button
            variant="primary"
            disabled={
              busy ||
              Boolean(error) ||
              Boolean(timeZoneError) ||
              Boolean(initialsError)
            }
            onClick={async () => {
              setBusy(true)
              try {
                await updateProfileNameFn({ data: { name: name.trim() } })
                if (zone && zone !== savedTimeZone) {
                  await setUserTimeZone(appearanceClient, zone)
                  setDisplayTimeZone(zone)
                }
                if (
                  profile.data &&
                  (initials.trim() !== profile.data.initials ||
                    jobTitle.trim() !== profile.data.jobTitle)
                ) {
                  await setUserProfileFields(appearanceClient, {
                    initials: initials.trim().toUpperCase(),
                    jobTitle: jobTitle.trim(),
                  })
                  await queryClient.invalidateQueries({
                    queryKey: myProfileQueryKey,
                  })
                }
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
            {initials.trim().toUpperCase() || initialsOf(name)}
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
            <Field
              label="Initials"
              hint="Shown on your avatar. Derived from your name until you set them."
              error={initialsError}
            >
              <Input
                value={initials}
                maxLength={6}
                aria-invalid={Boolean(initialsError) || undefined}
                onChange={(e) => setInitials(e.target.value)}
              />
            </Field>
            <Field
              label="Job title"
              hint="Shown beside your name to colleagues."
            >
              <Input
                value={jobTitle}
                placeholder="Research scientist"
                onChange={(e) => setJobTitle(e.target.value)}
              />
            </Field>
            <Field label="Username" hint="Set by an administrator.">
              <Input
                value={context.workspace?.username ?? '—'}
                readOnly
                className="bg-surface-muted text-fg-muted"
              />
            </Field>
            <Field
              label="Time zone"
              hint="Times across Sheetbase, including audit and signature times, show on this clock. Stored times stay in UTC."
              error={timeZoneError}
            >
              <Input
                value={timeZone}
                list="profile-time-zones"
                placeholder="Europe/London"
                aria-invalid={Boolean(timeZoneError) || undefined}
                onChange={(e) => setTimeZone(e.target.value)}
              />
              <datalist id="profile-time-zones">
                {knownTimeZones().map((zoneName) => (
                  <option key={zoneName} value={zoneName} />
                ))}
              </datalist>
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

        <SettingsTwoFactor />

        <Section title="Sessions">
          <SettingsSessions />
        </Section>
      </SettingsBody>
    </>
  )
}
