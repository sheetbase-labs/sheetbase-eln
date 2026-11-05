import type { Meta, StoryObj } from '@storybook/tanstack-react'

import {
  AnnotatedImage,
  AnnotationMarks,
} from '#/components/notebook/annotated-image'
import type { ImageAnnotation } from '#/lib/image-annotations'

/**
 * A notebook image with its marks drawn above it. The picture is an inline SVG
 * of a gel, so the story needs no file; the marks are positions as fractions of
 * the image, so they hold at any size.
 */
const GEL = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="560" height="320" viewBox="0 0 560 320">
    <rect width="560" height="320" fill="#1b2433"/>
    ${[0.15, 0.3, 0.45, 0.6, 0.75, 0.9]
      .map(
        (x, i) =>
          `<rect x="${x * 560 - 22}" y="${70 + i * 6}" width="44" height="10" rx="3" fill="#d8e2f0" opacity="0.85"/>
           <rect x="${x * 560 - 22}" y="${170 - i * 8}" width="44" height="8" rx="3" fill="#d8e2f0" opacity="0.55"/>`,
      )
      .join('')}
  </svg>`,
)}`

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
