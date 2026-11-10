import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { vi } from 'vitest'
import { z } from 'zod'
import { dropSharedReads } from '#/lib/data-client'
import type {
  SheetInstance,
  SheetInstanceWire,
} from '#/lib/sheet-instance-data'
import type { SheetInstanceCalculationResults } from '#/lib/sheet-local-data'
import { pipelineJsonObjectSchema } from '#/lib/pipelines/types'

const fetchTransport = vi.hoisted(() => {
  const transport = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', transport)

  return transport
})

type Body = z.infer<typeof pipelineJsonObjectSchema>

type Reply = object | Response | undefined

export const workspaceHttp = {
  rpc: vi.fn<(name: string, args: Body) => Promise<Reply>>(),
  list: vi.fn<(resource: string, query: string) => Promise<object[]>>(),
  local: vi.fn<(args: Body) => Promise<Reply>>(),
  update: vi.fn<(args: Body) => Promise<Reply>>(),
  calculations: vi.fn<() => Promise<SheetInstanceCalculationResults>>(),
}

export function instanceWire(instance: SheetInstance): SheetInstanceWire {
  return {
    id: instance.id,
    workspace_id: instance.workspaceId,
    project_id: instance.projectId,
    notebook_record_id: instance.notebookRecordId,
    source_definition_version_id: instance.sourceDefinitionVersionId,
    name: instance.name,
    description: instance.description,
    lifecycle: instance.lifecycle,
    revision: instance.revision,
    state: instance.state,
    duplicated_from_instance_id: instance.duplicatedFromInstanceId,
    created_at: instance.createdAt,
    updated_at: instance.updatedAt,
    created_by_user_id: instance.createdByUserId,
    updated_by_user_id: instance.updatedByUserId,
  }
}

export function resetWorkspaceHttp(instance: SheetInstance) {
  // jsdom lacks PointerEvent; preserve browser mouse coordinates for real grid drags.
  vi.stubGlobal('PointerEvent', MouseEvent)
  dropSharedReads()
  workspaceHttp.rpc.mockReset()
  workspaceHttp.list.mockReset().mockResolvedValue([])
  workspaceHttp.local.mockReset().mockResolvedValue(instanceWire(instance))
  workspaceHttp.update.mockReset().mockResolvedValue(instanceWire(instance))
  workspaceHttp.calculations.mockReset().mockResolvedValue({
    instanceId: instance.id,
    revision: instance.revision,
    results: [],
  })
  fetchTransport.mockReset().mockImplementation(async (input, init) => {
    const path = input instanceof Request ? input.url : input.toString()
    const url = new URL(path, 'http://sheet.test')

    if (url.pathname === '/api/sheet-calculations') {
      return Response.json({
        instanceId: instance.id,
        revision: instance.revision,
        rowCount: 1,
        calculationCount: 1,
        status: 'completed',
      })
    }

    if (!url.pathname.startsWith('/api/db/rpc/')) {
      return Response.json(
        await workspaceHttp.list(
          url.pathname.slice('/api/db/'.length),
          url.search,
        ),
      )
    }

    const name = url.pathname.slice('/api/db/rpc/'.length)

    const args = pipelineJsonObjectSchema.parse(
      JSON.parse(z.string().parse(init?.body)),
    )

    const result =
      name === 'mutate_sheet_instance_local_state'
        ? await workspaceHttp.local(args)
        : name === 'update_sheet_instance'
          ? await workspaceHttp.update(args)
          : name === 'read_sheet_instance_calculation_results'
            ? await workspaceHttp.calculations()
            : await workspaceHttp.rpc(name, args)

    return result instanceof Response ? result : Response.json(result ?? {})
  })
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(1200)
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(2400)
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1200)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(2400)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () => new DOMRect(0, 0, 1200, 2400),
  )
}

export async function mountWorkspace(
  ui: ReactElement,
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  }),
) {
  queryClient.setQueryDefaults(['user-names'], {
    initialData: {},
    staleTime: Infinity,
  })
  const routeTree = createRootRoute({ component: () => ui })

  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })

  await router.load()
  await act(async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )
  })
  await screen.findByRole('grid')

  return {
    queryClient,
    rerender: async (nextUi: ReactElement) => {
      routeTree.update({ component: () => nextUi })
      await act(async () => router.invalidate())
    },
  }
}

export function gridCell(row: number, column: number): HTMLElement {
  const cell = document.querySelector<HTMLElement>(
    `[role="gridcell"][aria-rowindex="${row + 1}"][aria-colindex="${column + 1}"]`,
  )

  if (!cell) throw new Error(`Missing cell ${row}:${column}`)

  return cell
}

export function selectGridCell(row: number, column: number, extend = false) {
  fireEvent.pointerDown(gridCell(row, column), { button: 0, shiftKey: extend })
}

export function pasteGrid(text: string) {
  fireEvent.paste(screen.getByRole('grid'), {
    clipboardData: { getData: () => text },
  })
}

export function columnHeader(index: number): HTMLElement {
  const header = screen.getAllByRole('columnheader').at(index)

  if (!header) throw new Error(`Missing column ${index}`)

  return header
}

export function openColumnMenu(index: number) {
  fireEvent.contextMenu(columnHeader(index), { clientX: 20, clientY: 20 })
}
