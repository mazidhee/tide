/**
 * Claude as a pair programmer in the IDE. Filled in by the Claude coding tools.
 */
import { ipcMain } from 'electron'

export function registerPair(): void {
  ipcMain.handle('ide:pair:status', async () => {
    const { claudeReady } = await import('../claudeEngine')
    const r = await claudeReady()
    return { ready: r.ready, installed: r.installed, why: r.why }
  })
}
