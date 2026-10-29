import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { ParserLayoutEditor } from '#/components/v3/settings/parser-layout-editor'
import type { ParserLayout } from '#/lib/import/parser-layout'

/**
 * How a parser reads a text file, with the sample-file preview. The sample is
 * dropped in the story, as it would be on the Instruments and parsers screen.
 */
const meta = {
  parameters: { tanstack: { router: { path: '/' } } },
  title: 'Settings/Parser layout',
  decorators: [
    (Story) => (
      <div className="w-[880px] max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

function Editor({ initial }: { initial: ParserLayout }) {
  const [layout, setLayout] = useState(initial)
  return (
    <ParserLayoutEditor
      value={layout}
      onChange={setLayout}
      onUseColumns={() => undefined}
    />
  )
}

/** Nothing described yet: a file is read as a plain table. */
export const Empty: Story = {
  render: () => <Editor initial={{}} />,
}

/** The TB-02 firmware 4 export: details, a later header, units, decimal commas. */
export const TurbidimeterExport: Story = {
  render: () => (
    <Editor
      initial={{
        delimiter: 'semicolon',
        headerStartsWith: 'Sample',
        readDetails: true,
        units: 'header',
        decimalComma: true,
      }}
    />
  ),
}
