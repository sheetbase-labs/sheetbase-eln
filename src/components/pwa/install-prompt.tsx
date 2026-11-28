import { useEffect } from 'react'
import { Button } from '#/components/ui/button'
import { IconButton } from '#/components/ui/icon-button'
import { Icon } from '#/components/icons'
import {
  dismissInstallOffer,
  markInstallOfferShown,
  promptInstall,
  useInstallOffer,
} from '#/lib/pwa/install'
import { t } from '#/copy'

/**
 * Offers to install Sheetbase as an app, in one slim line. On Chrome and Edge
 * it triggers the browser's install dialog; on iPhone and iPad, which have no
 * such dialog, it says where Add to Home Screen is. It shows for one visit
 * (see `noteInstallOfferShown`), never once installed, and "Not now" hides it
 * at once.
 */
export function InstallPrompt() {
  const offer = useInstallOffer()

  useEffect(() => {
    if (offer !== 'none') markInstallOfferShown()
  }, [offer])

  if (offer === 'none') return null
  const ios = offer === 'ios'

  return (
    <aside
      aria-label={t('pwa.install.title')}
      data-testid="install-prompt"
      className="flex min-h-9 items-center gap-2 border-b border-border bg-surface-muted py-0.5 pl-4 pr-1 text-label max-md:pt-[max(0.125rem,env(safe-area-inset-top))]"
    >
      <Icon
        name={ios ? 'share' : 'download'}
        size={14}
        className="shrink-0 text-fg-muted"
      />
      <span className="min-w-0 flex-1 truncate">
        {ios ? t('pwa.install.ios.short') : t('pwa.install.short')}
      </span>
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
        className="max-md:size-9"
      />
    </aside>
  )
}
