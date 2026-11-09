import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '#/components/assist/chat/conversation'
import {
  Message,
  MessageActions,
  MessageContent,
  MessageResponse,
} from '#/components/assist/chat/message'
import { PromptBox } from '#/components/assist/chat/prompt-box'
import { Button } from '#/components/ui/button'

/**
 * The assistant chat's building blocks, after the AI Elements `Conversation`,
 * `Message` and `PromptInput`. The person's words sit in a soft bubble on the
 * right and the assistant's answer runs flat on the page as Markdown. The
 * message box grows with the text, sends on Enter, takes a new line on
 * Shift+Enter, and its send button becomes a stop button while an answer is on
 * its way.
 */
const meta = {
  title: 'Assistant/Chat primitives',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

const ANSWER = `Two of the three runs are within range.

- **Run 1** titre 4.1e6 PFU/mL
- **Run 2** titre 3.9e6 PFU/mL
- **Run 3** titre 2.2e6 PFU/mL, below the 3e6 limit

Run 3 is the one to look at first.`

export const Turns: Story = {
  render: () => (
    <div className="flex h-[480px] w-[440px] flex-col border border-border">
      <Conversation>
        <ConversationContent>
          <Message from="user">
            <MessageContent>Which runs are out of range?</MessageContent>
          </Message>
          <Message from="assistant">
            <MessageContent>
              <MessageResponse>{ANSWER}</MessageResponse>
            </MessageContent>
            <MessageActions>
              <Button size="sm" variant="quiet">
                Copy
              </Button>
            </MessageActions>
          </Message>
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
    </div>
  ),
}

/** Long enough to scroll: scroll up and the way back down appears. */
export const ScrollsToLatest: Story = {
  render: () => (
    <div className="flex h-[320px] w-[440px] flex-col border border-border">
      <Conversation>
        <ConversationContent>
          {Array.from({ length: 8 }, (_, index) => (
            <div key={index} className="flex flex-col gap-3">
              <Message from="user">
                <MessageContent>Question {index + 1}</MessageContent>
              </Message>
              <Message from="assistant">
                <MessageContent>
                  <MessageResponse>{`Answer ${index + 1}: ${ANSWER.split('\n')[0]}`}</MessageResponse>
                </MessageContent>
              </Message>
            </div>
          ))}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
    </div>
  ),
}

function Box(props: { busy?: boolean; disabled?: boolean; initial?: string }) {
  const [value, setValue] = useState(props.initial ?? '')

  return (
    <div className="w-[420px]">
      <PromptBox
        value={value}
        onChange={setValue}
        onSubmit={() => setValue('')}
        onStop={() => {}}
        busy={props.busy ?? false}
        disabled={props.disabled ?? false}
        placeholder="Ask about this page"
      />
    </div>
  )
}

export const PromptEmpty: Story = { render: () => <Box /> }

export const PromptWithText: Story = {
  render: () => (
    <Box
      initial={'Which runs are out of range?\nAnd which analyst ran them?'}
    />
  ),
}

/** An answer is on its way: the send button is a stop button. */
export const PromptBusy: Story = {
  render: () => <Box busy initial="Summarise the week" />,
}

/** AI is not ready for the workspace, so the box is off. */
export const PromptDisabled: Story = { render: () => <Box disabled /> }
