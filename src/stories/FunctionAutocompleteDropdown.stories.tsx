import { useRef } from 'react'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { FunctionAutocompleteDropdown } from '#/components/sheet/function-autocomplete'
import { getFunctionSuggestions } from '#/lib/function-descriptions'

/**
 * The formula function dropdown. It is a controlled list: the hook owns the
 * query, the cursor and the keyboard handling, and the dropdown renders
 * whatever suggestions it is handed — so the stories pass the same
 * suggestions `getFunctionSuggestions` produces.
 */
const suggestions = getFunctionSuggestions('AV', 8)

function Harness({
  activeIndex,
  list,
}: {
  activeIndex: number
  list: typeof suggestions
}) {
  const listRef = useRef<HTMLDivElement | null>(null)
  return (
    <div className="w-[420px] space-y-2">
      <input
        defaultValue="=AV"
        aria-label="Formula"
        className="w-full rounded-md border px-2 py-1 font-mono text-sm"
      />
      <div className="relative">
        <FunctionAutocompleteDropdown
          suggestions={list}
          activeIndex={activeIndex}
          listRef={listRef}
          onSelect={() => {}}
        />
      </div>
    </div>
  )
}

const meta = {
  title: 'Sheet/Function autocomplete dropdown',
  component: FunctionAutocompleteDropdown,
  tags: ['autodocs'],
  args: {
    suggestions,
    activeIndex: 0,
    listRef: { current: null },
    onSelect: () => {},
  },
} satisfies Meta<typeof FunctionAutocompleteDropdown>
export default meta
type Story = StoryObj<typeof meta>

/** Suggestions for the typed prefix, with the first row highlighted. */
export const Default: Story = {
  render: () => <Harness activeIndex={0} list={suggestions} />,
}

/** Arrow keys move the highlight without inserting. */
export const KeyboardHighlight: Story = {
  render: () => (
    <Harness
      activeIndex={Math.max(0, suggestions.length - 1)}
      list={suggestions}
    />
  ),
}

/** No prefix match: the dropdown renders nothing, so the editor's own
 * placeholder stays visible behind it. */
export const NoSuggestions: Story = {
  render: () => <Harness activeIndex={-1} list={[]} />,
}
