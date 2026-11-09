import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import {
  AddedFieldInputs,
  AddedFields,
  AddedFieldsFormSection,
  ObjectTypeName,
  useAddedFieldDraft,
} from '#/components/models/added-fields'
import { builtInModelQueryKeys } from '#/components/models/built-in-model-data'
import { BuiltInModelFields } from '#/components/models/built-in-model-fields'
import {
  BuiltInModelFieldsRoute,
  BuiltInModelLayout,
} from '#/components/models/built-in-model-layout'
import { modelTypeQueryKeys } from '#/components/models/model-subtype-data'
import { requireBuiltInModel } from '#/lib/built-in-models'
import { screenQueryClient, screenRoutes } from './screen-stories'
import { WORKSPACE_ID, experimentFields, modelTypes } from './model-fixtures'

/**
 * The page for a built-in model such as Experiment and the fields a workspace
 * added to it (`src/components/models/`): the layout with its header and
 * tabs, the Fields tab, the added-fields panel on an object, and the inputs
 * the create form shows. Reads are seeded into the cache the hooks use.
 */
const model = requireBuiltInModel('experiment')
const OBJECT_ID = '0198d970-e266-4000-8000-0000000007e1'
const active = experimentFields.filter((field) => field.lifecycle !== 'retired')

function seeded(withFields: boolean) {
  return screenQueryClient({
    data: [
      {
        key: builtInModelQueryKeys.fields('experiment', false),
        value: withFields ? active : [],
      },
      {
        key: builtInModelQueryKeys.fields('experiment', true),
        value: withFields ? experimentFields : [],
      },
      {
        key: builtInModelQueryKeys.takenKeys('experiment'),
        value: new Set(['objective', 'temperature_c']),
      },
      {
        key: builtInModelQueryKeys.values('experiment', OBJECT_ID),
        value: {
          customFields: {
            objective: 'Titre vs. feed rate',
            temperature_c: 36.8,
          },
          locked: false,
          modelVersionId: null,
        },
      },
      { key: modelTypeQueryKeys.all, value: withFields ? modelTypes : [] },
    ],
  })
}

const withFields = seeded(true)
const bare = seeded(false)

const meta = {
  title: 'Models/Built-in model pages',
  parameters: {
    layout: 'fullscreen',
    tanstack: {
      router: {
        route: screenRoutes('/models/$modelId/fields', [
          '/models',
          '/models/$modelId',
          '/models/$modelId/rules',
          '/experiments',
        ]),
        path: '/models/$modelId/fields',
        params: { modelId: 'experiment' },
      },
    },
  },
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

const noop = () => {}

/** The whole page for an admin: header, subtypes, actions and tabs. */
export const Layout: Story = {
  render: () => (
    <QueryClientProvider client={withFields}>
      <div className="flex h-[420px] w-[1000px] max-w-full">
        <BuiltInModelLayout
          model={model}
          role="admin"
          workspaceId={WORKSPACE_ID}
        />
      </div>
    </QueryClientProvider>
  ),
}

/** Without schema rights the Add field button is disabled with the reason. */
export const LayoutViewer: Story = {
  render: () => (
    <QueryClientProvider client={withFields}>
      <div className="flex h-[420px] w-[1000px] max-w-full">
        <BuiltInModelLayout
          model={model}
          role="viewer"
          workspaceId={WORKSPACE_ID}
        />
      </div>
    </QueryClientProvider>
  ),
}

/** The Fields tab: fixed standard fields, then the fields this workspace added. */
export const FieldsTab: Story = {
  render: () => (
    <QueryClientProvider client={withFields}>
      <div className="flex h-[520px] w-[1000px] max-w-full">
        <BuiltInModelFields
          model={model}
          workspaceId={WORKSPACE_ID}
          canEdit
          addOpen={false}
          onAddOpenChange={noop}
        />
      </div>
    </QueryClientProvider>
  ),
}

/** The Add field dialog open over the tab. */
export const AddFieldDialog: Story = {
  render: () => (
    <QueryClientProvider client={withFields}>
      <div className="flex h-[520px] w-[1000px] max-w-full">
        <BuiltInModelFieldsRoute
          model={model}
          workspaceId={WORKSPACE_ID}
          role="admin"
          addOpen
          onAddOpenChange={noop}
        />
      </div>
    </QueryClientProvider>
  ),
}

/** No fields added yet: only the standard fields. */
export const FieldsTabNoAddedFields: Story = {
  render: () => (
    <QueryClientProvider client={bare}>
      <div className="flex h-[420px] w-[1000px] max-w-full">
        <BuiltInModelFields
          model={model}
          workspaceId={WORKSPACE_ID}
          canEdit={false}
          addOpen={false}
          onAddOpenChange={noop}
        />
      </div>
    </QueryClientProvider>
  ),
}

/** The added fields on an object's inspector, with their values and an edit action. */
export const AddedFieldsInspector: Story = {
  parameters: { layout: 'centered' },
  render: () => (
    <QueryClientProvider client={withFields}>
      <div className="w-[340px]">
        <AddedFields modelKey="experiment" objectId={OBJECT_ID} />
      </div>
    </QueryClientProvider>
  ),
}

/** The same fields as a page section, read-only. */
export const AddedFieldsSection: Story = {
  parameters: { layout: 'centered' },
  render: () => (
    <QueryClientProvider client={withFields}>
      <div className="w-[480px]">
        <AddedFields
          modelKey="experiment"
          objectId={OBJECT_ID}
          variant="section"
          editable={false}
        />
      </div>
    </QueryClientProvider>
  ),
}

/** The inputs the create form generates for added fields, with a validation message. */
export const AddedFieldInputsForm: Story = {
  parameters: { layout: 'centered' },
  render: () => (
    <div className="w-[420px]">
      <AddedFieldInputs
        fields={active}
        values={{ objective: '', temperature_c: '36.8' }}
        errors={{ objective: 'Objective is required' }}
        showErrors
        onChange={noop}
      />
    </div>
  ),
}

function FormSection() {
  const draft = useAddedFieldDraft('experiment')

  return <AddedFieldsFormSection draft={draft} showErrors={false} />
}

/** The create-form block: the type picker and the model's asked fields. */
export const CreateFormSection: Story = {
  parameters: { layout: 'centered' },
  render: () => (
    <QueryClientProvider client={withFields}>
      <div className="w-[420px]">
        <FormSection />
      </div>
    </QueryClientProvider>
  ),
}

/** The type name of an object, falling back to the model's name. */
export const TypeName: Story = {
  parameters: { layout: 'centered' },
  render: () => (
    <QueryClientProvider client={withFields}>
      <ObjectTypeName
        modelKey="experiment"
        objectId={OBJECT_ID}
        fallback="Experiment"
      />
    </QueryClientProvider>
  ),
}
