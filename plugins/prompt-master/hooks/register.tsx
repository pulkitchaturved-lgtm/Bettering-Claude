import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Mode } from '../types'

const PANE = 'prompt-master'

const mode = atom({ plugin: 'prompt-master', key: 'mode' } as const, 'off' as Mode)
const isBusy = atom({ plugin: 'prompt-master', key: 'isBusy' } as const, false)
const lastOriginal = atom({ plugin: 'prompt-master', key: 'lastOriginal' } as const, null as string | null)

const SYSTEM = `You are Prompt Master, an expert prompt engineer. You receive a prompt a person is about to send to Claude, an AI assistant that is often working as a coding agent inside their project.

Rewrite it into the strongest version of the SAME request:
- Keep the person's intent, scope, facts, names, file paths, code, numbers and constraints exactly. Never invent requirements, details or context they did not give.
- State the goal clearly up front, then the relevant context, constraints and what a good result looks like (the deliverable / definition of done), when the original implies them.
- Fix spelling and grammar, remove ambiguity, and turn vague phrasing into specific, actionable instructions.
- Use a short bulleted list only when the request has several distinct parts; keep simple requests short. Do not pad.
- Write in the person's own voice (first person, addressed to Claude), in the same language they used.

Output ONLY the rewritten prompt: no preamble, no explanation, no quotes, no markdown fences around it. Do NOT answer or carry out the prompt.`

async function rewrite($: EngineInterface, text: string): Promise<string | null> {
  await update($, isBusy, () => true)
  $.ui.status('Prompt Master: rewriting…')
  try {
    const r = await $.model.complete({
      model: 'sonnet',
      system: SYSTEM,
      prompt: `<prompt_to_rewrite>\n${text}\n</prompt_to_rewrite>`,
      maxTokens: 4000,
      timeoutMs: 60_000,
    })
    if (!r.isAnswered) {
      $.ui.toast(`Prompt Master could not rewrite (${r.reason}); your prompt was left as is.`)
      return null
    }
    const out = r.text.trim()
    return out.length > 0 ? out : null
  } finally {
    await update($, isBusy, () => false)
    await showStatus($)
  }
}

async function showStatus($: EngineInterface) {
  const m = await read($, mode)
  $.ui.status(m === 'auto' ? 'Prompt Master: auto' : m === 'once' ? 'Prompt Master: next prompt' : undefined)
}

/** The one-click action: rewrite the draft in the box, else arm the next prompt. */
async function masterClick($: EngineInterface) {
  if (await read($, isBusy)) return
  const box = await $.prompt.read()
  const draft = box.text.trim()
  if (draft.length > 0) {
    const better = await rewrite($, draft)
    if (better === null) return
    const filled = await $.prompt.fill({ text: better, mode: 'replace' })
    if (filled.isFilled) {
      await update($, lastOriginal, () => box.text)
      $.ui.toast('✨ Prompt rewritten. Review it and press Enter to send (Undo button restores yours).')
      return
    }
  }
  // No draft we can reach (empty box, or an app that draws its own composer):
  // rewrite the next prompt as it is sent.
  await update($, mode, m => (m === 'auto' ? 'auto' : 'once'))
  await showStatus($)
  $.ui.toast('✨ Prompt Master armed: your next message will be rewritten before it is sent.')
}

async function undo($: EngineInterface) {
  const original = await read($, lastOriginal)
  if (original === null) return
  await $.prompt.fill({ text: original, mode: 'replace' })
  await update($, lastOriginal, () => null)
}

async function toggleAuto($: EngineInterface) {
  await update($, mode, m => (m === 'auto' ? 'off' : 'auto'))
  await showStatus($)
}

async function disarm($: EngineInterface) {
  await update($, mode, () => 'off')
  await showStatus($)
}

function Controls($: EngineInterface, ui: ReturnType<EngineInterface['ui']['resolve']>, m: Mode, busy: boolean, canUndo: boolean) {
  const { Box, Button, Text } = ui
  return (
    <Box flexDirection="row" gap={1}>
      <Button key="master" variant="primary" label={busy ? '✨ Rewriting…' : '✨ Prompt Master'} onPress={() => masterClick($)} />
      <Button key="auto" label={m === 'auto' ? 'Auto: ON' : 'Auto: off'} onPress={() => toggleAuto($)} />
      {m === 'once' && <Button key="disarm" label="Cancel" onPress={() => disarm($)} />}
      {canUndo && <Button key="undo" label="Undo" onPress={() => undo($)} />}
      {m === 'once' && <Text dimColor>next prompt will be rewritten</Text>}
    </Box>
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'prompt-master',
      description: 'Prompt Master: rewrite your draft (or the given text), or open its button pane',
    })
    await $.command.register({
      name: 'prompt-master-auto',
      description: 'Prompt Master: toggle rewriting every prompt automatically',
    })
    await showStatus($)
    return next(e)
  })

  // Phones get no band above the prompt, so give them the button in a pane.
  on('session.attach', { surface: 'mobile' }, async ($, e, next) => {
    void $.ui.open({ id: PANE, title: '✨ Prompt Master' })
    return next(e)
  })

  on('command.run', { command: 'prompt-master' }, async ($, e) => {
    const text = e.args.trim()
    if (text.length === 0) {
      await $.ui.open({ id: PANE, title: '✨ Prompt Master' })
      await masterClick($)
      return { text: 'Prompt Master is ready.' }
    }
    const better = await rewrite($, text)
    if (better === null) return { text: 'Prompt Master could not rewrite that.' }
    const filled = await $.prompt.fill({ text: better, mode: 'replace' })
    return {
      text: filled.isFilled
        ? '✨ Rewritten prompt is in your input box. Review it and press Enter.'
        : `✨ Rewritten prompt:\n\n${better}`,
    }
  })

  on('command.run', { command: 'prompt-master-auto' }, async $ => {
    await toggleAuto($)
    const m = await read($, mode)
    return { text: m === 'auto' ? 'Prompt Master auto mode ON: every prompt is rewritten before it is sent.' : 'Prompt Master auto mode OFF.' }
  })

  // Rewrite at send time when armed (once) or in auto mode.
  on('prompt.submit', async ($, e, next) => {
    const m = await read($, mode)
    const isPersonTyped = e.origin.kind === 'composer' || e.origin.kind === 'bridge'
    if (m === 'off' || e.command || e.isMeta || !isPersonTyped || e.text.trim().length === 0) {
      return next(e)
    }
    if (m === 'once') await update($, mode, () => 'off')
    const better = await rewrite($, e.text).catch(() => null)
    if (better === null) return next(e)
    $.ui.toast('✨ Prompt Master rewrote your prompt.')
    return next({ ...e, text: better })
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const ui = $.ui.resolve(e)
    return Controls($, ui, await read($, mode), await read($, isBusy), (await read($, lastOriginal)) !== null)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text } = ui
    return (
      <Box flexDirection="column" gap={1}>
        <Text dimColor>Tap Prompt Master, then send your message: it is rewritten into a sharper prompt first.</Text>
        {Controls($, ui, await read($, mode), await read($, isBusy), (await read($, lastOriginal)) !== null)}
      </Box>
    )
  })
}
