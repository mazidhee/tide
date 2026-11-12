/**
 * A document's symbols from whichever provider Monaco has for its language (basedpyright, the
 * IDE's language servers, Monaco's own TypeScript), as its quick outline gets them: the outline,
 * the breadcrumbs and the palette's @ read them here. Monaco keeps the provider registry
 * internal, so this reaches it through its standalone services (pinned to monaco-editor 0.52).
 */
import type * as Monaco from 'monaco-editor'
import { StandaloneServices } from 'monaco-editor/esm/vs/editor/standalone/browser/standaloneServices.js'
import { ILanguageFeaturesService } from 'monaco-editor/esm/vs/editor/common/services/languageFeatures.js'
import { monaco } from '../monaco'

interface SymbolRegistry {
  documentSymbolProvider: { ordered(model: Monaco.editor.ITextModel): Monaco.languages.DocumentSymbolProvider[] }
}

export async function documentSymbols(model: Monaco.editor.ITextModel): Promise<Monaco.languages.DocumentSymbol[]> {
  try {
    const svc = StandaloneServices.get(ILanguageFeaturesService) as SymbolRegistry
    const token = new monaco.CancellationTokenSource().token
    for (const p of svc.documentSymbolProvider.ordered(model)) {
      const r = await Promise.resolve(p.provideDocumentSymbols(model, token)).catch(() => null)
      if (r?.length) return r
    }
  } catch (e) {
    console.warn('[symbols]', e)
  }
  return []
}

/** VS Code's codicon names for symbol kinds, as short labels Tide draws itself */
const KIND = ['file', 'module', 'namespace', 'package', 'class', 'method', 'property', 'field', 'constructor', 'enum', 'interface', 'function', 'variable', 'constant', 'string', 'number', 'boolean', 'array', 'object', 'key', 'null', 'enum member', 'struct', 'event', 'operator', 'type parameter']
export const symbolKindName = (k: number) => KIND[k] ?? 'symbol'

/** One letter and a tone for a symbol kind, in the outline and the palette */
export function symbolBadge(k: number): { letter: string; tone: string } {
  const name = symbolKindName(k)
  if (name === 'class' || name === 'struct' || name === 'interface') return { letter: name === 'interface' ? 'I' : 'C', tone: 'type' }
  if (name === 'method' || name === 'function' || name === 'constructor') return { letter: 'ƒ', tone: 'fn' }
  if (name === 'variable' || name === 'constant' || name === 'field' || name === 'property') return { letter: name === 'constant' ? 'K' : 'v', tone: 'var' }
  if (name === 'module' || name === 'namespace' || name === 'package') return { letter: 'M', tone: 'mod' }
  if (name === 'enum' || name === 'enum member') return { letter: 'E', tone: 'type' }
  return { letter: '·', tone: 'other' }
}

interface HoverRegistry {
  hoverProvider: { ordered(model: Monaco.editor.ITextModel): Monaco.languages.HoverProvider[] }
}

/** What the hover would say at a position (the Quick Help inspector shows it without hovering) */
export async function hoverAt(model: Monaco.editor.ITextModel, position: Monaco.IPosition): Promise<string[]> {
  try {
    const svc = StandaloneServices.get(ILanguageFeaturesService) as HoverRegistry
    const token = new monaco.CancellationTokenSource().token
    const pos = new monaco.Position(position.lineNumber, position.column)
    for (const p of svc.hoverProvider.ordered(model)) {
      const r = await Promise.resolve(p.provideHover(model, pos, token)).catch(() => null)
      const parts = (r?.contents ?? []).map((c) => c.value).filter((v) => v.trim())
      if (parts.length) return parts
    }
  } catch (e) {
    console.warn('[hover]', e)
  }
  return []
}
