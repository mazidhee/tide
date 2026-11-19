import { WEB_SITE_IDS, type WebSite } from '@shared/compWeb'
import wikipedia from '../../assets/logos/wikipedia.svg?url'
import gutenberg from '../../assets/logos/gutenberg.svg?url'
import arxiv from '../../assets/logos/arxiv.svg?url'

/** The three sites fresh texts come from, as the window shows them: each one's own mark, a short name, and the one last chosen */
export const SITE_LOGO: Record<WebSite, string> = {
  wikipedia,
  gutenberg,
  arxiv
}
export const SITE_SHORT: Record<WebSite, string> = {
  wikipedia: 'Wikipedia',
  gutenberg: 'Gutenberg',
  arxiv: 'arXiv'
}

const SITE_KEY = 'tide.comp.site'
export const lastSite = (): WebSite => {
  const s = localStorage.getItem(SITE_KEY) as WebSite | null
  return s && WEB_SITE_IDS.includes(s) ? s : 'wikipedia'
}
export const rememberSite = (s: WebSite) => localStorage.setItem(SITE_KEY, s)
