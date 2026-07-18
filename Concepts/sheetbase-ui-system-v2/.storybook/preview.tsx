import type { Preview } from '@storybook/react-vite'
import '../src/styles.css'

const preview: Preview = {
  parameters: {
    layout: 'centered',
    controls: { expanded: true },
    backgrounds: { default: 'sheetbase', values: [{ name: 'sheetbase', value: '#fbfcfe' }, { name: 'dark', value: '#181a20' }] },
  },
  decorators: [(Story) => <div className="min-w-[320px] bg-background p-6 text-foreground"><Story /></div>],
}
export default preview
