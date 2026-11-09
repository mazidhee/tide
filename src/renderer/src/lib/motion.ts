/**
 * Whether decoration should hold still: when the window is hidden, or while the model is working,
 * since the pixel scenes and shimmers draw with the same GPU Gemma runs on. Holding them still
 * makes answers come noticeably faster (about a third faster to write, a quarter faster to read a
 * long prompt, measured on an M4 Pro).
 */
export const motionPaused = () => document.hidden || document.documentElement.dataset.modelBusy === '1'

/** Follows the model's busy state for this window; call once */
export function followModelBusy(): () => void {
  return window.tideEvents.onModelBusy((busy) => {
    if (busy) document.documentElement.dataset.modelBusy = '1'
    else delete document.documentElement.dataset.modelBusy
  })
}
