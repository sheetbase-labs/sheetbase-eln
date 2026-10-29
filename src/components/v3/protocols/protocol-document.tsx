import { isRichTextPayload, RichTextContent } from '#/lib/blocks/rich-text'
import type { NotebookBlock } from '#/lib/notebook-data'
import { Muted } from '../ui/layout'
import { t } from '#/copy'

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
            <p className="m-0 whitespace-pre-wrap text-body">{text}</p>
          </div>
        )
      })}
    </article>
  )
}
