import { useEffect, useRef, useState } from 'react'

import { Button } from '#/components/v3/ui/button'
import { Field } from '#/components/v3/ui/input'
import { Textarea } from '#/components/v3/inventory/list'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { registerChangeReasonAsker } from '#/lib/change-reason'
import { t } from '#/copy'

/**
 * Asks why a saved value is changing, for workspaces that require a reason.
 * Mounted once at the root: the data client opens it when the database refuses
 * a write for want of a reason, and sends the write again with the answer.
 */
export function ChangeReasonDialog() {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const resolver = useRef<((reason: string | null) => void) | null>(null)

  useEffect(() => {
    registerChangeReasonAsker(
      () =>
        new Promise<string | null>((resolve) => {
          resolver.current = resolve
          setReason('')
          setOpen(true)
        }),
    )
    return () => registerChangeReasonAsker(null)
  }, [])

  function settle(answer: string | null) {
    resolver.current?.(answer)
    resolver.current = null
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && settle(null)}>
      <DialogContent className="w-[min(480px,calc(100vw-32px))]">
        <DialogHeader
          title={t('settings.changeReason.title')}
          description={t('settings.changeReason.description')}
        />
        <DialogBody>
          <Field label={t('settings.changeReason.label')}>
            <Textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              aria-label={t('settings.changeReason.label')}
              aria-required="true"
              placeholder={t('settings.changeReason.placeholder')}
              maxLength={2000}
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button onClick={() => settle(null)}>
            {t('common.actions.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={!reason.trim()}
            onClick={() => settle(reason.trim())}
          >
            {t('settings.changeReason.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
