import { Notice } from '#/components/v3/ui/alert'

/**
 * A read that succeeded and found nothing. It cannot tell a wrong link from a
 * record the person may not see, so it says both and names who can resolve it.
 * A failed read is a different state: use `ProjectListFailure`, which offers a
 * retry.
 */
export function NotFoundNotice({
  what,
  action,
}: {
  /** Lower-case noun, e.g. "pipeline". */
  what: string
  /** Where to go instead, e.g. a "Back to Pipelines" button. */
  action?: React.ReactNode
}) {
  return (
    <Notice
      tone="info"
      icon="info"
      title={`This ${what} was not found.`}
      action={action}
    >
      The link may be wrong, or the {what} was deleted, or it is not shared with
      you. Ask whoever sent you the link, or a workspace owner or admin, for
      access.
    </Notice>
  )
}
