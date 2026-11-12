/**
 * The IDE's open files: one Monaco model each, named after the file on disk so the language
 * servers know it, with what was last saved so a tab can show it's changed (VS Code's dirty dot).
 * Saving writes through main (main/ide/workspace). A file that changes on disk while open and
 * unchanged here is reloaded; one changed in both places keeps the editor's text until saved.
 */
import type * as Monaco from 'monaco-editor'
import { languageOf } from './languages'

type M = typeof Monaco

export interface Doc {
  path: string
  model: Monaco.editor.ITextModel
  /** Monaco's alternative version id when the text last matched the disk */
  savedVersion: number
  /** The text on disk, as last read or written */
  disk: string
  /** Changed on disk since it changed here */
  conflict?: boolean
}

export class Documents {
  private docs = new Map<string, Doc>()
  private opening = new Map<string, Promise<Doc>>()
  private listeners = new Set<() => void>()
  private subs: Monaco.IDisposable[] = []
  /** Bumped on every change a tab or the status bar shows */
  version = 0

  constructor(
    private monaco: M,
    readonly root: string,
    private tsServer: boolean
  ) {}

  uri(path: string) {
    return this.monaco.Uri.file(`${this.root}/${path}`)
  }

  /** The workspace path of a model's URI, or null when it isn't in this workspace */
  pathOf(uri: Monaco.Uri): string | null {
    if (uri.scheme !== 'file' || !uri.path.startsWith(this.root + '/')) return null
    return uri.path.slice(this.root.length + 1)
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }

  private emit() {
    this.version++
    this.listeners.forEach((fn) => fn())
  }

  get(path: string): Doc | undefined {
    return this.docs.get(path)
  }

  all(): Doc[] {
    return [...this.docs.values()]
  }

  isDirty(path: string): boolean {
    const d = this.docs.get(path)
    return !!d && !d.model.isDisposed() && d.model.getAlternativeVersionId() !== d.savedVersion
  }

  dirty(): string[] {
    return [...this.docs.keys()].filter((p) => this.isDirty(p))
  }

  open(path: string): Promise<Doc> {
    const have = this.docs.get(path)
    if (have && !have.model.isDisposed()) return Promise.resolve(have)
    let p = this.opening.get(path)
    if (p) return p
    p = (async () => {
      const r = await window.tide.ide.read(this.root, path)
      if (r.binary) throw new Error(`${path.split('/').pop()} isn’t a text file.`)
      if (r.tooLarge) throw new Error(`${path.split('/').pop()} is too large to open here.`)
      const uri = this.uri(path)
      const lang = languageOf(path, this.tsServer)
      let model = this.monaco.editor.getModel(uri)
      if (model && !model.isDisposed()) {
        if (model.getValue() !== r.text) model.pushEditOperations([], [{ range: model.getFullModelRange(), text: r.text }], () => null)
        if (model.getLanguageId() !== lang) this.monaco.editor.setModelLanguage(model, lang)
      } else model = this.monaco.editor.createModel(r.text, lang, uri)
      const d: Doc = { path, model, savedVersion: model.getAlternativeVersionId(), disk: r.text }
      this.docs.set(path, d)
      let wasDirty = false
      const sub = model.onDidChangeContent(() => {
        const dirty = this.isDirty(path)
        if (dirty !== wasDirty) {
          wasDirty = dirty
          this.emit()
        }
      })
      this.subs.push(sub)
      model.onWillDispose(() => {
        sub.dispose()
        if (this.docs.get(path)?.model === model) this.docs.delete(path)
      })
      this.emit()
      return d
    })().finally(() => this.opening.delete(path))
    this.opening.set(path, p)
    return p
  }

  /** Writes the model's text to disk */
  async save(path: string): Promise<void> {
    const d = this.docs.get(path)
    if (!d || d.model.isDisposed()) return
    const text = d.model.getValue()
    const version = d.model.getAlternativeVersionId()
    await window.tide.ide.write(this.root, path, text)
    d.disk = text
    d.savedVersion = version
    d.conflict = false
    this.emit()
  }

  /** Replaces a file's text as one undoable edit (an accepted proposal); opens it first if need be */
  async setText(path: string, text: string): Promise<Doc> {
    const d = await this.open(path)
    if (d.model.getValue() !== text) d.model.pushEditOperations([], [{ range: d.model.getFullModelRange(), text }], () => null)
    return d
  }

  /** Puts the text back as it is on disk */
  async revert(path: string) {
    const d = this.docs.get(path)
    if (!d) return
    const r = await window.tide.ide.read(this.root, path).catch(() => null)
    if (!r || r.binary) return
    d.disk = r.text
    if (d.model.getValue() !== r.text) d.model.pushEditOperations([], [{ range: d.model.getFullModelRange(), text: r.text }], () => null)
    d.savedVersion = d.model.getAlternativeVersionId()
    d.conflict = false
    this.emit()
  }

  /** Files changed on disk: unchanged ones here are reloaded, changed ones are marked */
  async diskChanged(paths: string[]) {
    let changed = false
    for (const p of paths) {
      const d = this.docs.get(p)
      if (!d || d.model.isDisposed()) continue
      const r = await window.tide.ide.read(this.root, p).catch(() => null)
      if (!r || r.binary || r.text === d.disk) continue
      if (this.isDirty(p)) {
        d.conflict = true
        changed = true
        continue
      }
      d.disk = r.text
      if (d.model.getValue() !== r.text) d.model.pushEditOperations([], [{ range: d.model.getFullModelRange(), text: r.text }], () => null)
      d.savedVersion = d.model.getAlternativeVersionId()
      changed = true
    }
    if (changed) this.emit()
  }

  /** A file was renamed or moved: its model goes (the tab reopens it at the new path) */
  close(path: string) {
    const d = this.docs.get(path)
    if (!d) return
    this.docs.delete(path)
    if (!d.model.isDisposed() && !this.monaco.editor.getEditors().some((e) => e.getModel() === d.model)) d.model.dispose()
    this.emit()
  }

  dispose() {
    this.subs.forEach((s) => s.dispose())
    // Editors let go of the models first: disposing a model under a live editor makes Monaco throw
    const mine = new Set([...this.docs.values()].map((d) => d.model))
    for (const e of this.monaco.editor.getEditors()) if (e.getModel() && mine.has(e.getModel()!)) e.setModel(null)
    for (const d of this.docs.values()) if (!d.model.isDisposed()) d.model.dispose()
    this.docs.clear()
    this.listeners.clear()
  }
}
