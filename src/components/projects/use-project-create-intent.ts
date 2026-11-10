import { useEffect, useRef, useState } from 'react'

/**
 * The New project dialog's open state, and the two ways the URL changes it.
 *
 * A create intent arrives from the URL (`?new=true`: the shell's New → Project
 * link, a refresh, a bookmark) or from the page's own button. Once one has
 * arrived the dialog's open state is local: a click's client navigation can be
 * superseded while the page is still loading — the URL commits `?new=true` and
 * the page's search never carries it, leaving the button apparently dead — and
 * a close must close whatever the URL holds.
 *
 * A create that lands ends the intent: the route clears `?new=true` and
 * invalidates the list, but that navigation cannot close a dialog whose open
 * state is local, so the created project itself is the signal.
 *
 * What happens when the role cannot honour the intent is the page's effect
 * (`projects-page.tsx`): it answers the intent rather than owning this state.
 */
export function useProjectCreateIntent({
  canCreate,
  requested,
  createdProjectId,
  setSearch,
}: {
  canCreate: boolean
  requested: boolean | undefined
  createdProjectId: string | null
  setSearch: (patch: { new?: boolean }) => void
}) {
  const [open, setOpen] = useState(canCreate && !!requested)

  const requestedNow = canCreate && !!requested
  const lastRequested = useRef(requestedNow)

  useEffect(() => {
    if (requestedNow && !lastRequested.current) {
      // react-doctor-disable-next-line react-doctor/no-adjust-state-on-prop-change -- `?new=true` is a one-shot command from the shell's New menu, not a mirrored prop: it opens this dialog once on arrival and is then dropped.
      setOpen(true)
    }

    lastRequested.current = requestedNow
  }, [requestedNow])

  // A create that lands ends the intent. The route clears `?new=true` and
  // invalidates the list, but that navigation cannot close a dialog whose open
  // state is local, so the created project itself is the signal: without this
  // the dialog stays up over the list after the write is already done.
  useEffect(() => {
    // react-doctor-disable-next-line react-doctor/no-adjust-state-on-prop-change -- The cleared `?new=true` cannot close a dialog whose open state is local, so the landed project is the signal that the create finished.
    if (createdProjectId) setOpen(false)
  }, [createdProjectId])

  return {
    open,
    /** Close from the page: the dialog's own state, then the URL's. */
    close: () => {
      setOpen(false)

      if (requested) setSearch({ new: undefined })
    },
    request: () => {
      setOpen(true)
      setSearch({ new: true })
    },
  }
}
