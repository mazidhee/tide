/** What a notebook's kernel reports (main/notebook/kernel), as the window receives it */
export type KernelStateName = 'starting' | 'idle' | 'busy' | 'restarting' | 'dead'

export type KernelEventShape =
  | { type: 'status'; state: KernelStateName; detail?: string }
  | { type: 'input'; parent: string; count: number }
  | { type: 'output'; parent: string; output: Record<string, unknown> }
  | { type: 'clear'; parent: string; wait: boolean }
  | { type: 'update'; displayId: string; output: Record<string, unknown> }
  | { type: 'reply'; parent: string; status: 'ok' | 'error' | 'aborted'; count: number | null }
