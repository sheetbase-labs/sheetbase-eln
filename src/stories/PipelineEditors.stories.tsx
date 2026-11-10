import { useState } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { InputsEditor } from '#/components/pipelines/inputs-editor'
import { OutputEditor } from '#/components/pipelines/output-editor'
import type { OutputDraft } from '#/components/pipelines/output-editor'
import { ParametersEditor } from '#/components/pipelines/parameters-editor'
import { PreviewTable } from '#/components/pipelines/preview-table'
import {
  ColumnsEditor,
  PythonPackagesEditor,
  PythonStepEditor,
  PythonTestRun,
} from '#/components/pipelines/python-editor'
import { SqlEditor } from '#/components/pipelines/sql-editor'
import { StepsEditor } from '#/components/pipelines/steps-editor'
import { TrialPanel } from '#/components/pipelines/trial-panel'
import type {
  PipelineInput,
  PipelineParameter,
  PipelineStep,
} from '#/lib/pipelines/config'
import type { PythonColumn, PythonContract } from '#/lib/pipelines/python'
import type { ResultPreview } from '#/lib/pipelines/result-preview'
import { screenQueryClient } from './screen-stories'

/**
 * The pipeline authoring editors (`src/components/pipelines/`).
 *
 * Inputs, parameters, the output target, SQL and Python steps, and the later
 * steps list: each is a controlled editor, so each story holds the value in
 * state and the controls really edit it. The reads an editor makes for choices
 * (dataset versions, schema versions, a version's columns) are seeded by key
 * with `staleTime: Infinity`; nothing reaches a database or the network, and
 * the Python test run, which posts to the runner, is shown at rest only.
 */
const meta = {
  title: 'Pipelines/Editors',
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <div className="w-[760px] max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

const choices = [
  {
    id: 'dv-1',
    label: 'Plate reads: DS-0012 — v3 (2026-10-02)',
    schemaId: 'sch-1',
    schemaName: 'Plate reader',
  },
  {
    id: 'dv-2',
    label: 'Stability pulls: DS-0020 — v1 (2026-09-28)',
    schemaId: 'sch-2',
    schemaName: 'Stability',
  },
]

const fields = [
  { key: 'well', label: 'Well', type: 'text', required: true },
  { key: 'od600', label: 'OD600', type: 'decimal', required: true },
  { key: 'read_at', label: 'Read at', type: 'timestamp', required: false },
]

const targets = {
  datasets: [
    {
      id: 'ds-1',
      name: 'Plate reads',
      displayId: 'DS-0012',
      schemaVersionId: 'sv-1',
    },
  ],
  schemaVersions: [
    { id: 'sv-1', label: 'Plate reader v3' },
    { id: 'sv-2', label: 'Stability v1' },
  ],
}

const client = screenQueryClient({
  data: [
    {
      key: ['ui-port', 'pipelines', 'dataset-version-choices'],
      value: choices,
    },
    { key: ['ui-port', 'pipelines', 'output-targets'], value: targets },
    {
      key: ['ui-port', 'pipelines', 'version-fields', 'dv-1'],
      value: fields,
    },
    {
      key: ['ui-port', 'pipelines', 'schema-fields', 'sv-1'],
      value: fields,
    },
    {
      key: ['ui-port', 'pipelines', 'python-runtime'],
      value: {
        available: true,
        runtime: 'sheetbase-python@sha256:4f2c',
        python: '3.12.8',
        packages: { numpy: '2.1.0', pandas: '2.2.3' },
      },
    },
  ],
})

const withClient = (Story: () => React.ReactNode) => (
  <QueryClientProvider client={client}>
    <Story />
  </QueryClientProvider>
)

/** The tables a pipeline reads, with an example dataset chosen for columns. */
export const Inputs: Story = {
  decorators: [withClient],
  render: function Render() {
    const [inputs, setInputs] = useState<PipelineInput[]>([
      { name: 'readings', required: true, description: 'Plate reader export' },
      { name: 'Bad Name', required: false },
    ])

    return (
      <InputsEditor inputs={inputs} onChange={setInputs} onInsert={() => {}} />
    )
  },
}

export const InputsEmpty: Story = {
  decorators: [withClient],
  render: function Render() {
    const [inputs, setInputs] = useState<PipelineInput[]>([])

    return (
      <InputsEditor inputs={inputs} onChange={setInputs} onInsert={() => {}} />
    )
  },
}

/** The values a run asks for: typed, required or defaulted. */
export const Parameters: Story = {
  render: function Render() {
    const [parameters, setParameters] = useState<PipelineParameter[]>([
      { name: 'threshold', type: 'decimal', required: true },
      { name: 'plate_label', type: 'text', required: false, default: 'P-01' },
    ])

    return <ParametersEditor parameters={parameters} onChange={setParameters} />
  },
}

export const ParametersEmpty: Story = {
  render: function Render() {
    const [parameters, setParameters] = useState<PipelineParameter[]>([])

    return <ParametersEditor parameters={parameters} onChange={setParameters} />
  },
}

function OutputStory({ start }: { start: OutputDraft }) {
  const [value, setValue] = useState(start)

  return (
    <OutputEditor
      value={value}
      onChange={(patch) => setValue((v) => ({ ...v, ...patch }))}
      resultColumns={['well', 'od600', 'read_at']}
      fieldErrors={{}}
    />
  )
}

const noOutput: OutputDraft = {
  mode: 'none',
  datasetName: '',
  schemaVersionId: '',
  datasetId: '',
  datasetLabel: '',
  fieldMapping: null,
}

/** Where the result goes: shown on the run page only. */
export const OutputNone: Story = {
  decorators: [withClient],
  render: () => <OutputStory start={noOutput} />,
}

/** A new dataset from a schema version, with the columns the result must make. */
export const OutputCreate: Story = {
  decorators: [withClient],
  render: () => (
    <OutputStory
      start={{
        ...noOutput,
        mode: 'create',
        datasetName: 'Normalised plate reads',
        schemaVersionId: 'sv-1',
        datasetLabel: 'Run output',
      }}
    />
  ),
}

/** Appending to an existing dataset. */
export const OutputAppend: Story = {
  decorators: [withClient],
  render: () => (
    <OutputStory
      start={{
        ...noOutput,
        mode: 'append',
        datasetId: 'ds-1',
        datasetLabel: 'Weekly append',
      }}
    />
  ),
}

const preview: ResultPreview = {
  columns: ['well', 'od600', 'flag'],
  rows: [
    ['A1', 0.412, null],
    ['A2', 0.398, null],
    ['A3', 1.871, 'high'],
  ],
  rowCount: 96,
  truncated: true,
}

/** The first rows a transform produced, and how many there were. */
export const Preview: Story = {
  render: () => <PreviewTable preview={preview} keptAll />,
}

export const PreviewShort: Story = {
  render: () => (
    <PreviewTable preview={{ ...preview, rowCount: 3, truncated: false }} />
  ),
}

/** SQL with keywords, strings, numbers, comments and parameters coloured. */
export const Sql: Story = {
  render: function Render() {
    const [value, setValue] = useState(
      "-- keep reads above the cut-off\nselect well, round(od600, 3) as od600\nfrom readings\nwhere od600 > {{threshold}} and plate = 'P-01'\nlimit 100",
    )

    return (
      <SqlEditor
        aria-label="Transform"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
    )
  },
}

const columns: PythonColumn[] = [
  { name: 'well', type: 'text', nullable: false },
  { name: 'od600', type: 'decimal' },
]

export const PythonColumns: Story = {
  render: function Render() {
    const [value, setValue] = useState(columns)

    return (
      <ColumnsEditor
        label="Output columns"
        columns={value}
        onChange={setValue}
      />
    )
  },
}

/** Pinned packages checked against what the runtime provides. */
export const PythonPackages: Story = {
  render: function Render() {
    const [requirements, setRequirements] = useState([
      'pandas==2.2.3',
      'scipy==1.14.0',
    ])

    return (
      <PythonPackagesEditor
        requirements={requirements}
        onChange={setRequirements}
        runtime={{
          available: true,
          python: '3.12.8',
          packages: { numpy: '2.1.0', pandas: '2.2.3' },
        }}
      />
    )
  },
}

const pythonInputs: PipelineInput[] = [{ name: 'readings', required: true }]

const pythonParameters: PipelineParameter[] = [
  { name: 'threshold', type: 'decimal', required: true },
]

/** A Python step: code, contract, packages and the test run at rest. */
export const PythonStep: Story = {
  render: function Render() {
    const [statement, setStatement] = useState(
      'def transform(readings, threshold):\n    readings["flag"] = readings["od600"] > threshold\n    return readings\n',
    )

    const [contract, setContract] = useState<PythonContract | undefined>({
      inputs: { readings: columns },
      output: { columns },
    })

    return (
      <PythonStepEditor
        label="Transform"
        statement={statement}
        onStatementChange={setStatement}
        contract={contract}
        onContractChange={setContract}
        inputs={pythonInputs}
        parameters={pythonParameters}
        hasPrevious={false}
        runtime={{
          available: true,
          python: '3.12.8',
          packages: { numpy: '2.1.0', pandas: '2.2.3' },
        }}
        requirements={['pandas==2.2.3']}
      />
    )
  },
}

export const PythonTest: Story = {
  render: () => (
    <PythonTestRun
      label="Transform"
      statement={'def transform(readings):\n    return readings\n'}
      contract={undefined}
      aliases={['readings']}
      parameters={pythonParameters}
      onUseOutputColumns={() => {}}
    />
  ),
}

const members = { 'u-1': 'Priya Raman', 'u-2': 'Tom Okafor' }

/** Steps after the transform: one SQL, one that pauses for a person. */
export const Steps: Story = {
  decorators: [withClient],
  render: function Render() {
    const [steps, setSteps] = useState<PipelineStep[]>([
      {
        name: 'drop-blanks',
        language: 'sql',
        statement: 'select * from previous where od600 is not null',
      },
      {
        name: 'confirm-outliers',
        language: 'sql',
        statement: 'select * from previous',
        confirm: {
          fields: [{ key: 'ok', label: 'Keep outliers?', type: 'boolean' }],
          askedUserIds: ['u-1'],
          noAnswer: 'reask',
        },
      },
    ])

    return (
      <StepsEditor
        steps={steps}
        members={members}
        onChange={setSteps}
        python={{
          inputs: pythonInputs,
          parameters: pythonParameters,
          transformRuns: true,
        }}
      />
    )
  },
}

export const StepsEmpty: Story = {
  decorators: [withClient],
  render: () => (
    <StepsEditor steps={[]} members={members} onChange={() => {}} />
  ),
}

/** The answer to "Try draft": a result, a stale one, and a failure. */
export const Trial: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <TrialPanel
        result={{
          ok: true,
          preview,
          logs: [],
          durationMs: 1400,
          wouldWrite: 'create',
        }}
        stale={false}
        onTryAgain={() => {}}
      />
      <TrialPanel
        result={{
          ok: true,
          preview,
          logs: [],
          durationMs: 900,
          wouldWrite: 'none',
        }}
        stale
        onTryAgain={() => {}}
      />
    </div>
  ),
}

export const TrialFailed: Story = {
  render: () => (
    <TrialPanel
      result={{
        ok: false,
        errorCode: 'sql_error',
        errorMessage: 'column "od6OO" does not exist',
        logs: [],
      }}
      stale={false}
      onTryAgain={() => {}}
    />
  ),
}
