/**
 * "Cleaned: 6 items hidden · Show original": the quiet line over a lesson or an article whose noise
 * was hidden (shared/pageClean), and the original rendered on request with each hidden part marked,
 * so nothing is lost. The marked parts are `data-tide-noise`: the tutor's view of the page
 * (LinkViewer useSectionInView) passes over them even while they are shown.
 */
import { useEffect, useState } from 'react'
import { describeHidden, segmentsText, type NoiseKind, type PageCleaning } from '@shared/pageClean'

const KIND: Record<NoiseKind, string> = {
  ads: 'Ad',
  badges: 'Badges',
  'sign-up': 'Sign-up',
  community: 'Community links',
  sponsors: 'Sponsors',
  promotion: 'Promotion',
  repo: 'Repository notice',
  tracking: 'Tracking',
  navigation: 'Navigation'
}

/** Whether the original is shown: back to cleaned whenever the page changes */
export function useShowOriginal(page: unknown): [boolean, () => void] {
  const [original, setOriginal] = useState(false)
  useEffect(() => setOriginal(false), [page])
  return [original, () => setOriginal((o) => !o)]
}

export function CleanedNote({ cleaning, original, onToggle }: { cleaning?: PageCleaning | null; original: boolean; onToggle(): void }) {
  if (!cleaning?.hidden.length) return null
  const n = cleaning.hidden.length
  return (
    <p className="page-cleaned" title={`Hidden: ${describeHidden(cleaning.hidden)}`}>
      <span>
        Cleaned: {n} {n === 1 ? 'item' : 'items'} hidden
      </span>
      <span aria-hidden="true">·</span>
      <button className="link-btn" aria-pressed={original} onClick={onToggle}>
        {original ? 'Hide them again' : 'Show original'}
      </button>
    </p>
  )
}

const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

/**
 * The page as it was, each hidden part in a marked box. Each run is rendered by itself, with the
 * page's reference definitions ([id]: url) beside it so its links and badges still resolve.
 * `prep` is what the reader does to the text first (front matter, a repeated title): applied to the
 * first run only, where those are.
 */
export function originalHtml(cleaning: PageCleaning, render: (md: string) => string, prep: (md: string) => string = (m) => m): string {
  const all = segmentsText(cleaning.segments, true)
  const refs = [...all.matchAll(/^ {0,3}\[[^\]]+\]:\s*\S+.*$/gm)].map((m) => m[0]).join('\n')
  return cleaning.segments
    .map((s, i) => {
      const text = i === 0 ? prep(s.text) : s.text
      if (!text.trim()) return ''
      const html = render(refs ? `${text}\n\n${refs}\n` : text)
      return s.hidden ? `<div class="page-noise" data-tide-noise="${escapeAttr(s.hidden)}" data-noise-label="Hidden: ${escapeAttr(KIND[s.hidden])}">${html}</div>` : html
    })
    .join('')
}
