import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DataClient } from '#/lib/data-client'
import { PipelineVersionEditor } from './pipeline-version-editor'
import { createPipelineDefinitionVersion } from '#/lib/pipelines/data'

vi.mock('#/lib/dataset-product', () => ({
  listPublishedDatasetSchemas: async () => [],
}))
vi.mock('#/lib/pipelines/data', () => ({
  createPipelineDefinitionVersion: vi.fn(async () => ({})),
  updatePipelineDefinitionVersionDraft: vi.fn(async () => ({})),
  pipelineQueryKeys: {
    versions: (id: string) => ['versions', id],
    definition: (id: string) => ['definition', id],
  },
}))
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})
const initial = {
  configVersion: 1,
  pythonRuntime:
    'python@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  parameters: [],
  inputs: [],
  transform: {
    language: 'python',
    statement: "def transform(inputs, parameters):\n    return [{'value': 1}]",
  },
  output: { mode: 'none', datasetLabel: 'result' },
  steps: [
    { name: 'clean', language: 'sql', statement: 'SELECT * FROM previous' },
  ],
  notifications: [],
}
function setup(configuration: Record<string, unknown> = initial) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        available: true,
        runtime:
          'python@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      }),
    })),
  )
  const client = { list: vi.fn(async () => []) } as unknown as DataClient
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <PipelineVersionEditor
        dataClient={client}
        workspaceId="workspace"
        definitionId="definition"
        draft={null}
        canManage
        initialConfiguration={configuration}
      />
    </QueryClientProvider>,
  )
}
describe('Pipeline authoring', () => {
  it('preserves incomplete notification payloads and saves authored result references', async () => {
    setup({
      ...initial,
      notifications: [
        { subscriptionId: '00000000-0000-4000-8000-000000000321' },
      ],
    })
    const payload = screen.getByRole<HTMLTextAreaElement>('textbox', {
      name: 'Notification 1 payload',
    })
    fireEvent.change(payload, { target: { value: '{"value":' } })
    expect(payload.value).toBe('{"value":')
    expect(
      screen.getByRole<HTMLButtonElement>('button', {
        name: 'Save first draft',
      }).disabled,
    ).toBe(true)
    fireEvent.change(payload, {
      target: { value: '{"value":{"$ref":"previous.0.value"}}' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save first draft' }))
    await waitFor(() =>
      expect(createPipelineDefinitionVersion).toHaveBeenCalled(),
    )
    expect(
      vi.mocked(createPipelineDefinitionVersion).mock.calls[0][1].configuration
        .notifications,
    ).toEqual([
      {
        subscriptionId: '00000000-0000-4000-8000-000000000321',
        payload: { value: { $ref: 'previous.0.value' } },
      },
    ])
  })
  it('preserves analysis code when disabled and restored', () => {
    setup()
    fireEvent.change(screen.getByLabelText('Analysis step language'), {
      target: { value: 'none' },
    })
    expect(
      screen.queryByRole('textbox', { name: 'Analysis step code' }),
    ).toBeNull()
    fireEvent.change(screen.getByLabelText('Analysis step language'), {
      target: { value: 'python' },
    })
    expect(
      screen.getByRole<HTMLTextAreaElement>('textbox', {
        name: 'Analysis step code',
      }).value,
    ).toBe(initial.transform.statement)
  })
  it('keeps incomplete action arguments and blocks saving', () => {
    setup({
      ...initial,
      actions: [
        { name: 'create', operation: 'create_model_record', arguments: {} },
      ],
    })
    const argumentsInput = screen.getByRole<HTMLTextAreaElement>('textbox', {
      name: 'Action 1 arguments',
    })
    fireEvent.change(argumentsInput, { target: { value: '{"p_title":' } })
    expect(argumentsInput.value).toBe('{"p_title":')
    expect(
      screen.getByRole<HTMLButtonElement>('button', {
        name: 'Save first draft',
      }).disabled,
    ).toBe(true)
  })

  it('preserves published Python and steps when starting a draft and switching languages', async () => {
    setup()
    const code = screen.getByRole<HTMLTextAreaElement>('textbox', {
      name: 'Analysis step code',
    })
    expect(code.value).toContain('def transform')
    fireEvent.change(screen.getByLabelText('Analysis step language'), {
      target: { value: 'sql' },
    })
    expect(code.value).toContain('def transform')
    fireEvent.change(screen.getByLabelText('Analysis step language'), {
      target: { value: 'python' },
    })
    fireEvent.click(
      screen.getByRole<HTMLButtonElement>('button', {
        name: 'Save first draft',
      }),
    )
    await waitFor(() =>
      expect(createPipelineDefinitionVersion).toHaveBeenCalled(),
    )
    const payload = vi.mocked(createPipelineDefinitionVersion).mock.calls[0][1]
      .configuration
    expect(payload).toMatchObject({
      transform: initial.transform,
      steps: initial.steps,
      inputs: [],
      output: { mode: 'none' },
    })
  })
  it('reorders and removes additional steps without replacing code', () => {
    setup({
      ...initial,
      steps: [
        ...initial.steps,
        {
          name: 'finish',
          language: 'python',
          statement: 'def transform(inputs, parameters):\n    return []',
        },
      ],
    })
    fireEvent.click(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Move step 3 up' }),
    )
    expect(screen.getByLabelText<HTMLInputElement>('Step 2 name').value).toBe(
      'finish',
    )
    expect(
      screen.getByLabelText<HTMLInputElement>('Step 2 code').value,
    ).toContain('return []')
    fireEvent.click(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Remove step 2' }),
    )
    expect(screen.getByLabelText<HTMLInputElement>('Step 2 name').value).toBe(
      'clean',
    )
  })
  it('keeps incomplete mapping text and prevents saving until corrected', () => {
    setup({
      ...initial,
      output: {
        mode: 'append',
        datasetId: '00000000-0000-4000-8000-000000000001',
        datasetLabel: 'result',
      },
    })
    const mapping = screen.getByLabelText<HTMLTextAreaElement>('Field mapping')
    fireEvent.change(mapping, { target: { value: '{"value":' } })
    expect(mapping.value).toBe('{"value":')
    expect(
      screen.getByRole<HTMLButtonElement>('button', {
        name: 'Save first draft',
      }).disabled,
    ).toBe(true)
    fireEvent.change(mapping, { target: { value: '{"value":"value"}' } })
    expect(
      screen.getByRole<HTMLButtonElement>('button', {
        name: 'Save first draft',
      }).disabled,
    ).toBe(false)
  })
})
