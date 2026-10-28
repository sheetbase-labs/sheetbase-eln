import { useState } from 'react'
import { Link, Outlet } from '@tanstack/react-router'

import { Button } from '#/components/v3/ui/button'
import { PageHeader } from '#/components/v3/ui/layout'
import { Status } from '#/components/v3/ui/status'
import { Tabs } from '#/components/v3/ui/tabs'
import { Tooltip } from '#/components/v3/ui/tooltip'
import { hasCapability } from '#/lib/capability'
import type { BuiltInModel } from '#/lib/built-in-models'
import { useBuiltInModelFields } from './built-in-model-data'
import { BuiltInModelFields } from './built-in-model-fields'
import { NewSubtypeDialog, SubtypesList } from './model-subtype-ui'

const EDIT_DENIED = 'Only workspace owners, admins and stewards can add fields.'

/**
 * The page for a built-in model (Experiment, Sample…): its fields, which a
 * workspace extends with its own, and the rules that check them.
 */
export function BuiltInModelLayout({
  model,
  role,
  workspaceId,
}: {
  model: BuiltInModel
  role: string | null | undefined
  workspaceId: string | null
}) {
  const fields = useBuiltInModelFields(model.key)
  const [subtypeOpen, setSubtypeOpen] = useState(false)
  const canEdit = hasCapability(role, 'schema.edit')
  const params = { modelId: model.key }
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PageHeader
        trail={[
          { label: 'Models', link: { to: '/models' } },
          { label: model.name },
        ]}
        title={model.name}
        meta={
          <>
            <span className="text-fg">
              <Status tone="ok">Published</Status>
            </span>
            <span>Built-in record type</span>
            <span>
              ID prefix <span className="mono">{model.idPrefix}-</span>
            </span>
            <SubtypesList modelKey={model.key} />
          </>
        }
        actions={
          <>
            <Button
              nativeButton={false}
              render={<Link to={model.surface.to} />}
            >
              Open {model.surface.label}
            </Button>
            {canEdit ? (
              <Button onClick={() => setSubtypeOpen(true)}>New subtype</Button>
            ) : null}
            {canEdit ? (
              <Button
                variant="primary"
                icon="plus"
                nativeButton={false}
                render={
                  <Link
                    to="/models/$modelId/fields"
                    params={params}
                    search={{ add: true }}
                  />
                }
              >
                Add field
              </Button>
            ) : (
              <Tooltip content={EDIT_DENIED}>
                <Button variant="primary" icon="plus" disabled>
                  Add field
                </Button>
              </Tooltip>
            )}
          </>
        }
        tabs={
          <Tabs
            mode="url"
            label={`${model.name} model sections`}
            items={[
              {
                label: 'Fields',
                count: fields.data
                  ? model.standardFields.length + fields.data.length
                  : undefined,
                link: { to: '/models/$modelId/fields', params },
              },
              {
                label: 'Rules',
                link: { to: '/models/$modelId/rules', params },
              },
            ]}
          />
        }
      />
      <div className="flex min-h-0 flex-1">
        <Outlet />
      </div>
      <NewSubtypeDialog
        open={subtypeOpen}
        onOpenChange={setSubtypeOpen}
        workspaceId={workspaceId}
        parentKey={model.key}
        parentName={model.name}
      />
    </div>
  )
}

export function BuiltInModelFieldsRoute({
  model,
  workspaceId,
  role,
  addOpen,
  onAddOpenChange,
}: {
  model: BuiltInModel
  workspaceId: string | null
  role: string | null | undefined
  addOpen: boolean
  onAddOpenChange: (open: boolean) => void
}) {
  const canEdit = hasCapability(role, 'schema.edit')
  return (
    <BuiltInModelFields
      model={model}
      workspaceId={workspaceId}
      canEdit={canEdit}
      addOpen={canEdit && addOpen}
      onAddOpenChange={onAddOpenChange}
    />
  )
}
