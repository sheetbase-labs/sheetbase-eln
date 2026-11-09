import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import {
  OfficeEditButton,
  OfficeViewer,
} from '#/components/notebook/office-editor'

import { holdRead, screenQueryClient } from './screen-stories'

/**
 * The optional browser Office editor. The workspace switch is one read, which a
 * story seeds; the editor and the viewer would open a Collabora frame, which a
 * story never reaches, so the viewer shows the state it holds while it waits.
 */
const STATUS_KEY = ['office-editor', 'status'] as const

const on = screenQueryClient({
  data: [
    { key: STATUS_KEY, value: { enabled: true } },
    { key: [...STATUS_KEY, 'live'], value: true },
  ],
})

holdRead(on, ['office-editor', 'view', 'file-1', 1])

const off = screenQueryClient({
  data: [{ key: STATUS_KEY, value: { enabled: false } }],
})

const meta = {
  title: 'Notebook/Office editor',
  component: OfficeEditButton,
  tags: ['autodocs'],
  args: { fileRecordId: 'file-1', fileName: 'protocol.docx' },
  decorators: [
    (Story, context) => (
      <QueryClientProvider
        client={
          context.parameters.client as ReturnType<typeof screenQueryClient>
        }
      >
        <div className="w-[640px] max-w-full">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
} satisfies Meta<typeof OfficeEditButton>

export default meta

type Story = StoryObj<typeof meta>

/** The editor is switched on and the file is one it opens. */
export const Enabled: Story = { parameters: { client: on } }

/** The workspace has not switched the editor on: the button is absent. */
export const Disabled: Story = { parameters: { client: off } }

/** A file the editor cannot open: the button is absent. */
export const UnsupportedFile: Story = {
  parameters: { client: on },
  args: { fileName: 'scan.png' },
}

/** The in-block viewer while its session starts. */
export const Viewer: Story = {
  parameters: { client: on },
  render: () => <OfficeViewer fileRecordId="file-1" version={1} />,
}
