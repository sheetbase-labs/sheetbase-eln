import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { useState } from 'react'

import { CodeEditor } from '#/components/code-editor/code-editor'
import { fileTokens } from '#/lib/pipelines/version-file-highlight'
import { hintsAt } from '#/lib/pipelines/version-file-hints'

const meta = {
  title: 'Components/CodeEditor',
  component: CodeEditor,
} satisfies Meta<typeof CodeEditor>

export default meta

type Story = StoryObj<typeof meta>

const FILE = `pipeline: PL-0021
version: 2
mode: advanced
steps:
  - id: yield
    sql: |
      SELECT fraction, yeild FROM measurements
output: { mode: none }
`

/** The pipeline version file: coloured, a mistake marked on its line with a fix, and key suggestions. */
export const VersionFile: Story = {
  args: { value: FILE, ariaLabel: 'Pipeline file' },
  render: function Render() {
    const [value, setValue] = useState(FILE)

    return (
      <CodeEditor
        ariaLabel="Pipeline file"
        value={value}
        onChange={setValue}
        highlight={fileTokens}
        indentAfter={/(:|\|[-+]?)\s*$/}
        problems={[
          {
            line: 7,
            column: 31,
            length: 5,
            title: 'Line 7',
            message: 'Unknown column yeild in this step’s input.',
            fix: {
              label: 'Change to yield',
              run: () => setValue(value.replace('yeild', 'yield')),
            },
          },
        ]}
        suggest={(text, line, column) => {
          const found = hintsAt(text, line, column)

          return found
            ? {
                prefixLength: found.prefix.length,
                options: found.keys.slice(0, 6).map((key) => ({
                  label: key,
                  insert: `${key}: `,
                })),
              }
            : null
        }}
      />
    )
  },
}

/** Without line numbers, as in a SQL or Python field. */
export const Plain: Story = {
  args: { value: 'select 1', ariaLabel: 'Code' },
  render: function Render() {
    const [value, setValue] = useState('select 1')

    return (
      <CodeEditor
        ariaLabel="Code"
        value={value}
        onChange={setValue}
        lineNumbers={false}
        minHeight="120px"
      />
    )
  },
}
