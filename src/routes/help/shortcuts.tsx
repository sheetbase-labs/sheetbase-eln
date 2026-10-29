import { Link, createFileRoute } from '@tanstack/react-router'

import { usePlatform } from '#/lib/use-platform'
import { useShortcuts } from '#/components/shortcuts/shortcut-provider'
import { ShortcutGroups } from '#/components/shortcuts/shortcuts-dialog'
import { Button } from '#/components/v3/ui/button'
import { Breadcrumb } from '#/components/v3/ui/breadcrumb'
import { Kbd } from '#/components/v3/ui/kbd'
import { Tabs } from '#/components/v3/ui/tabs'
import { requestShortcutsDialog } from '#/lib/shortcuts-dialog'

import { ReleaseCard } from '../help'
import { rich, t } from '#/copy'

/** Keyboard shortcuts. `?os=windows` (the default off a Mac) shows Ctrl/Alt/Shift instead of ⌘/⌥/⇧. */
export const Route = createFileRoute('/help/shortcuts')({
  validateSearch: (
    search: Record<string, unknown>,
  ): { os?: 'mac' | 'windows' } => ({
    os: search.os === 'windows' || search.os === 'mac' ? search.os : undefined,
  }),
  component: Shortcuts,
})

function Shortcuts() {
  const platform = usePlatform()
  // Open on the tab for the keyboard the reader actually has.
  const { os = platform === 'mac' ? 'mac' : 'windows' } = Route.useSearch()
  const { registry } = useShortcuts()
  return (
    <div className="grid grid-cols-1 gap-8 px-4 pb-10 pt-5 md:px-8 lg:grid-cols-[minmax(0,1fr)_260px]">
      <div className="flex min-w-0 flex-col gap-5">
        <header className="flex flex-col gap-1.5">
          <Breadcrumb
            trail={[
              {
                label: t('settings.help.shortcuts.help'),
                link: { to: '/help' },
              },
              { label: t('settings.help.shortcuts.keyboardShortcuts') },
            ]}
          />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="flex-1 text-title max-md:basis-full max-md:text-[18px] max-md:leading-6">
              {t('settings.help.shortcuts.keyboardShortcuts')}
            </h1>
            <Tabs
              mode="url"
              variant="segment"
              value={os}
              label={t('settings.help.shortcuts.keyboard')}
              items={(['mac', 'windows'] as const).map((o) => ({
                key: o,
                label:
                  o === 'mac'
                    ? 'Mac'
                    : t('settings.help.shortcuts.windowsLinux'),
                link: {
                  to: '/help/shortcuts',
                  search: { os: o },
                  replace: true,
                },
              }))}
            />
          </div>
          <p className="m-0 text-body text-fg-muted">
            {rich('settings.help.shortcuts.pressForAll', {
              key: <Kbd>?</Kbd>,
            })}
          </p>
        </header>
        <ShortcutGroups
          definitions={registry.definitions.filter(
            (definition) => !definition.additional,
          )}
          platform={os === 'mac' ? 'mac' : 'other'}
        />
        <section className="flex flex-col gap-3">
          <h2 className="text-title">
            {t('settings.help.shortcuts.additionalNavigationShortcuts')}
          </h2>
          <ShortcutGroups
            definitions={registry.definitions.filter(
              (definition) => definition.additional,
            )}
            platform={os === 'mac' ? 'mac' : 'other'}
            headingLevel={3}
          />
        </section>
        <div>
          <Button onClick={requestShortcutsDialog}>
            {t('settings.help.shortcuts.showKeyboardShortcuts')}
          </Button>
        </div>
        <section
          id="focus-order"
          className="flex scroll-mt-5 flex-col gap-2 text-body"
        >
          <h2 className="text-title">
            {t('settings.help.shortcuts.focusOrder')}
          </h2>
          <p>{t('settings.help.shortcuts.tabStartsSkip')}</p>
          <p>{t('settings.help.shortcuts.enterEditsSheet')}</p>
          <p>{t('settings.help.shortcuts.overlaysTakeFocus')}</p>
        </section>
      </div>
      <aside
        aria-label={t('settings.help.shortcuts.aboutReleaseAria')}
        className="flex flex-col gap-4 lg:sticky lg:top-5 lg:self-start"
      >
        <section className="flex flex-col gap-1.5 rounded-md border border-border p-3.5 text-label leading-[18px]">
          <h2 className="font-sans text-label font-semibold">
            {t('settings.help.shortcuts.alsoUseful')}
          </h2>
          <Link to="/help/records">
            {t('settings.help.shortcuts.howRecordsReviews')}
          </Link>
          <Link to="/help">{t('settings.help.shortcuts.helpCentre')}</Link>
        </section>
        <ReleaseCard />
      </aside>
    </div>
  )
}
