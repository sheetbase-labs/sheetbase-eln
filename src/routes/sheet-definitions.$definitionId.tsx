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
      if (!version) throw new Error('Choose a version to publish.')
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
        title={definition.data?.name ?? 'Sheet Definition'}
        trail={
          search.returnTo
            ? [
                {
                  label: (
                    <Link to={search.returnTo} className="text-link">
                      Back to source sheet
                    </Link>
                  ),
                },
                { label: 'Sheet Definition' },
              ]
            : undefined
        }
        meta={
          version && !definition.isError && !versions.isError ? (
            <>
              <label className="flex items-center gap-2">
                Version
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
              <span>Definition: {definition.data?.lifecycle}</span>
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
              Publish version {version.version}
            </Button>
          ) : null
        }
      />
      <div className="grid min-w-0 grid-cols-1 gap-6 px-4 py-4 md:px-6">
        {definition.isPending || (definition.data && versions.isPending) ? (
          <p role="status">Loading Sheet Definition…</p>
        ) : null}
        {definition.isError || versions.isError ? (
          <Notice
            tone="bad"
            title="Sheet Definition could not be loaded"
            action={
              <Button
                onClick={() => {
                  void definition.refetch()
                  void versions.refetch()
                }}
              >
                Try again
              </Button>
            }
          >
            Check your workspace access and connection.
          </Notice>
        ) : definition.data === null ? (
          <Notice tone="warn" title="Sheet Definition unavailable">
            It may not exist or may not be accessible in this workspace.
          </Notice>
        ) : version ? (
          <>
            <Notice title="Reusable sheet structure, not a Record Model">
              Review the inputs, bindings and calculations before publishing.
              Publishing makes this version immutable; it does not change
              existing sheets or frozen notebook evidence.
            </Notice>
            <Section
              title="Inputs"
              count={version.configuration.parameters.length}
            >
              {version.configuration.parameters.length ? (
                <TableBox>
                  <Table caption="Sheet Definition inputs">
                    <TableHeader>
                      <TableRow>
                        <TableHead scope="col">Input</TableHead>
                        <TableHead scope="col">Type</TableHead>
                        <TableHead scope="col">Requirement</TableHead>
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
                            {parameter.required ? 'Required' : 'Optional'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableBox>
              ) : (
                <p className="m-0 text-body text-fg-muted">No parameters.</p>
              )}
            </Section>
            <Section
              title="Columns"
              count={version.configuration.columns.length}
            >
              <TableBox>
                <Table caption="Sheet Definition columns">
                  <TableHeader>
                    <TableRow>
                      <TableHead scope="col">Column</TableHead>
                      <TableHead scope="col">Type</TableHead>
                      <TableHead scope="col">Storage unit</TableHead>
                      <TableHead scope="col">Source</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody empty="No columns." colSpan={4}>
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
              title="Calculations"
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
                <p className="m-0 text-body text-fg-muted">No calculations.</p>
              )}
            </Section>
            <details className="min-w-0 border-t border-border pt-3">
              <summary className="cursor-pointer rounded-sm py-1 text-label font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
                Inspect complete configuration
              </summary>
              <pre className="max-h-[500px] overflow-auto rounded-md border border-border bg-surface-muted p-3 text-caption">
                {JSON.stringify(version.configuration, null, 2)}
              </pre>
            </details>
            {publish.isError ? (
              <Notice tone="bad" title="Could not publish">
                {publish.error.message}
              </Notice>
            ) : null}
            {publish.isSuccess ? (
              <Notice title="Version published">
                This version is now available when creating compatible sheets.
              </Notice>
            ) : null}
          </>
        ) : versions.isSuccess ? (
          <Notice tone="warn" title="Version unavailable">
            The requested version is not available. No other version has been
            substituted.
          </Notice>
        ) : null}
      </div>
      <ConfirmDialog open={confirming} onOpenChange={setConfirming}>
        <ConfirmDialogContent>
          <ConfirmDialogHeader>
            <ConfirmDialogTitle>
              Publish Sheet Definition version {version?.version}?
            </ConfirmDialogTitle>
            <ConfirmDialogDescription>
              This version becomes immutable and available for reuse. Existing
              sheets and submitted evidence stay unchanged.
            </ConfirmDialogDescription>
          </ConfirmDialogHeader>
          <ConfirmDialogFooter>
            <ConfirmDialogCancel>Cancel</ConfirmDialogCancel>
            <ConfirmDialogAction
              disabled={publish.isPending}
              onClick={() => publish.mutate()}
            >
              {publish.isPending ? 'Publishing…' : 'Publish version'}
            </ConfirmDialogAction>
          </ConfirmDialogFooter>
        </ConfirmDialogContent>
      </ConfirmDialog>
    </div>
  )
}
