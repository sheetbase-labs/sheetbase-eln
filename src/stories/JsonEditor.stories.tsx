import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { useState } from 'react'

import { JsonEditor } from '#/components/code-editor/json-editor'

const meta = {
  title: 'Components/JsonEditor',
  component: JsonEditor,
} satisfies Meta<typeof JsonEditor>

export default meta

type Story = StoryObj<typeof meta>

const GOOD = '{\n  "project": "P-12",\n  "limit": 50,\n  "active": true\n}'

/** JSON coloured as it is typed. */
export const Valid: Story = {
  args: { value: GOOD, ariaLabel: 'Body' },
  render: function Render() {
    const [value, setValue] = useState(GOOD)

    return (
      <JsonEditor
        ariaLabel="Body"
        value={value}
        onChange={setValue}
        accepts="object"
      />
    )
  },
}

const BROKEN = '{\n  "project": "P-12",\n  "limit": ,\n}'

/** A mistake is marked on its line with a note under it. */
export const Broken: Story = {
  args: { value: BROKEN, ariaLabel: 'Body' },
  render: function Render() {
    const [value, setValue] = useState(BROKEN)

    return (
      <JsonEditor
        ariaLabel="Body"
        value={value}
        onChange={setValue}
        accepts="object"
      />
    )
  },
}
