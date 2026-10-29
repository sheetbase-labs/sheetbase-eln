import { Link } from '@tanstack/react-router'
import { Button } from '#/components/v3/ui/button'
import { Notice } from '#/components/v3/ui/alert'
import type { ParserFollowUp } from './instruments-data'
import { t } from '#/copy'

const COPY: Record<
  ParserFollowUp['kind'],
  { title: string; body: (instrumentName: string) => string; action: string }
> = {
  missing: {
    title: t('library.instruments.parserFollowUp.noParserYet'),
    body: (instrumentName) =>
      t('library.instruments.parserFollowUp.cantImportIntoAGxp', {
        instrumentName,
      }),
    action: t('library.instruments.parserFollowUp.addAParser'),
  },
  draft: {
    title: t('library.instruments.parserFollowUp.parserNotValidated'),
    body: (instrumentName) =>
      t('library.instruments.parserFollowUp.hasADraftParserThat', {
        instrumentName,
      }),
    action: t('library.instruments.parserFollowUp.validateTheParser'),
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
          {copy.body(instrumentName)}
          {canEdit
            ? ''
            : t('library.instruments.parserFollowUp.askAWorkspaceAdminOr')}
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
