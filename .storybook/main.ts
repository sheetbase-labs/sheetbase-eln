import type { StorybookConfig } from '@storybook/tanstack-react'

const config: StorybookConfig = {
  stories: [
    '../src/stories/*.stories.tsx',
    '../src/components/**/*.stories.tsx',
  ],
  framework: { name: '@storybook/tanstack-react', options: {} },
  docs: { autodocs: 'tag' },
}

export default config
