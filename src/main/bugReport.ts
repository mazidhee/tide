/**
 * Report a bug from anywhere (shared/bugNote has the line and the note): ⌃⌘B or Help › Report a
 * Bug… takes a picture of the window in front first, so the sheet that opens isn't in it, then
 * opens the sheet in that window. Sending adds one line to the top of "## Open" in the vault's
 * Tide/Tide bugs.md and saves the picture beside it in Tide/Bug shots.
 */
import { app, BrowserWindow, ipcMain, type WebContents } from 'electron'
import { existsSync, promises as fs } from 'fs'
import { dirname } from 'path'
import { addBugLine, bugLine, shotPath, BUG_NOTE, type BugReport, type BugSheetInfo } from '@shared/bugNote'
import { absPath, readText, writeText } from './vault'

/** The picture taken when the sheet was asked for, per window, kept for ten minutes */
const shots = new Map<number, { png: Buffer; thumb: string; at: number }>()
const KEEP_MS = 10 * 60_000

/** Takes the picture of a window, then asks it to open the sheet */
export async function openBugSheet(target?: BrowserWindow | null): Promise<void> {
  const w = target ?? BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  if (!w || w.isDestroyed() || w.webContents.isDestroyed()) return
  try {
    const img = await w.webContents.capturePage()
    if (!img.isEmpty()) {
      const thumb = img.resize({ width: Math.min(560, img.getSize().width) }).toDataURL()
      shots.set(w.webContents.id, { png: img.toPNG(), thumb, at: Date.now() })
    }
  } catch {
    // No picture: the sheet still opens, without one
    shots.delete(w.webContents.id)
  }
  w.webContents.send('menu', 'report-bug')
}

const shotFor = (wc: WebContents) => {
  const s = shots.get(wc.id)
  return s && Date.now() - s.at < KEEP_MS ? s : null
}

/** Writes the report: the picture first (when kept), then the one line. Returns the note's path and the picture's */
export async function fileBug(r: BugReport, png: Buffer | null, at = Date.now(), version = app?.getVersion?.() ?? ''): Promise<{ note: string; shot: string | null; line: string }> {
  const shot = r.shot && png ? shotPath(at) : null
  const line = bugLine({ text: r.text, view: r.view, at, ...(shot ? { shot, version } : {}) })
  if (shot && png) {
    await fs.mkdir(dirname(absPath(shot)), { recursive: true })
    await fs.writeFile(absPath(shot), png)
  }
  // A note that is there but can't be read stops here: it is never written over
  const md = existsSync(absPath(BUG_NOTE)) ? await readText(BUG_NOTE) : null
  await writeText(BUG_NOTE, addBugLine(md, line))
  return { note: BUG_NOTE, shot, line }
}

export function registerBugReports(): void {
  ipcMain.handle('bugs:info', (e): BugSheetInfo => ({ version: app.getVersion(), thumb: shotFor(e.sender)?.thumb ?? null }))
  ipcMain.handle('bugs:open', (e) => openBugSheet(BrowserWindow.fromWebContents(e.sender)))
  ipcMain.handle('bugs:file', async (e, r: BugReport) => {
    const s = shotFor(e.sender)
    const out = await fileBug({ text: String(r?.text ?? ''), view: String(r?.view ?? ''), shot: !!r?.shot }, s?.png ?? null)
    shots.delete(e.sender.id)
    return out
  })
  ipcMain.handle('bugs:discard', (e) => void shots.delete(e.sender.id))
}
