import type { Meta, StoryObj } from '@storybook/tanstack-react'

import {
  AnnotatedImage,
  AnnotationMarks,
} from '#/components/notebook/annotated-image'
import type { ImageAnnotation } from '#/lib/image-annotations'

import { GEL } from './gel-fixture'

/**
 * A notebook image with its marks drawn above it. The picture is an inline SVG
 * of a gel, so the story needs no file; the marks are positions as fractions of
 * the image, so they hold at any size.
 */

const annotations: ImageAnnotation[] = [
  { id: 'l1', kind: 'lane', x: 0.15, text: 'Ladder', color: 'yellow' },
  { id: 'l2', kind: 'lane', x: 0.3, text: 'Input', color: 'white' },
  { id: 'l3', kind: 'lane', x: 0.45, text: 'Flow-through', color: 'cyan' },
  {
    id: 'a1',
    kind: 'arrow',
    x1: 0.62,
    y1: 0.2,
    x2: 0.72,
    y2: 0.42,
    color: 'red',
  },
  {
    id: 't1',
    kind: 'label',
    x: 0.5,
    y: 0.14,
    text: 'Cleaved band',
    color: 'red',
  },
]

const meta = {
  title: 'Notebook/Annotated image',
  component: AnnotatedImage,
  tags: ['autodocs'],
  args: { src: GEL, alt: 'Agarose gel', annotations },
} satisfies Meta<typeof AnnotatedImage>

export default meta

type Story = StoryObj<typeof meta>

/** Arrows, a label and three lane names over the image. */
export const Annotated: Story = {}

/** No marks: the image alone, with no lane strip. */
export const Plain: Story = { args: { annotations: [] } }

/** Only lane names: the strip sits above the image. */
export const LanesOnly: Story = {
  args: { annotations: annotations.filter((a) => a.kind === 'lane') },
}

/** The mark layer on its own, at the image's size. */
export const MarksLayer: Story = {
  render: () => (
    <svg
      viewBox="0 0 560 320"
      className="w-[560px] max-w-full rounded-md border bg-surface-muted"
    >
      <AnnotationMarks annotations={annotations} size={{ w: 560, h: 320 }} />
    </svg>
  ),
}
