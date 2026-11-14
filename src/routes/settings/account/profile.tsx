import { useEffect, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'

import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import { setDisplayClock } from '#/lib/display-clock'
import type { ClockFormat } from '#/lib/display-clock'
import { Field, Input } from '#/components/ui/input'
import { Section } from '#/components/ui/layout'
import { toast } from '#/components/ui/sonner'
import { ProfilePhoto } from '#/components/settings/profile-photo'
import { ChangeEmailDialog } from '#/components/settings/change-email-dialog'
import { LeaveWorkspace } from '#/components/settings/leave-workspace'
import { SettingsSessions } from '#/components/settings/settings-sessions'
import { SettingsPasskeys } from '#/components/settings/settings-passkeys'
import { SettingsTwoFactor } from '#/components/settings/settings-two-factor'
import {
  SettingsBody,
  SettingsHeader,
} from '#/components/settings/settings-page'
import { updateProfileNameFn } from '#/components/settings/settings-profile-data'
import { useTheme } from '#/components/lib/theme'
import { createDataClient } from '#/lib/data-client'
import { isUsableTimeZone, setDisplayTimeZone } from '#/lib/display-time-zone'
import {
  fetchMyProfile,
  myProfileQueryKey,
  setUserAppearance,
  setUserDisplay,
  setUserProfileFields,
  setUserTimeZone,
} from '#/lib/user-preferences'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ThemePref } from '#/components/lib/theme'
import { cn } from '#/lib/utils'
import { t } from '#/copy'

/** UI port (roadmap-4/ui-app3): your profile. The display name is saved through
 * Better Auth, or through the server when this deployment runs without sign-in.
 * The time zone is yours alone: every time the app shows, audit and signature
 * times included, is read on that clock (stored instants stay UTC). Initials
 * and job title are yours to edit; the username is set by an administrator. */
export const Route = createFileRoute('/settings/account/profile')({
  component: Profile,
})

const APPEARANCE: { value: ThemePref; label: string }[] = [
  { value: 'system', label: t('settings.profile.system') },
  { value: 'light', label: t('settings.profile.light') },
  { value: 'dark', label: t('settings.profile.dark') },
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
  const zones = Intl.supportedValuesOf('timeZone')

  return zones.includes('UTC') ? zones : ['UTC', ...zones]
}

function Profile() {
  const { context } = Route.useRouteContext()
  const user = context.user
  const [name, setName] = useState(user.name)
  const savedTimeZone = context.timeZone
  const [timeZone, setTimeZone] = useState(savedTimeZone)
  const [changingEmail, setChangingEmail] = useState(false)

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
        phoneActions="bottom"
        title={t('settings.profile.profile')}
        actions={
          <SaveProfile
            name={name}
            timeZone={timeZone}
            initials={initials}
            jobTitle={jobTitle}
            profile={profile.data}
            disabled={
              Boolean(error) || Boolean(timeZoneError) || Boolean(initialsError)
            }
          />
        }
      >
        {t('settings.profile.howAppearOthers')}
      </SettingsHeader>
      <SettingsBody>
        <div className="flex items-start gap-6 max-md:flex-col max-md:gap-4">
          <ProfilePhoto
            userId={user.id}
            name={name}
            initials={initials.trim().toUpperCase() || initialsOf(name)}
          />
          <div
            className="grid w-full grid-cols-1 gap-x-5 gap-y-3.5 md:w-auto md:grid-cols-[250px_minmax(250px,22rem)]"
            onKeyDown={saveOnEnter}
          >
            <Field
              label={t('settings.profile.fullName')}
              hint={t('settings.profile.printedSignedRecordsHint')}
              error={error}
            >
              <Input
                value={name}
                aria-invalid={Boolean(error) || undefined}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field
              label={t('settings.profile.initials')}
              hint={t('settings.profile.shownAvatarDerivedHint')}
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
              label={t('settings.profile.jobTitle')}
              hint={t('settings.profile.shownBesideNameHint')}
            >
              <Input
                value={jobTitle}
                placeholder={t('settings.profile.researchScientistPlaceholder')}
                onChange={(e) => setJobTitle(e.target.value)}
              />
            </Field>
            <Field
              label={t('settings.profile.username')}
              hint={t('settings.profile.setAdministratorHint2')}
            >
              <Input
                value={context.workspace?.username ?? '—'}
                readOnly
                className="bg-surface-muted text-fg-muted"
              />
            </Field>
            <Field
              label={t('settings.profile.timeZone')}
              hint={t('settings.profile.timesAcrossSheetbaseHint')}
              error={timeZoneError}
            >
              <Input
                value={timeZone}
                list="profile-time-zones"
                placeholder={t('settings.profile.europeLondonPlaceholder')}
                aria-invalid={Boolean(timeZoneError) || undefined}
                onChange={(e) => setTimeZone(e.target.value)}
              />
              <datalist id="profile-time-zones">
                {knownTimeZones().map((zoneName) => (
                  <option key={zoneName} value={zoneName} />
                ))}
              </datalist>
            </Field>
            <Field
              label={t('settings.profile.email')}
              hint={t('settings.profile.companySignHint')}
            >
              <div className="relative">
                <Input
                  value={user.email}
                  title={user.email}
                  readOnly
                  className="bg-surface-muted pr-[72px] text-fg-muted"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="quiet"
                  className="absolute right-0.5 top-0.5"
                  onClick={(event) => {
                    event.preventDefault()
                    setChangingEmail(true)
                  }}
                >
                  {t('account.email.change')}
                </Button>
              </div>
            </Field>
            <Field
              label={t('settings.profile.role')}
              hint={t('settings.profile.setAdministratorHint')}
            >
              <Input
                value={context.workspace?.role ?? '—'}
                readOnly
                className="bg-surface-muted text-fg-muted"
              />
            </Field>
          </div>
        </div>

        <DisplayPreferences />
        {changingEmail ? (
          <ChangeEmailDialog
            current={user.email}
            onClose={() => setChangingEmail(false)}
          />
        ) : null}

        <SettingsPasskeys />

        <SettingsTwoFactor />

        <Section title={t('settings.profile.sessions')}>
          <SettingsSessions />
        </Section>

        {context.workspace ? (
          <LeaveWorkspace
            workspaceId={context.workspace.id}
            workspaceName={context.workspace.name}
            otherWorkspaces={
              context.workspaces.filter(
                (w) => w.id !== context.workspace?.id && !w.suspended,
              ).length
            }
          />
        ) : null}
      </SettingsBody>
    </>
  )
}

/** Enter in a one-line field saves the profile, as the Save changes button does. */
function saveOnEnter(event: KeyboardEvent<HTMLDivElement>) {
  const target = event.target

  if (event.key !== 'Enter' || event.defaultPrevented) return

  if (!(target instanceof HTMLInputElement) || target.type === 'file') return

  const save = document.querySelector<HTMLButtonElement>(
    'button[data-profile-save]:not([disabled])',
  )

  if (!save) return

  event.preventDefault()
  save.click()
}

function SaveProfile({
  name,
  timeZone,
  initials,
  jobTitle,
  profile,
  disabled,
}: {
  name: string
  timeZone: string
  initials: string
  jobTitle: string
  profile: Awaited<ReturnType<typeof fetchMyProfile>> | undefined
  disabled: boolean
}) {
  const { context } = Route.useRouteContext()
  const router = useRouter()
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const zone = timeZone.trim()

  return (
    <Button
      variant="primary"
      data-profile-save
      disabled={busy || disabled}
      onClick={async () => {
        setBusy(true)

        try {
          await updateProfileNameFn({ data: { name: name.trim() } })

          if (zone && zone !== context.timeZone) {
            await setUserTimeZone(appearanceClient, zone)
            setDisplayTimeZone(zone)
          }

          if (
            profile &&
            (initials.trim() !== profile.initials ||
              jobTitle.trim() !== profile.jobTitle)
          ) {
            await setUserProfileFields(appearanceClient, {
              initials: initials.trim().toUpperCase(),
              jobTitle: jobTitle.trim(),
            })
            await queryClient.invalidateQueries({ queryKey: myProfileQueryKey })
          }

          // The shell and this form both read the name from the resolved
          // route context, so re-resolve it rather than report a save the
          // rest of the app has not seen.
          await router.invalidate()
          toast(t('settings.profile.changesSavedToast'))
        } catch (failure) {
          toast.error(t('settings.profile.couldSaveProfileToast'), {
            description:
              failure instanceof Error
                ? failure.message
                : t('settings.profile.tryAgain'),
          })
        } finally {
          setBusy(false)
        }
      }}
    >
      {t('common.actions.saveChanges')}
    </Button>
  )
}

function DisplayPreferences() {
  const { context } = Route.useRouteContext()
  const router = useRouter()
  const theme = useTheme()
  const clock = context.clock ?? '24h'

  // The local choice applies immediately (this browser's cookie), so a failed
  // account write must be stated rather than swallowed: the preference then
  // does not follow the user to another browser.
  const chooseAppearance = (value: ThemePref) => {
    theme.setPref(value)
    void setUserAppearance(appearanceClient, value).catch((error: Error) => {
      toast(t('settings.profile.appearanceSavedAccountToast'), {
        description: t('settings.profile.appliesInBrowserOnly', {
          reason:
            error instanceof Error
              ? error.message
              : t('settings.profile.databaseRefused'),
        }),
      })
    })
  }

  // The clock and the layout bar apply as soon as they are chosen, like the
  // appearance above, and follow the person to every browser.
  const chooseDisplay = (display: {
    clock?: ClockFormat
    alwaysShowLayout?: boolean
  }) => {
    if (display.clock) setDisplayClock(display.clock)
    void setUserDisplay(appearanceClient, display)
      .then(() => router.invalidate())
      .catch((failure: Error) =>
        toast(t('settings.profile.displaySavedFailed'), {
          description:
            failure instanceof Error
              ? failure.message
              : t('settings.profile.tryAgain'),
        }),
      )
  }

  return (
    <>
      <Section title={t('settings.profile.appearance')}>
        <div className="flex flex-wrap items-center gap-3.5">
          <div
            role="radiogroup"
            aria-label={t('settings.profile.appearance')}
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
            {t('settings.profile.appliesEverySheetbase')}
          </span>
        </div>
      </Section>

      <Section title={t('settings.profile.display')}>
        <div className="flex flex-col gap-3.5">
          <Field
            label={t('settings.profile.clock')}
            hint={t('settings.profile.clockHint')}
          >
            <div
              role="radiogroup"
              aria-label={t('settings.profile.clock')}
              className="inline-flex w-fit rounded-md border border-border p-0.5"
            >
              {(
                [
                  ['24h', t('settings.profile.clock24')],
                  ['12h', t('settings.profile.clock12')],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={clock === value}
                  onClick={() => chooseDisplay({ clock: value })}
                  className={cn(
                    'h-6 cursor-pointer rounded-sm border-0 bg-transparent px-2.5 text-label text-fg',
                    clock === value && 'bg-selection font-medium',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </Field>
          <label className="flex items-start gap-2 text-body">
            <Checkbox
              className="mt-0.5"
              checked={context.alwaysShowLayout === true}
              onCheckedChange={(checked) =>
                chooseDisplay({ alwaysShowLayout: checked === true })
              }
            />
            <span className="flex flex-col">
              {t('settings.profile.alwaysShowLayout')}
              <span className="text-label text-fg-muted">
                {t('settings.profile.alwaysShowLayoutHint')}
              </span>
            </span>
          </label>
        </div>
      </Section>
    </>
  )
}
