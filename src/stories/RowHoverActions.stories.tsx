import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { RowAction, RowHoverActions } from '#/components/ui/row-hover-actions'

/** Hover the row: the date gives way to Open beside and Copy link. */
function Demo() {
  return (
    <table className="w-[480px] bg-surface text-body">
      <tbody>
        <tr className="h-9 hover:bg-row-hover">
          <td className="px-3">
            Harvest clarification: depth filter screening
          </td>
          <td className="w-24 px-3">
            <RowHoverActions
              actions={
                <>
                  <RowAction
                    icon="externalLink"
                    label="Open beside"
                    onClick={() => undefined}
                  />
                  <RowAction
                    icon="link"
                    label="Copy link"
                    onClick={() => undefined}
                  />
                </>
              }
            >
              <span className="text-fg-muted">23 Sep</span>
            </RowHoverActions>
          </td>
        </tr>
      </tbody>
    </table>
  )
}

const meta = {
  title: 'UI/Row hover actions',
  component: RowHoverActions,
  tags: ['autodocs'],
} satisfies Meta<typeof RowHoverActions>

export default meta

type Story = StoryObj<typeof meta>

export const InARow: Story = {
  args: { children: null, actions: null },
  render: () => <Demo />,
}
