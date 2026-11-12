/**
 * Every link in Tide opens in Tide (shared/links routes it). One listener for the whole window:
 * a click on a web link, a GitHub link or a link inside a course's repository goes to the nearest
 * place that shows links (the course reader when one is open, else the reading sheet over the
 * page), never the browser. ⌘-click is the explicit way out to the browser. Links inside the notes
 * folder are left to the notes' own handling.
 */
import { routeLink, targetUrl, type CourseRepo, type LinkContext, type LinkTarget } from '@shared/links'

export interface LinkHost {
  open(t: LinkTarget): void
}

const hosts: LinkHost[] = []

/** The latest registered host takes links; the reading sheet is always there underneath */
export function registerLinkHost(h: LinkHost): () => void {
  hosts.push(h)
  return () => {
    const i = hosts.lastIndexOf(h)
    if (i >= 0) hosts.splice(i, 1)
  }
}

let repos: CourseRepo[] = []
export const courseRepos = () => repos
export async function refreshRepos() {
  repos = await window.tide.links.repos().catch(() => repos)
}

export function openTarget(t: LinkTarget) {
  if (t.kind === 'system') return window.tide.app.openExternal(t.url)
  hosts[hosts.length - 1]?.open(t)
}

/** Opens a URL the way a click on a link to it would */
export function openUrl(url: string, base?: LinkContext['base']) {
  const t = routeLink(url, { courses: repos, ...(base ? { base } : {}) })
  if (t) openTarget(t)
}

/** "Open in browser": only ever asked for */
export function openInBrowser(t: LinkTarget | string) {
  const url = typeof t === 'string' ? t : targetUrl(t, repos)
  if (url) void window.tide.app.openExternal(url)
}

/** Where a link inside this element resolves from: the repository file it's in */
function baseOf(el: Element): LinkContext['base'] | undefined {
  const host = el.closest<HTMLElement>('[data-link-course],[data-link-repo]')
  if (!host) return undefined
  const path = host.dataset.linkPath ?? ''
  if (host.dataset.linkCourse) return { course: host.dataset.linkCourse, path }
  return { repo: host.dataset.linkRepo!, ref: host.dataset.linkRef || 'HEAD', path }
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '')

/** Scrolls the reading area that holds `from` to the heading `id` names (by its id, or its text) */
export function scrollToHeading(root: ParentNode, id: string): boolean {
  const want = norm(id)
  const hs = [...root.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6,[id]')]
  const el = hs.find((h) => h.id === id) ?? hs.find((h) => norm(h.id) === want) ?? hs.find((h) => /^H\d$/.test(h.tagName) && norm(h.textContent ?? '') === want) ?? hs.find((h) => /^H\d$/.test(h.tagName) && norm(h.textContent ?? '').startsWith(want))
  if (!el) return false
  el.scrollIntoView({ block: 'start', behavior: 'smooth' })
  el.classList.add('link-flash')
  setTimeout(() => el.classList.remove('link-flash'), 1600)
  return true
}

let listening = false

export function listenForLinks() {
  if (listening || typeof document === 'undefined') return
  listening = true
  void refreshRepos()
  window.tide.courses.onProgress((e) => e.phase === 'done' && void refreshRepos())
  document.addEventListener(
    'click',
    (e) => {
      if (e.defaultPrevented || e.button !== 0) return
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!a || a.classList.contains('wikilink') || a.dataset.wikilink !== undefined || a.closest('[data-own-links]')) return
      const href = a.getAttribute('href') ?? ''
      const t = routeLink(href, { courses: repos, base: baseOf(a) })
      if (!t) return
      if (t.kind === 'anchor') {
        const root = a.closest('[data-link-root]') ?? a.closest('.prose')
        if (root && scrollToHeading(root, t.id)) e.preventDefault()
        return
      }
      e.preventDefault()
      e.stopPropagation()
      if (e.metaKey || e.ctrlKey) return openInBrowser(t)
      openTarget(t)
    },
    true
  )
}

// ---------- The tutor moving the view (main tideMcpTools show_in_view) ----------

export interface Goto {
  t?: number
  section?: string
  video?: string
}

const gotoHandlers: ((g: Goto) => boolean)[] = []
/** A reader that can show a section registers here; the newest that handles it wins */
export function onGoto(h: (g: Goto) => boolean): () => void {
  gotoHandlers.push(h)
  return () => {
    const i = gotoHandlers.indexOf(h)
    if (i >= 0) gotoHandlers.splice(i, 1)
  }
}

export function goto(g: Goto) {
  for (let i = gotoHandlers.length - 1; i >= 0; i--) if (gotoHandlers[i](g)) return
}
