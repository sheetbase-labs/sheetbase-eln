import { useRef, useState } from 'react'

import { Button } from '#/components/ui/button'
import { Notice } from '#/components/ui/alert'
import { Section } from '#/components/ui/layout'
import { toast } from '#/components/ui/sonner'
import { useLabLogoVersion } from '#/components/ui/lab-logo'
import { labLogoUrl } from '#/lib/lab-logo'
import { requestShellRefresh } from '#/lib/shell-refresh'
import { t } from '#/copy'

const MAX_BYTES = 1024 * 1024
const ACCEPTED = ['image/png', 'image/jpeg']

/**
 * The lab's logo (Workspace > General). It saves as soon as it's chosen, apart
 * from the page's Save button, and appears on printouts, PDF reports, client
 * portal pages and the sign-in page.
 */
export function LabLogoSettings({ canEdit = true }: { canEdit?: boolean }) {
  const contextVersion = useLabLogoVersion()
  // What this page just did shows at once; the shell catches up behind it.
  const [changed, setChanged] = useState<string | null | undefined>(undefined)
  const version = changed === undefined ? contextVersion : changed
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function send(method: 'PUT' | 'DELETE', file?: File) {
    setBusy(true)
    setError(null)

    try {
      const response = await fetch('/api/workspace-logo', {
        method,
        body: file,
        credentials: 'same-origin',
      })

      if (!response.ok) {
        setError(
          response.status === 413
            ? t('account.logo.tooLarge')
            : response.status === 415
              ? t('account.logo.wrongType')
              : response.status === 403 || response.status === 401
                ? t('account.logo.notAllowed')
                : t('account.logo.couldNotSave'),
        )

        return
      }

      setChanged(method === 'PUT' ? String(Date.now()) : null)
      // The pages that show the logo read its version from the shell.
      requestShellRefresh()
      toast(
        method === 'PUT'
          ? t('account.logo.uploadedToast')
          : t('account.logo.removedToast'),
      )
    } catch {
      setError(t('account.logo.couldNotSave'))
    } finally {
      setBusy(false)
    }
  }

  function choose(file: File | undefined) {
    if (!file) return

    if (!ACCEPTED.includes(file.type))
      return setError(t('account.logo.wrongType'))

    if (file.size > MAX_BYTES) return setError(t('account.logo.tooLarge'))
    void send('PUT', file)
  }

  return (
    <Section title={t('account.logo.title')}>
      <p className="m-0 max-w-2xl text-body text-fg-muted">
        {t('account.logo.description')}
      </p>
      {error ? <Notice tone="bad">{error}</Notice> : null}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex h-16 min-w-32 items-center justify-center rounded-md border border-border bg-surface-muted px-3">
          {version ? (
            <img
              src={labLogoUrl(version)}
              alt={t('account.logo.previewAlt')}
              className="max-h-12 w-auto max-w-[200px] object-contain"
            />
          ) : (
            <span className="text-label text-fg-muted">
              {t('account.logo.none')}
            </span>
          )}
        </div>
        {canEdit ? (
          <div className="flex items-center gap-2">
            <input
              ref={input}
              type="file"
              accept={ACCEPTED.join(',')}
              className="sr-only"
              aria-label={t('account.logo.upload')}
              onChange={(event) => {
                choose(event.target.files?.[0])
                event.target.value = ''
              }}
            />
            <Button disabled={busy} onClick={() => input.current?.click()}>
              {busy
                ? t('account.logo.uploading')
                : version
                  ? t('account.logo.replace')
                  : t('account.logo.upload')}
            </Button>
            {version ? (
              <Button
                variant="quiet"
                disabled={busy}
                onClick={() => void send('DELETE')}
              >
                {t('account.logo.remove')}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </Section>
  )
}
