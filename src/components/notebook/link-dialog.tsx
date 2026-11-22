import { useState } from 'react'

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
import { t } from '#/copy'

/**
 * Asks for a link's address. It replaces the browser's `window.prompt`, which
 * blocked the tab and ignored the theme. Enter in the field presses the
 * primary button (the shared Dialog does that), and the editor keeps its
 * selection while this is open, so the link lands on the words that were
 * selected.
 */
export function LinkDialog({
  onSubmit,
  onClose,
}: {
  onSubmit: (href: string) => void
  onClose: () => void
}) {
  const [href, setHref] = useState('https://')
  const address = href.trim()

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(440px,calc(100vw-32px))]">
        <DialogHeader title={t('notebook.richTextEditor.addLink')} />
        <DialogBody>
          <Field label={t('notebook.richTextEditor.linkUrl')}>
            <Input
              autoFocus
              inputMode="url"
              type="url"
              value={href}
              onChange={(event) => setHref(event.target.value)}
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={!address || address === 'https://'}
            onClick={() => {
              onSubmit(address)
              onClose()
            }}
          >
            {t('notebook.richTextEditor.addLink')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
