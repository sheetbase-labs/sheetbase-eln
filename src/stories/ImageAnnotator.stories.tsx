import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { Button } from '#/components/ui/button'
import { ImageAnnotator } from '#/components/notebook/image-annotator'
import type { ImageAnnotation } from '#/lib/image-annotations'

import { GEL } from './gel-fixture'

/**
 * The annotate dialog for a notebook image. It saves only the marks, so the
 * story's save resolves without writing anything. The dialog is portalled, so
 * each story holds it open from a trigger the story owns.
 */

const marked: ImageAnnotation[] = [
  { id: 'l1', kind: 'lane', x: 0.15, text: 'Ladder', color: 'yellow' },
  {
    id: 'a1',
    kind: 'arrow',
    x1: 0.5,
    y1: 0.2,
    x2: 0.4,
    y2: 0.45,
    color: 'red',
  },
  { id: 't1', kind: 'label', x: 0.55, y: 0.18, text: 'Target', color: 'cyan' },
]

function Harness({ initial }: { initial: ImageAnnotation[] }) {
  const [open, setOpen] = useState(true)

  return (
    <>
      <Button onClick={() => setOpen(true)}>Annotate image</Button>
      <ImageAnnotator
        open={open}
        onOpenChange={setOpen}
        src={GEL}
        name="gel-2026-10-04.png"
        initial={initial}
        onSave={async () => {
          setOpen(false)
        }}
      />
    </>
  )
}

const meta = {
  title: 'Notebook/Image annotator',
  component: ImageAnnotator,
  tags: ['autodocs'],
  args: {
    open: true,
    onOpenChange: () => {},
    src: GEL,
    name: 'gel-2026-10-04.png',
    initial: [],
    onSave: async () => {},
  },
} satisfies Meta<typeof ImageAnnotator>

export default meta

type Story = StoryObj<typeof meta>

/** A new image: no marks yet. */
export const Empty: Story = { render: () => <Harness initial={[]} /> }

/** An image that already carries arrows, a label and a lane name. */
export const WithMarks: Story = { render: () => <Harness initial={marked} /> }
