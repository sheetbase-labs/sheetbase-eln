/**
 * DATA-02 export menu. A small dropdown that triggers server-side streaming
 * downloads from the canonical export endpoints. Session cookies authenticate
 * the GET, so plain anchor navigation is sufficient — no fetch/credentials
 * plumbing in the client.
 */
import { useState } from 'react'

import { t } from '#/copy'
import { Button } from '#/components/v3/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/v3/ui/dropdown-menu'

export interface ExportOption {
  format: string
  label: string
}

const COMMON_FORMATS: ExportOption[] = [
  { format: 'csv', label: t('data.exportMenu.csv') },
  { format: 'tsv', label: t('data.exportMenu.tsv') },
  { format: 'json', label: t('data.exportMenu.jsonMetadata') },
  { format: 'ndjson', label: t('data.exportMenu.ndjsonRowPerLine') },
  { format: 'xlsx', label: t('data.exportMenu.xlsx') },
  { format: 'parquet', label: t('data.exportMenu.parquet') },
]

interface ExportMenuProps {
  /** Endpoint path without query string, e.g. /api/export/dataset/<id>. */
  path: string
  /** Restrict the offered formats (defaults to all tabular formats). */
  formats?: ExportOption[]
  /** Optional extra entries such as evidence packages. */
  extraItems?: ExportOption[]
  label?: string
}

export function ExportMenu({
  path,
  formats = COMMON_FORMATS,
  extraItems = [],
  label = t('common.actions.export'),
}: ExportMenuProps) {
  const [busy, setBusy] = useState(false)

  function download(format: string): void {
    setBusy(true)
    // Navigation triggers a download via content-disposition; the page stays.
    const frame = document.createElement('iframe')
    frame.style.display = 'none'
    frame.src = `${path}?format=${encodeURIComponent(format)}`
    frame.addEventListener('load', () => setBusy(false))
    document.body.appendChild(frame)
    window.setTimeout(() => {
      frame.remove()
      setBusy(false)
    }, 30_000)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            icon="download"
          />
        }
      >
        {busy ? t('data.exportMenu.exporting') : label}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {/* The label has to live inside a group: Base UI's MenuGroupLabel reads
            MenuGroupContext and throws without it, which takes the page down. */}
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            {t('data.exportMenu.downloadAs')}
          </DropdownMenuLabel>
          {formats.map((option) => (
            <DropdownMenuItem
              key={option.format}
              onClick={() => download(option.format)}
            >
              {option.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        {extraItems.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            {extraItems.map((item) => (
              <DropdownMenuItem
                key={item.format}
                onClick={() => download(item.format)}
              >
                {item.label}
              </DropdownMenuItem>
            ))}
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
