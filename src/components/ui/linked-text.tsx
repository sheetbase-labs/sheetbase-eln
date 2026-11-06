import { ObjectLink } from '#/components/ui/object-link'
import { splitRefs, useRecordRef } from '#/lib/record-refs'

function Ref({ identifier }: { identifier: string }) {
  const kind = useRecordRef(identifier)
  if (!kind) return <>{identifier}</>
  return <ObjectLink kind={kind} identifier={identifier} />
}

/**
 * Text in which every identifier that names a real record is a link, with
 * peek and Alt-click like any other. The rest is left exactly as written.
 */
export function LinkedText({ text }: { text: string }) {
  return (
    <>
      {splitRefs(text).map((part, index) =>
        part.ref ? (
          <Ref key={`${index}-${part.text}`} identifier={part.text} />
        ) : (
          part.text
        ),
      )}
    </>
  )
}
