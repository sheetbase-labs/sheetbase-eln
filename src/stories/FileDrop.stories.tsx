import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { expect, userEvent, within } from 'storybook/test'

import { FileDrop } from '#/components/v3/ui/file-drop'

/**
 * `FileDrop` — the app's pick-and-drop file field (ADR-0055; ReUI's
 * `@reui/use-file-upload` with Sheetbase's tokens and the caller's transport).
 *
 * The default story is the field at rest. The others pick a file through the
 * same hidden input the "Choose file" button opens, so each row state is a real
 * state of this component rather than mocked markup, and a failure is a real
 * rejected transport. Nothing here needs business data: the file is a literal
 * `File` and the transport is a story-local promise.
 */

const CSV = new File(['sample,value\nA,1.2\n'], 'plate-01.csv', {
  type: 'text/csv',
})

/** Pick `file` through the field's own input, as a person does. */
async function pick(canvasElement: HTMLElement, file: File = CSV) {
  const canvas = within(canvasElement)
  await userEvent.upload(await canvas.findByLabelText('Laboratory file'), file)
}

/**
 * Drop `file` on the drop target — how a dragged file arrives, and the one
 * route the input's `accept` does not filter, since a browser applies `accept`
 * to the dialog and not to a drop. The story dispatches the event itself: a
 * story runner has no pointer, so nothing else can produce a drag.
 */
function drop(canvasElement: HTMLElement, file: File) {
  const transfer = new DataTransfer()
  transfer.items.add(file)
  const zone = canvasElement.querySelector('[data-slot="file-drop"]')
  if (!zone) throw new Error('no drop target')
  zone.dispatchEvent(
    new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer,
    }),
  )
}

const meta = {
  title: 'UI/FileDrop',
  component: FileDrop,
  tags: ['autodocs'],
  args: {
    label: 'Laboratory file',
    inputLabel: 'Laboratory file',
    hint: 'CSV, TSV, Excel, JSON or plain text, stored unchanged with its SHA-256 hash.',
    accept: '.csv,.tsv,.txt,.json,.xlsx',
    onFile: () => {},
    className: 'max-w-[420px]',
  },
} satisfies Meta<typeof FileDrop>
export default meta
type Story = StoryObj<typeof meta>

/** At rest: the drop target, with nothing picked yet. */
export const Default: Story = {}

/** A pick in flight: the row carries the field's progress while it runs. */
export const Uploading: Story = {
  // A transport that never settles is the only honest way to hold this state
  // for a reader; it is what a slow store looks like.
  args: { onFile: () => new Promise<void>(() => {}) },
  play: async ({ canvasElement }) => {
    await pick(canvasElement)
    await expect(
      within(canvasElement).getByRole('progressbar'),
    ).toBeInTheDocument()
  },
}

/** Stored: the transport resolved and the row says so. */
export const Uploaded: Story = {
  args: { onFile: async () => {} },
  play: async ({ canvasElement }) => {
    await pick(canvasElement)
    await expect(
      await within(canvasElement).findByText('Uploaded'),
    ).toBeInTheDocument()
  },
}

/** Refused by the caller's own validation: the pick never leaves the browser. */
export const Refused: Story = {
  args: {
    validate: () => ({
      ok: false,
      message:
        'Files of type "application/pdf" are not allowed. Upload CSV, TSV, Excel, JSON or plain text.',
    }),
  },
  play: async ({ canvasElement }) => {
    drop(
      canvasElement,
      new File(['%PDF-1.7'], 'instrument-export.pdf', {
        type: 'application/pdf',
      }),
    )
    await expect(
      await within(canvasElement).findByText(/not allowed/),
    ).toBeInTheDocument()
  },
}

/** The transport rejected: the message and its retry sit on the row. */
export const Failed: Story = {
  args: {
    onFile: async () => {
      throw new Error('The file store refused this file.')
    },
  },
  play: async ({ canvasElement }) => {
    await pick(canvasElement)
    const retry = await within(canvasElement).findByRole('button', {
      name: 'Retry plate-01.csv',
    })
    await expect(
      within(canvasElement).getByText('The file store refused this file.'),
    ).toBeInTheDocument()
    await expect(retry).toBeInTheDocument()
  },
}
