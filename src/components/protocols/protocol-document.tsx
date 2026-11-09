import { isRichTextPayload, RichTextContent } from '#/lib/blocks/rich-text'
import type { NotebookBlock } from '#/lib/notebook-data'
import { Muted } from '../ui/layout'
import { t } from '#/copy'
import { Icon } from '#/components/icons'
import { formatDuration, stepDurationSeconds } from '#/lib/step-timers'

/** Render canonical document payloads without flattening scientific notation. */
export function ProtocolDocument({
  blocks,
}: {
  blocks: Pick<NotebookBlock, 'id' | 'type' | 'payload'>[]
}) {
  const document = blocks.filter(
    (block) => block.type === 'rich_text' || block.type === 'procedure_step',
  )

  if (document.length === 0) {
    return (
      <Muted>
        {t('library.protocols.protocolDocument.thisProtocolHasNoDocument')}
      </Muted>
    )
  }

  return (
    <article
      aria-label={t('library.protocols.protocolDocument.protocolDocument')}
      className="flex flex-col gap-4"
    >
      {document.map((block) => {
        if (block.type === 'rich_text') {
          return isRichTextPayload(block.payload) ? (
            <RichTextContent
              key={block.id}
              payload={block.payload}
              anchorPrefix={block.id}
            />
          ) : (
            <p key={block.id} role="alert">
              {t(
                'library.protocols.protocolDocument.thisDocumentBlockCouldNot',
              )}
            </p>
          )
        }

        const { text, stepNumber } = block.payload
        const durationSeconds = stepDurationSeconds(block.payload)

        if (typeof text !== 'string' || typeof stepNumber !== 'number') {
          return (
            <p key={block.id} role="alert">
              {t(
                'library.protocols.protocolDocument.thisProcedureStepCouldNot',
              )}
            </p>
          )
        }

        return (
          <div
            key={block.id}
            className="flex items-start gap-3"
            data-step-block-id={block.id}
          >
            <span className="num shrink-0 text-fg-muted">{stepNumber}.</span>
            <div className="min-w-0">
              <p className="m-0 whitespace-pre-wrap text-body">{text}</p>
              {durationSeconds !== null ? (
                <p className="m-0 mt-1 inline-flex items-center gap-1.5 text-label text-fg-muted">
                  <Icon name="clock" size={12} />
                  {t('notebook.stepTimers.runsFor', {
                    length: formatDuration(durationSeconds),
                  })}
                </p>
              ) : null}
            </div>
          </div>
        )
      })}
    </article>
  )
}
