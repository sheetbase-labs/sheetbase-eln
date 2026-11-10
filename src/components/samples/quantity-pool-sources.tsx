import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { ObjectLink } from '#/components/ui/object-link'
import { t } from '#/copy'
import { formatQuantityAmount } from './quantity-input'
import type { PoolRow } from './quantity-plans'

export function PoolSources({
  rows,
  onTake,
  onRemove,
  onAdd,
}: {
  rows: PoolRow[]
  onTake: (id: string, take: string) => void
  onRemove: (id: string) => void
  onAdd: () => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-label font-medium text-fg">
        {t('library.samples.poolDialog.samples')}
      </span>
      <ul className="m-0 flex list-none flex-col divide-y divide-border-subtle rounded-md border border-border-subtle p-0">
        {rows.map((row, index) => (
          <li
            key={row.id}
            className="flex items-center gap-3 px-3 py-2 text-body"
          >
            <ObjectLink
              kind="sample"
              id={row.id}
              identifier={row.identifier}
              className="w-24 shrink-0"
            />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate">{row.title}</span>
              {row.free != null ? (
                <span className="num text-label text-fg-muted">
                  {t('library.samples.poolDialog.free', {
                    free: formatQuantityAmount(row.free),
                    value: row.unit ? ` ${row.unit}` : '',
                  })}
                </span>
              ) : null}
            </span>
            <Input
              inputMode="decimal"
              className="w-24"
              value={row.take}
              aria-label={t('library.samples.poolDialog.takeAria', {
                identifier: row.identifier,
              })}
              autoFocus={index === 0}
              onChange={(event) => onTake(row.id, event.target.value)}
            />
            <span className="num w-9 shrink-0 text-label text-fg-muted">
              {row.unit ?? ''}
            </span>
            {index > 0 ? (
              <Button
                variant="quiet"
                size="icon"
                icon="x"
                aria-label={t('library.samples.poolDialog.remove', {
                  identifier: row.identifier,
                })}
                onClick={() => onRemove(row.id)}
              />
            ) : (
              <span className="size-7 shrink-0" aria-hidden />
            )}
          </li>
        ))}
      </ul>
      <div>
        <Button icon="plus" onClick={onAdd}>
          {t('library.samples.poolDialog.addSamples')}
        </Button>
      </div>
    </div>
  )
}
