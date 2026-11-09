import { Button } from '#/components/ui/button'
import { IconButton } from '#/components/ui/icon-button'
import { Icon } from '#/components/icons'
import {
  dismissInstallOffer,
  promptInstall,
  useInstallOffer,
} from '#/lib/pwa/install'
import { t } from '#/copy'

/**
 * Offers to install Sheetbase as an app. On Chrome and Edge it triggers the
 * browser's install dialog; on iPhone and iPad, which have no such dialog, it
 * points at Share > Add to Home Screen. Nothing shows once installed, and
 * "Not now" is remembered for a month.
 */
export function InstallPrompt() {
  const offer = useInstallOffer()

  if (offer === 'none') return null
  const ios = offer === 'ios'

  return (
    <aside
      aria-label={t('pwa.install.title')}
      data-testid="install-prompt"
      className="flex items-center gap-3 border-b border-border bg-surface-muted px-4 py-2 text-label max-md:pt-[max(0.5rem,env(safe-area-inset-top))]"
    >
      <Icon name={ios ? 'share' : 'download'} size={16} />
      <div className="min-w-0 flex-1">
        <span className="block font-semibold">
          {ios ? t('pwa.install.ios.title') : t('pwa.install.title')}
        </span>
        <span className="text-fg-muted">
          {ios ? t('pwa.install.ios.body') : t('pwa.install.body')}
        </span>
      </div>
      {ios ? null : (
        <Button
          size="sm"
          variant="primary"
          onClick={() => void promptInstall()}
        >
          {t('pwa.install.action')}
        </Button>
      )}
      <IconButton
        icon="x"
        label={t('pwa.install.notNow')}
        onClick={dismissInstallOffer}
      />
    </aside>
  )
}
