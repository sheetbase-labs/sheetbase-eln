import { ObjectLink } from '#/components/ui/object-link'
import type { RecordLinkLabels } from '#/lib/record-link-labels'
import { linkedRecordIds, recordLinkObjectKind } from '#/lib/record-link-labels'
import { FILE_MODEL_KEY } from '#/lib/file-field'

/**
 * A link column's value: the linked record's identifier, as a link that opens
 * the record (Space peeks, Alt-click opens beside). An id the lookup has not
 * returned yet, or one this person cannot see, stays an unlinked "—" rather
 * than showing a raw UUID. A file shows its name.
 */
export function RecordLinkValue({
  value,
  labels,
}: {
  value: unknown
  labels: RecordLinkLabels
}) {
  const linked = linkedRecordIds([value])

  if (linked.length === 0) return <>—</>

  return (
    <span className="inline-flex flex-wrap gap-x-2">
      {linked.map((id) => {
        const label = labels[id]

        // A file reads by its name, the way people know it.
        return label?.kind === FILE_MODEL_KEY ? (
          <ObjectLink
            key={id}
            kind={recordLinkObjectKind(label.kind)}
            id={id}
            identifier={label.identifier}
            mono={false}
          >
            {label.title}
          </ObjectLink>
        ) : label ? (
          <ObjectLink
            key={id}
            kind={recordLinkObjectKind(label.kind)}
            id={id}
            identifier={label.identifier}
          />
        ) : (
          <span key={id} className="text-fg-muted">
            —
          </span>
        )
      })}
    </span>
  )
}
