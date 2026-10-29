import { t } from '#/copy'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { z } from 'zod'

import { Notice } from '#/components/v3/ui/alert'
import { Button } from '#/components/v3/ui/button'
import { PageHeader, Section } from '#/components/v3/ui/layout'
import { Select } from '#/components/v3/ui/select'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import {
  ConfirmDialog,
  ConfirmDialogContent,
  ConfirmDialogHeader,
  ConfirmDialogTitle,
  ConfirmDialogDescription,
  ConfirmDialogFooter,
  ConfirmDialogCancel,
  ConfirmDialogAction,
} from '#/components/v3/ui/confirm-dialog'
import { hasCapability } from '#/lib/capability'
import { safeReturnTo } from '#/lib/create-context-search'
import { signInRedirect } from '#/lib/sign-in-redirect'
import {
  fetchSheetDefinition,
  fetchSheetDefinitionVersions,
  publishSheetDefinitionVersion,
} from '#/lib/sheet-definition-data'

export const Route = createFileRoute('/sheet-definitions/$definitionId')({
  validateSearch: (search: Record<string, unknown>) => ({
    version: z.uuid().optional().catch(undefined).parse(search.version),
    returnTo: safeReturnTo(search.returnTo),
  }),
  beforeLoad: ({ context, location }) => {
    if (!context.auth) throw redirect(signInRedirect(location))
    return { context: context.auth }
  },
  component: SheetDefinitionPage,
})

function SheetDefinitionPage() {
  const { definitionId } = Route.useParams()
  const search = Route.useSearch()
  const { context } = Route.useRouteContext()
  const navigate = Route.useNavigate()
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const definition = useQuery({
    queryKey: ['sheet-definitions', definitionId],
    queryFn: () => fetchSheetDefinition(definitionId),
  })
  const versions = useQuery({
    queryKey: ['sheet-definition-versions', definitionId],
    queryFn: () => fetchSheetDefinitionVersions(definitionId),
    enabled: Boolean(definition.data),
  })
  const version = search.version
    ? versions.data?.find((item) => item.id === search.version)
    : versions.data?.at(-1)
  const publish = useMutation({
    mutationFn: () => {
      if (!version)
        throw new Error(t('notebook.sheetDefinitionPage.chooseAVersionTo'))
      return publishSheetDefinitionVersion(version.id, version.revision)
    },
    onSuccess: async () => {
      setConfirming(false)
      await queryClient.invalidateQueries({
        queryKey: ['sheet-definition-versions'],
      })
      await queryClient.invalidateQueries({
        queryKey: ['ui-port', 'sheets', 'new', 'dataset-sheet-options'],
      })
    },
  })
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      <PageHeader
        title={definition.data?.name ?? t('notebook.sheetDefinitionPage.title')}
        trail={
          search.returnTo
            ? [
                {
                  label: (
                    <Link to={search.returnTo} className="text-link">
                      {t('notebook.sheetDefinitionPage.backToSourceSheet')}
                    </Link>
                  ),
                },
                { label: t('notebook.sheetDefinitionPage.title') },
              ]
            : undefined
        }
        meta={
          version && !definition.isError && !versions.isError ? (
            <>
              <label className="flex items-center gap-2">
                {t('notebook.sheetDefinitionPage.version')}
                <Select
                  size="sm"
                  className="w-44"
                  value={version.id}
                  onChange={(event) =>
                    void navigate({
                      search: { ...search, version: event.target.value },
                    })
                  }
                >
                  {versions.data?.map((item) => (
                    <option key={item.id} value={item.id}>
                      v{item.version} · {item.lifecycle}
                    </option>
                  ))}
                </Select>
              </label>
              <span>
                {t('notebook.sheetDefinitionPage.definitionLifecycle', {
                  lifecycle: definition.data?.lifecycle ?? '',
                })}
              </span>
            </>
          ) : null
        }
        actions={
          !definition.isError &&
          !versions.isError &&
          version?.lifecycle === 'draft' &&
          definition.data?.lifecycle === 'active' &&
          hasCapability(context.workspace?.role, 'schema.publish') ? (
            <Button variant="primary" onClick={() => setConfirming(true)}>
              {t('notebook.sheetDefinitionPage.publishVersionVersion', {
                version: version.version,
              })}
            </Button>
          ) : null
        }
      />
      <div className="grid min-w-0 grid-cols-1 gap-6 px-4 py-4 md:px-6">
        {definition.isPending || (definition.data && versions.isPending) ? (
          <p role="status">
            {t('notebook.sheetDefinitionPage.loadingSheetDefinition')}
          </p>
        ) : null}
        {definition.isError || versions.isError ? (
          <Notice
            tone="bad"
            title={t(
              'notebook.sheetDefinitionPage.sheetDefinitionCouldNotTitle',
            )}
            action={
              <Button
                onClick={() => {
                  void definition.refetch()
                  void versions.refetch()
                }}
              >
                {t('common.actions.tryAgain')}
              </Button>
            }
          >
            {t('notebook.sheetDefinitionPage.checkYourWorkspaceAccess')}
          </Notice>
        ) : definition.data === null ? (
          <Notice
            tone="warn"
            title={t(
              'notebook.sheetDefinitionPage.sheetDefinitionUnavailableTitle',
            )}
          >
            {t('notebook.sheetDefinitionPage.itMayNotExist')}
          </Notice>
        ) : version ? (
          <>
            <Notice
              title={t(
                'notebook.sheetDefinitionPage.reusableSheetStructureNotTitle',
              )}
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
                    {version.configuration.columns.map(
                      ({ id, field, source }) => (
                        <TableRow key={id}>
                          <TableCell className="whitespace-normal break-words font-medium">
                            {field.label}
                          </TableCell>
                          <TableCell>{field.logicalType}</TableCell>
                          <TableCell>
                            {field.quantity?.storageUnit ?? '—'}
                          </TableCell>
                          <TableCell>{source.kind}</TableCell>
                        </TableRow>
                      ),
                    )}
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
            {publish.isError ? (
              <Notice
                tone="bad"
                title={t('notebook.sheetDefinitionPage.couldNotPublishTitle')}
              >
                {publish.error.message}
              </Notice>
            ) : null}
            {publish.isSuccess ? (
              <Notice
                title={t('notebook.sheetDefinitionPage.versionPublishedTitle')}
              >
                {t('notebook.sheetDefinitionPage.thisVersionIsNow')}
              </Notice>
            ) : null}
          </>
        ) : versions.isSuccess ? (
          <Notice
            tone="warn"
            title={t('notebook.sheetDefinitionPage.versionUnavailableTitle')}
          >
            {t('notebook.sheetDefinitionPage.theRequestedVersionIs')}
          </Notice>
        ) : null}
      </div>
      <ConfirmDialog open={confirming} onOpenChange={setConfirming}>
        <ConfirmDialogContent>
          <ConfirmDialogHeader>
            <ConfirmDialogTitle>
              {t('notebook.sheetDefinitionPage.publishSheetDefinitionVersion', {
                version: version?.version ?? '',
              })}
            </ConfirmDialogTitle>
            <ConfirmDialogDescription>
              {t('notebook.sheetDefinitionPage.thisVersionBecomesImmutable')}
            </ConfirmDialogDescription>
          </ConfirmDialogHeader>
          <ConfirmDialogFooter>
            <ConfirmDialogCancel>
              {t('common.actions.cancel')}
            </ConfirmDialogCancel>
            <ConfirmDialogAction
              disabled={publish.isPending}
              onClick={() => publish.mutate()}
            >
              {publish.isPending
                ? t('notebook.sheetDefinitionPage.publishing')
                : t('notebook.sheetDefinitionPage.publishVersion')}
            </ConfirmDialogAction>
          </ConfirmDialogFooter>
        </ConfirmDialogContent>
      </ConfirmDialog>
    </div>
  )
}
