/** Electron's `app`, enough for main/settings, main/vault and main/native outside the app (scripts/modules) */
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const userData = process.env.TIDE_SCRIPT_USERDATA || mkdtempSync(join(tmpdir(), 'tide-modules-script-'))
process.env.TIDE_SCRIPT_USERDATA = userData

export const app = { getPath: () => userData, getAppPath: () => process.cwd(), isPackaged: false, on: () => undefined }
export const BrowserWindow = { getAllWindows: () => [] }
export const ipcMain = { handle: () => undefined, on: () => undefined }
export const shell = {}
export default { app, BrowserWindow, ipcMain, shell }
