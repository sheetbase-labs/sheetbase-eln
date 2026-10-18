import { Link } from '@tanstack/react-router'
import { Button } from '#/components/v3/ui/button'
import { Notice } from '#/components/v3/ui/alert'
import type { ParserFollowUp } from './instruments-data'

const COPY: Record<
  ParserFollowUp['kind'],
  { title: string; body: string; action: string }
> = {
  missing: {
    title: 'No parser yet.',
    body: 'can’t import into a GxP dataset until a parser is added and tested against a real export from it.',
    action: 'Add a parser',
  },
  draft: {
    title: 'Parser not validated.',
    body: 'has a draft parser that hasn’t been tested. Readings can’t be imported into a GxP dataset until it passes validation against a retained file.',
    action: 'Validate the parser',
  },
}

/**
 * The warning for an automated instrument that can't import yet, and the one step that
 * moves it forward. Without edit rights the next step is a person, not a button.
 */
export function ParserFollowUpNotice({
  instrumentName,
  followUp,
  canEdit,
}: {
  instrumentName: string
  followUp: ParserFollowUp
  canEdit: boolean
}) {
  const copy = COPY[followUp.kind]
  return (
    <Notice tone="warn" title={copy.title}>
      <div className="flex flex-col items-start gap-2">
        <span>
          Readings from {instrumentName} {copy.body}
          {canEdit
            ? ''
            : ' Ask a workspace admin or schema editor to set this up.'}
        </span>
        {canEdit ? (
          <Button
            size="sm"
            nativeButton={false}
            render={
              <Link to="/settings/instruments" search={followUp.search} />
            }
          >
            {copy.action}
          </Button>
        ) : null}
      </div>
    </Notice>
  )
}
