import React from 'react'
import type { Preview } from '@storybook/react-vite'

import '../src/styles.css'

const preview: Preview = {
  parameters: {
    layout: 'centered',
    controls: { expanded: true },
    backgrounds: {
      default: 'sheetbase',
      values: [
        { name: 'sheetbase', value: '#fbfcfe' },
        { name: 'dark', value: '#181a20' },
      ],
    },
  },
  globalTypes: {
    theme: {
      description: 'Sheetbase color theme',
      defaultValue: 'light',
      toolbar: {
        icon: 'paintbrush',
        items: [
          { value: 'light', title: 'Light' },
          { value: 'dark', title: 'Dark' },
        ],
      },
    },
  },
  decorators: [
    (Story, context) => {
      const dark = context.globals.theme === 'dark'
      return React.createElement(
        'div',
        {
          className: `${dark ? 'dark' : ''} min-h-screen min-w-[320px] bg-background p-6 text-foreground`,
        },
        React.createElement(Story),
      )
    },
  ],
}

export default preview
