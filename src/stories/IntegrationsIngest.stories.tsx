import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { expect, userEvent, within } from 'storybook/test'

import { EnterpriseSourcePanel } from '#/components/v3/integrations/enterprise-source-panel'
import { IngestPanel } from '#/components/v3/integrations/ingest-panel'
import type { CanonicalDatasetSchemaField } from '#/lib/dataset-schema-definition-rpc'
import type { PublishedSchemaOption } from '#/lib/dataset-product'
import type { ConnectorWire } from '#/lib/connectors/types'
import { holdRead, screenQueryClient, withApiReads } from './screen-stories'
import type { FailedRead, ReadSeed } from './screen-stories'

/**
 * The left-hand column of a connector's detail page
 * (`src/routes/settings/integrations/$connectorId.tsx`): the instrument
 * ingestion panel and the enterprise source panel (S3 / PostgreSQL).
 *
 * Both panels read the published Schema Versions, the fields of the chosen
 * version and the projects a raw file can be retained into. Those reads are
 * seeded here, and `withApiReads` answers whatever a story leaves unseeded so
 * no read leaves the page. The panels' *runs* (discovery, preview, import) are
 * mutations behind `/api/connectors/source` and `/api/import/*`, so no story
 * drives one — they are covered by `tests/db/int-03-enterprise.test.ts`.
 */
const WORKSPACE_ID = '0198d970-e266-4000-8000-0000000000w1'
const CONNECTOR_ID = '0198d970-e266-4000-8000-0000000c0001'
const SCHEMA_VERSION_ID = '0198d970-e266-4000-8000-0000000000v1'

const meta = {
  title: 'Integrations/Connector detail — sources',
  decorators: [
    withApiReads('error'),
    (Story) => (
      <div className="w-[880px] max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

function provider(data: ReadSeed[], failed: FailedRead[] = []) {
  const client = screenQueryClient({ data })
  for (const read of failed) holdRead(client, read.key, read.kind, read.message)
  return (Story: () => React.ReactNode) => (
    <QueryClientProvider client={client}>
      <Story />
    </QueryClientProvider>
  )
}

// --- Instrument ingestion --------------------------------------------------

const schemas: PublishedSchemaOption[] = [
  {
    schemaDefinitionId: '0198d970-e266-4000-8000-0000000000s1',
    schemaVersionId: SCHEMA_VERSION_ID,
    key: 'plate-reading',
    name: 'Plate reading',
    description: 'One row per well.',
    version: 3,
  },
]

/** The published fields the mapping is suggested against. */
const fields: CanonicalDatasetSchemaField[] = [
  {
    field_id: 'field-well',
    key: 'well',
    label: 'Well',
    description: null,
    logical_type: 'text',
    nullable: false,
    cardinality: 'one',
    lifecycle: 'active',
    display_order: 1,
  },
  {
    field_id: 'field-sample',
    key: 'sample',
    label: 'Sample',
    description: null,
    logical_type: 'text',
    nullable: false,
    cardinality: 'one',
    lifecycle: 'active',
    display_order: 2,
  },
  {
    field_id: 'field-value',
    key: 'value',
    label: 'A600',
    description: null,
    logical_type: 'number',
    nullable: true,
    cardinality: 'one',
    lifecycle: 'active',
    display_order: 3,
  },
  {
    // Retired after v3: it must not appear as a mapping target.
    field_id: 'field-unit',
    key: 'unit',
    label: 'Unit',
    description: null,
    logical_type: 'text',
    nullable: true,
    cardinality: 'one',
    lifecycle: 'retired',
    display_order: 4,
  },
]

const projects = [
  { id: '0198d970-e266-4000-8000-0000000000p1', title: 'TB-02 stability' },
  { id: '0198d970-e266-4000-8000-0000000000p2', title: 'Ambr screening' },
]

const datasets = [
  {
    id: '0198d970-e266-4000-8000-000000000d01',
    name: 'TB-02 plate readings',
    revision: 4,
  },
]

const ingestSeeds: ReadSeed[] = [
  { key: ['connectors', 'ingest', 'schemas'], value: schemas },
  {
    key: ['connectors', 'ingest', 'fields', SCHEMA_VERSION_ID],
    value: fields,
  },
  {
    key: ['connectors', 'ingest', 'datasets', SCHEMA_VERSION_ID],
    value: datasets,
  },
  { key: ['connectors', 'ingest', 'projects'], value: projects },
]

const PLATE_CSV = new File(
  [
    '# Instrument: BMG Clariostar\n',
    '# Plate: PLATE-0319\n',
    '\n',
    'well,sample,value,unit\n',
    'A1,tb-02-1,0.412,AU\n',
    'A2,tb-02-2,0.388,AU\n',
    'A3,tb-02-3,0.401,AU\n',
  ],
  'plate-0319.csv',
  { type: 'text/csv' },
)

/** At rest: the target Schema, the project to retain the raw file in, a run to write into. */
export const InstrumentOutput: Story = {
  decorators: [provider(ingestSeeds)],
  render: () => (
    <IngestPanel
      workspaceId={WORKSPACE_ID}
      connectorId={CONNECTOR_ID}
      parserId="sheetbase.plate-reader-csv"
    />
  ),
}

/**
 * A file picked and a Schema chosen, which is when the panel can show what it
 * will actually write: the column mapping the parser implies and the first rows
 * of the retained payload. Both were reached through the panel's own file field
 * and Schema select, so this is the component's state and not a fixture.
 */
export const MappedToSchema: Story = {
  decorators: [provider(ingestSeeds)],
  render: () => (
    <IngestPanel
      workspaceId={WORKSPACE_ID}
      connectorId={CONNECTOR_ID}
      parserId="sheetbase.plate-reader-csv"
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.selectOptions(
      await canvas.findByLabelText('Target dataset structure'),
      SCHEMA_VERSION_ID,
    )
    await userEvent.upload(
      await canvas.findByLabelText('Instrument file'),
      PLATE_CSV,
    )
    await expect(
      await canvas.findByText(/Column mapping \(3 mapped, 3 rows\)/),
    ).toBeInTheDocument()
    await expect(
      canvas.getByRole('table', { name: 'Mapping preview' }),
    ).toBeInTheDocument()
  },
}

/**
 * No published Schema Version exists, so the panel can name no target and its
 * run button cannot become enabled. The panel states this by offering only the
 * placeholder rather than by an empty-state of its own.
 */
export const NoPublishedSchema: Story = {
  decorators: [
    provider([
      { key: ['connectors', 'ingest', 'schemas'], value: [] },
      { key: ['connectors', 'ingest', 'projects'], value: projects },
    ]),
  ],
  render: () => (
    <IngestPanel
      workspaceId={WORKSPACE_ID}
      connectorId={CONNECTOR_ID}
      parserId="sheetbase.plate-reader-csv"
    />
  ),
}

/**
 * The panel's reads were refused: its form renders as it always does, with every
 * select carrying only its placeholder and the run button disabled, because the
 * panel has no loading or failure chrome of its own — a *pending*, *refused* or
 * *failed* read all look like this.
 */
export const ReadsRefused: Story = {
  decorators: [
    provider(
      [],
      [
        { key: ['connectors', 'ingest', 'schemas'], kind: 'denied' },
        { key: ['connectors', 'ingest', 'projects'], kind: 'denied' },
      ],
    ),
  ],
  render: () => (
    <IngestPanel
      workspaceId={WORKSPACE_ID}
      connectorId={CONNECTOR_ID}
      parserId="sheetbase.plate-reader-csv"
    />
  ),
}

// --- Enterprise sources ----------------------------------------------------

function connector(overrides: Partial<ConnectorWire>): ConnectorWire {
  return {
    id: CONNECTOR_ID,
    workspace_id: WORKSPACE_ID,
    key: 'source',
    name: 'Source',
    connector_type: 'storage',
    direction: 'inbound',
    status: 'active',
    parser_id: null,
    config: {},
    created_at: '2026-09-02T09:00:00.000Z',
    updated_at: '2026-10-01T09:00:00.000Z',
    ...overrides,
  }
}

const s3Connector = connector({
  key: 'archive-bucket',
  name: 'Archive bucket',
  connector_type: 'storage',
  config: {
    adapter: 's3',
    bucket: 'acme-lab-archive',
    prefix: 'ambr/2026/',
    region: 'eu-west-2',
  },
})

const postgresConnector = connector({
  key: 'lims-readonly',
  name: 'LIMS (read-only)',
  connector_type: 'database',
  config: {
    adapter: 'postgres',
    host: 'lims.internal',
    port: 5432,
    database: 'lims',
    sslMode: 'require',
  },
})

/**
 * An S3-compatible source before discovery. Discovery, the bounded preview and
 * the import each need the server-side adapter, so the reachable state here is
 * the panel at rest, with the two server actions it offers.
 */
export const ObjectStorageAtRest: Story = {
  decorators: [
    provider([{ key: ['connectors', 'source', 'projects'], value: projects }]),
  ],
  render: () => (
    <EnterpriseSourcePanel workspaceId={WORKSPACE_ID} connector={s3Connector} />
  ),
}

/** The same, for an external PostgreSQL source. */
export const DatabaseAtRest: Story = {
  decorators: [provider([])],
  render: () => (
    <EnterpriseSourcePanel
      workspaceId={WORKSPACE_ID}
      connector={postgresConnector}
    />
  ),
}

/**
 * A connector with no enterprise adapter in its config (an instrument, a
 * webhook, or an unconfigured storage connector): the panel returns `null`
 * rather than an empty frame, because the connector detail page renders it only
 * for an adapter that exists. The silence is the contract.
 */
export const NoEnterpriseAdapter: Story = {
  decorators: [provider([])],
  render: () => (
    <EnterpriseSourcePanel
      workspaceId={WORKSPACE_ID}
      connector={connector({
        key: 'plate-reader-bench-2',
        name: 'Plate reader bench 2',
        connector_type: 'instrument',
        parser_id: 'sheetbase.plate-reader-csv',
        config: {},
      })}
    />
  ),
}
