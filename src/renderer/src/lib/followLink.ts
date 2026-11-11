import { folderOf, type useApp } from '../state'
import { resolveRelative } from './markdown'

type App = ReturnType<typeof useApp>

/**
 * Opens a link from a note, by Tide's rules: a [[wiki link]] resolves like Obsidian's (by name
 * anywhere in the vault) and offers to create a note that doesn't exist yet; a relative Markdown
 * link resolves from the note's folder; a web link opens in the browser.
 */
export async function followLink(app: App, notePath: string, link: { wikilink: string } | { href: string }) {
  if ('wikilink' in link) {
    const wikilink = link.wikilink
    const resolved = await window.tide.vault.resolveLink(wikilink, notePath)
    if (resolved) return app.openPath(resolved, wikilink.split('#')[1])
    app.toast(`“${wikilink}” doesn't exist yet`, {
      action: {
        label: 'Create it',
        run: async () => app.openPath(await window.tide.vault.createNote(folderOf(notePath), wikilink.split('#')[0]))
      }
    })
    return
  }
  const href = link.href.trim()
  if (/^(https?|mailto):/i.test(href)) return window.tide.app.openExternal(href)
  if (!href || href.startsWith('#')) return
  app.openPath(resolveRelative(href, { notePath, filesByName: app.filesByName }))
}
