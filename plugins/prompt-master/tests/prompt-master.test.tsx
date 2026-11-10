import { expect, test } from 'claude-code/testing'

const USAGE = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

const BAND = {
  plugin: 'prompt-master',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 9 },
    view: {},
  },
} as const

test('the button rewrites the draft in the box', async ($, on) => {
  let filled = ''
  on('model.complete', () => ({ value: { isAnswered: true, text: 'BETTER PROMPT', usage: USAGE } }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('prompt.read', () => ({ value: { text: 'fix bug pls', cursor: 11 } }))
  on('prompt.fill', (_, e) => {
    filled = e.text
    return { isFilled: true }
  })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ type: 'Button', key: 'master' })) !== undefined).toBe(true)
  await ui.press({ key: 'master' })
  expect(filled).toBe('BETTER PROMPT')
  await ui.unmount()
})

test('with no reachable draft, one click arms the next prompt', async ($, on) => {
  on('model.complete', () => ({ value: { isAnswered: true, text: 'BETTER PROMPT', usage: USAGE } }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('prompt.submit', (_, e) => ({ text: e.text }))

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'master' })
  await ui.unmount()

  const sent = await $.prompt.submit({ text: 'fix bug pls', origin: { kind: 'composer' }, wait: false } as any)
  expect((sent as any).text).toBe('BETTER PROMPT')
  // Only once.
  const again = await $.prompt.submit({ text: 'second', origin: { kind: 'composer' }, wait: false } as any)
  expect((again as any).text).toBe('second')
})
