import { Icon } from '#/components/icons'
import type { IconName } from '#/components/icons'
import { Spinner } from '#/components/ui/spinner'
import { t } from '#/copy'
import type { AttachmentRef } from '#/lib/assistant-attachments'
import { cn } from '#/lib/utils'

const KIND_ICON: Record<AttachmentRef['kind'], IconName> = {
  image: 'image',
  table: 'table',
  document: 'fileText',
}

/**
 * The files in a message or waiting in the box: a small pill each, with its
 * kind and name. Waiting files can be removed; a sent message's cannot.
 */
export function AttachmentChips({
  files,
  reading = [],
  onRemove,
  className,
}: {
  files: AttachmentRef[]
  reading?: string[]
  onRemove?: (id: string) => void
  className?: string
}) {
  if (files.length === 0 && reading.length === 0) return null

  return (
    <ul
      aria-label={t('features.labFiles.attach.attached')}
      className={cn('m-0 flex list-none flex-wrap gap-1.5 p-0', className)}
      data-testid="assistant-attachments"
    >
      {files.map((file) => (
        <li
          key={file.id}
          className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-lg border border-border bg-surface-muted pr-1 pl-2 text-label text-fg"
        >
          <Icon
            name={KIND_ICON[file.kind]}
            size={14}
            className="shrink-0 text-fg-muted"
          />
          <span className="max-w-[12rem] truncate" title={file.name}>
            {file.name}
          </span>
          {onRemove ? (
            <button
              type="button"
              onClick={() => onRemove(file.id)}
              aria-label={t('features.labFiles.attach.remove', {
                name: file.name,
              })}
              className="inline-flex size-5 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-fg-muted hover:bg-surface-hover hover:text-fg"
            >
              <Icon name="x" size={12} />
            </button>
          ) : (
            <span className="pr-1" />
          )}
        </li>
      ))}
      {reading.map((name) => (
        <li
          key={`reading:${name}`}
          className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-lg border border-border bg-surface-muted px-2 text-label text-fg-muted"
        >
          <Spinner size={12} />
          <span className="max-w-[12rem] truncate">
            {t('features.labFiles.attach.reading', { name })}
          </span>
        </li>
      ))}
    </ul>
  )
}
