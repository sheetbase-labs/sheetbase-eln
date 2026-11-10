import * as React from 'react'

import { t } from '#/copy'
import { Button } from '#/components/ui/button'
import { Icon } from '#/components/icons'

/**
 * The inspector's stable identity header: what the panel is showing (record type
 * and title), the semantic status beside it, and the close control. It stays
 * visible while the tab content below it scrolls.
 */
export function InspectorHeader({
  recordType,
  title,
  status,
  onClose,
}: {
  recordType?: string
  title: string
  status?: React.ReactNode
  onClose?: () => void
}) {
  return (
    <div className="shrink-0 border-b border-border px-5 py-4">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="break-words text-base font-semibold leading-snug text-fg">
            {title}
          </h2>
          {recordType || status ? (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-fg-muted">
              {recordType ? <span>{recordType}</span> : null}
              {status}
            </div>
          ) : null}
        </div>
        {onClose ? (
          <Button
            variant="quiet"
            size="icon"
            className="mt-0.5 shrink-0"
            aria-label={t('notebook.inspector.closeInspectorAriaLabel')}
            onClick={onClose}
          >
            <Icon name="x" size={16} />
          </Button>
        ) : null}
      </div>
    </div>
  )
}
