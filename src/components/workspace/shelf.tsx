import { Icon } from '#/components/v3/icons'
import { paneKind } from '#/lib/workspace-state'
import type { ShelfItem } from '#/lib/workspace-state'

/**
 * Records kept for later. Nothing on the shelf is open or editable; promoting
 * a card opens it as a pane beside the focused one.
 */
export function Shelf({
  items,
  dropActive,
  onPromote,
  onRemove,
  onClose,
  onDropLink,
}: {
  items: ShelfItem[]
  dropActive: boolean
  onPromote: (id: string) => void
  onRemove: (id: string) => void
  onClose: () => void
  onDropLink: (href: string) => void
}) {
  return (
    <aside
      className="mx-shelf"
      aria-label="Shelf"
      data-workspace-shelf
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('application/x-sheetbase-link')) {
          event.preventDefault()
        }
      }}
      onDrop={(event) => {
        const href = event.dataTransfer.getData('application/x-sheetbase-link')
        if (!href) return
        event.preventDefault()
        onDropLink(href)
      }}
    >
      <div className="mx-shelf-h">
        <b>Shelf</b>
        <span className="text-fg-muted">· {items.length}</span>
        <span className="mx-sp" />
        <button
          type="button"
          className="mx-act"
          aria-label="Hide the shelf"
          onClick={onClose}
        >
          <Icon name="x" size={14} />
        </button>
      </div>
      <div className="mx-shelf-l">
        {items.map((item) => {
          const kind = paneKind(item.href)
          return (
            <div key={item.id} className="mx-card" data-shelf-card>
              <div className="mx-card-h">
                <span className="mx-type">
                  <Icon name={kind.icon} size={16} />
                </span>
                {item.identifier ? (
                  <span className="mx-id">{item.identifier}</span>
                ) : null}
                <span className="mx-title">{item.title}</span>
                <span className="mx-sp" />
                <button
                  type="button"
                  className="mx-act"
                  aria-label={`Remove ${item.title} from the shelf`}
                  onClick={() => onRemove(item.id)}
                >
                  <Icon name="x" size={12} />
                </button>
              </div>
              <div className="mx-card-f">
                {item.from ? (
                  <span>From {item.from}</span>
                ) : (
                  <span>{kind.label}</span>
                )}
                <button type="button" onClick={() => onPromote(item.id)}>
                  Promote to pane
                </button>
              </div>
            </div>
          )
        })}
      </div>
      <div className={dropActive ? 'mx-shelf-drop is-active' : 'mx-shelf-drop'}>
        Drag a link here to keep it
      </div>
    </aside>
  )
}
