import type { StorybookConfig } from '@storybook/tanstack-react'

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(js|jsx|mjs|ts|tsx)'],
  framework: { name: '@storybook/tanstack-react', options: {} },
  docs: { autodocs: 'tag' },
}
export default config
