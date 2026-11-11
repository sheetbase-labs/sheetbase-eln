import { t } from '#/copy'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'

import {
  ConfirmDialog,
  ConfirmDialogContent,
  ConfirmDialogHeader,
  ConfirmDialogTitle,
  ConfirmDialogDescription,
  ConfirmDialogFooter,
  ConfirmDialogCancel,
  ConfirmDialogAction,
} from '#/components/ui/confirm-dialog'
import { hasCapability } from '#/lib/capability'
import { SheetDefinitionHeader } from './-sheet-definition-header'
import { SheetDefinitionBody } from './-sheet-definition-version-panels'
import { safeReturnTo } from '#/lib/create-context-search'
import { signInRedirect } from '#/lib/sign-in-redirect'
import {
  fetchSheetDefinition,
  fetchSheetDefinitionVersions,
  publishSheetDefinitionVersion,
} from '#/lib/sheet-definition-data'

export const Route = createFileRoute('/sheet-definitions/$definitionId')({
  validateSearch: (search) => ({
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

  const failed = definition.isError || versions.isError

  const canPublish =
    Boolean(context.workspace?.role) &&
    hasCapability(context.workspace?.role, 'schema.publish')

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      <SheetDefinitionHeader
        name={definition.data?.name ?? t('notebook.sheetDefinitionPage.title')}
        returnTo={search.returnTo}
        version={version}
        versions={versions.data}
        definitionLifecycle={definition.data?.lifecycle}
        failed={failed}
        canPublish={canPublish}
        onPickVersion={(versionId) =>
          void navigate({ search: { ...search, version: versionId } })
        }
        onPublish={() => setConfirming(true)}
      />
      <div className="grid min-w-0 grid-cols-1 gap-6 px-4 py-4 md:px-6">
        <SheetDefinitionBody
          definition={definition}
          versions={versions}
          version={version}
          publishError={publish.isError ? publish.error.message : null}
          publishPending={publish.isPending}
          publishSucceeded={publish.isSuccess}
          onRetry={() => {
            void definition.refetch()
            void versions.refetch()
          }}
        />
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
