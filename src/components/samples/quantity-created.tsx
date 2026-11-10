import { Button } from '#/components/ui/button'
import {
  DialogBody,
  DialogClose,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { ObjectLink } from '#/components/ui/object-link'
import type { PoolSamplesResult, SampleRecord } from '#/lib/samples'
import { t } from '#/copy'
import { formatQuantityAmount } from './quantity-input'

function QuantityRecord({ record }: { record: SampleRecord }) {
  return (
    <>
      <ObjectLink
        kind="sample"
        id={record.id}
        identifier={record.identifier}
        className="w-24 shrink-0"
      />
      <span className="min-w-0 truncate">{record.title}</span>
      <span className="num ml-auto text-fg-muted">
        {record.quantity != null
          ? `${formatQuantityAmount(record.quantity)}${record.quantityUnit ? ` ${record.quantityUnit}` : ''}`
          : ''}
      </span>
    </>
  )
}

export function AliquotCreated({
  created,
  identifier,
  onPrint,
}: {
  created: SampleRecord[]
  identifier: string
  onPrint: () => void
}) {
  return (
    <>
      <DialogHeader
        title={t('library.samples.aliquotDialog.madeTubesFrom', {
          count: created.length,
          identifier,
        })}
      />
      <DialogBody>
        <ul
          aria-label={t('library.samples.aliquotDialog.newTubes')}
          className="m-0 flex max-h-[40vh] list-none flex-col gap-1 overflow-auto p-0"
        >
          {created.map((tube) => (
            <li key={tube.id} className="flex gap-3 text-body">
              <QuantityRecord record={tube} />
            </li>
          ))}
        </ul>
      </DialogBody>
      <DialogFooter>
        <DialogClose render={<Button />}>
          {t('common.actions.done')}
        </DialogClose>
        <Button variant="primary" onClick={onPrint}>
          {t('library.samples.aliquotDialog.printLabels', {
            count: created.length,
          })}
        </Button>
      </DialogFooter>
    </>
  )
}

export function PoolCreated({
  created,
  onPrint,
}: {
  created: PoolSamplesResult
  onPrint: () => void
}) {
  return (
    <>
      <DialogHeader
        title={t('library.samples.poolDialog.madePool', {
          identifier: created.pool.identifier,
        })}
        description={t('library.samples.poolDialog.madeFrom', {
          identifiers: created.sources
            .map((source) => source.identifier)
            .join(', '),
        })}
      />
      <DialogBody>
        <div className="flex gap-3 text-body">
          <QuantityRecord record={created.pool} />
        </div>
      </DialogBody>
      <DialogFooter>
        <DialogClose render={<Button />}>
          {t('common.actions.done')}
        </DialogClose>
        <Button variant="primary" onClick={onPrint}>
          {t('library.samples.poolDialog.printLabel')}
        </Button>
      </DialogFooter>
    </>
  )
}
