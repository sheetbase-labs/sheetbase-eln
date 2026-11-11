/**
 * What a sheet definition version declares: the inputs it asks for, the
 * columns it stores, the calculations it runs, and the whole configuration for
 * inspection. Read-only; publishing is the header's action.
 */
import type { UseQueryResult } from '@tanstack/react-query'

import { Notice } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { Section } from '#/components/ui/layout'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import type {
  SheetDefinition,
  SheetDefinitionVersion,
} from '#/lib/sheet-definition-data'
import { t } from '#/copy'

export function SheetDefinitionVersionPanels({
  version,
  publishError,
  publishPending,
  publishSucceeded,
}: {
  version: SheetDefinitionVersion
  publishError: string | null
  publishPending: boolean
  publishSucceeded: boolean
}) {
  return (
    <>
      <Notice
        title={t('notebook.sheetDefinitionPage.reusableSheetStructureNotTitle')}
      >
        {t('notebook.sheetDefinitionPage.reviewTheInputsBindings')}
      </Notice>
      <Section
        title={t('notebook.sheetDefinitionPage.inputsTitle')}
        count={version.configuration.parameters.length}
      >
        {version.configuration.parameters.length ? (
          <TableBox>
            <Table caption={t('notebook.sheetDefinitionPage.caption')}>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">
                    {t('notebook.sheetDefinitionPage.input')}
                  </TableHead>
                  <TableHead scope="col">
                    {t('notebook.sheetDefinitionPage.type')}
                  </TableHead>
                  <TableHead scope="col">
                    {t('notebook.sheetDefinitionPage.requirement')}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {version.configuration.parameters.map((parameter) => (
                  <TableRow key={parameter.id}>
                    <TableCell className="whitespace-normal break-words font-medium">
                      {parameter.label}
                    </TableCell>
                    <TableCell>{parameter.type.kind}</TableCell>
                    <TableCell>
                      {parameter.required
                        ? t('common.states.required')
                        : t('common.states.optional')}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableBox>
        ) : (
          <p className="m-0 text-body text-fg-muted">
            {t('notebook.sheetDefinitionPage.noParameters')}
          </p>
        )}
      </Section>
      <Section
        title={t('notebook.sheetDefinitionPage.columnsTitle')}
        count={version.configuration.columns.length}
      >
        <TableBox>
          <Table caption={t('notebook.sheetDefinitionPage.caption2')}>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">
                  {t('notebook.sheetDefinitionPage.column')}
                </TableHead>
                <TableHead scope="col">
                  {t('notebook.sheetDefinitionPage.type')}
                </TableHead>
                <TableHead scope="col">
                  {t('notebook.sheetDefinitionPage.storageUnit')}
                </TableHead>
                <TableHead scope="col">
                  {t('notebook.sheetDefinitionPage.source')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody
              empty={t('notebook.sheetDefinitionPage.noColumns')}
              colSpan={4}
            >
              {version.configuration.columns.map(({ id, field, source }) => (
                <TableRow key={id}>
                  <TableCell className="whitespace-normal break-words font-medium">
                    {field.label}
                  </TableCell>
                  <TableCell>{field.logicalType}</TableCell>
                  <TableCell>{field.quantity?.storageUnit ?? '—'}</TableCell>
                  <TableCell>{source.kind}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableBox>
      </Section>
      <Section
        title={t('notebook.sheetDefinitionPage.calculationsTitle')}
        count={version.configuration.calculations.length}
      >
        {version.configuration.calculations.length ? (
          <dl className="m-0 divide-y divide-border-subtle text-body">
            {version.configuration.calculations.map((calculation) => (
              <div
                key={calculation.id}
                className="flex flex-wrap gap-x-4 gap-y-1 py-2"
              >
                <dt className="font-medium">{calculation.label}</dt>
                <dd className="m-0 min-w-0 flex-1 basis-60">
                  <code className="whitespace-pre-wrap break-words">
                    {calculation.expression.source}
                  </code>
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="m-0 text-body text-fg-muted">
            {t('notebook.sheetDefinitionPage.noCalculations')}
          </p>
        )}
      </Section>
      <details className="min-w-0 border-t border-border pt-3">
        <summary className="cursor-pointer rounded-sm py-1 text-label font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
          {t('notebook.sheetDefinitionPage.inspectCompleteConfiguration')}
        </summary>
        <pre className="max-h-[500px] overflow-auto rounded-md border border-border bg-surface-muted p-3 text-caption">
          {JSON.stringify(version.configuration, null, 2)}
        </pre>
      </details>
      {publishError ? (
        <Notice
          tone="bad"
          title={t('notebook.sheetDefinitionPage.couldNotPublishTitle')}
        >
          {publishError}
        </Notice>
      ) : null}
      {publishSucceeded && !publishPending ? (
        <Notice title={t('notebook.sheetDefinitionPage.versionPublishedTitle')}>
          {t('notebook.sheetDefinitionPage.thisVersionIsNow')}
        </Notice>
      ) : null}
    </>
  )
}

/**
 * What the page's body says in each state: loading, a read that failed, a
 * definition that is not there, the version being read, or a requested version
 * that no longer exists.
 */
export function SheetDefinitionBody({
  definition,
  versions,
  version,
  publishError,
  publishPending,
  publishSucceeded,
  onRetry,
}: {
  definition: UseQueryResult<SheetDefinition | null>
  versions: UseQueryResult<SheetDefinitionVersion[]>
  version: SheetDefinitionVersion | undefined
  publishError: string | null
  publishPending: boolean
  publishSucceeded: boolean
  onRetry: () => void
}) {
  if (definition.isPending || (definition.data && versions.isPending)) {
    return (
      <p role="status">
        {t('notebook.sheetDefinitionPage.loadingSheetDefinition')}
      </p>
    )
  }

  if (definition.isError || versions.isError) {
    return (
      <Notice
        tone="bad"
        title={t('notebook.sheetDefinitionPage.sheetDefinitionCouldNotTitle')}
        action={
          <Button onClick={onRetry}>{t('common.actions.tryAgain')}</Button>
        }
      >
        {t('notebook.sheetDefinitionPage.checkYourWorkspaceAccess')}
      </Notice>
    )
  }

  if (definition.data === null) {
    return (
      <Notice
        tone="warn"
        title={t(
          'notebook.sheetDefinitionPage.sheetDefinitionUnavailableTitle',
        )}
      >
        {t('notebook.sheetDefinitionPage.itMayNotExist')}
      </Notice>
    )
  }

  if (version) {
    return (
      <SheetDefinitionVersionPanels
        version={version}
        publishError={publishError}
        publishPending={publishPending}
        publishSucceeded={publishSucceeded}
      />
    )
  }

  if (versions.isSuccess) {
    return (
      <Notice
        tone="warn"
        title={t('notebook.sheetDefinitionPage.versionUnavailableTitle')}
      >
        {t('notebook.sheetDefinitionPage.theRequestedVersionIs')}
      </Notice>
    )
  }

  return null
}
