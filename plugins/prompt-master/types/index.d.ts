/** off: do nothing; once: rewrite the next prompt you send; auto: rewrite every prompt. */
export type Mode = 'off' | 'once' | 'auto'

declare module 'claude-code' {
  interface PluginState {
    'prompt-master': { mode: Mode; isBusy: boolean; lastOriginal: string | null }
  }
}
