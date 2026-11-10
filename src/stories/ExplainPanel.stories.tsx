import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { AiExplainPanel } from '#/components/assist/ai-explain-panel'
import { ExplainPanel } from '#/components/assist/explain-panel'
import { explainBlockValidation } from '#/lib/assist-explain'
import type { AssistExplanation } from '#/lib/assist-explain'
import { AI_WORKSPACE_ID, withPageAi } from './assist-fixtures'

/**
 * A grounded explanation (ASSIST-01): what failed, why (one cited claim per rule
 * hit), how to resolve and the cited sources. The grounded facts are primary;
 * model phrasing renders in a clearly marked block under them. The panel never
 * writes anything.
 */
const EXPLANATION = explainedFixture({
  blockType: 'rich_text',
  errors: [
    {
      code: 'missing_required_field',
      field: 'content',
      message: 'content is required',
    },
    { code: 'invalid_payload_shape', message: 'payload must be an object' },
  ],
})

function explainedFixture(
  input: Parameters<typeof explainBlockValidation>[0],
): AssistExplanation {
  const explanation = explainBlockValidation(input)

  if (!explanation)
    throw new Error('The explain panel fixture must carry a validation error.')

  return explanation
}

const meta = {
  title: 'Assistant/Explain panel',
  component: ExplainPanel,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: { explanation: EXPLANATION },
  decorators: [
    (Story) => (
      <div className="w-[420px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ExplainPanel>

export default meta

type Story = StoryObj<typeof meta>

/** Facts only, which is how it reads with AI off. */
export const Grounded: Story = {}

/** With the workspace model's plain-words rewording underneath, marked as such. */
export const WithPhrasing: Story = {
  args: {
    phrasing: {
      model: 'workspace-model',
      assistance: true,
      text: 'The block has no content, and what was sent is not the shape a text block needs. Add some text and save again.',
    },
  },
}

/** The mounted panel with AI on: the facts show at once and the rewording follows. */
export const WithAi: Story = {
  decorators: [
    withPageAi('live', [
      {
        key: [
          'page-ai',
          'explain',
          AI_WORKSPACE_ID,
          `${EXPLANATION.title}|${EXPLANATION.whatFailed}|${EXPLANATION.why.map((claim) => claim.text).join('|')}`,
        ],
        value: {
          model: 'workspace-model',
          assistance: true,
          text: 'The text block is empty and malformed. Add text, then save.',
        },
      },
    ]),
  ],
  render: () => <AiExplainPanel explanation={EXPLANATION} />,
}

/** The mounted panel with AI off: exactly the facts. */
export const WithAiOff: Story = {
  decorators: [withPageAi('off')],
  render: () => <AiExplainPanel explanation={EXPLANATION} />,
}
