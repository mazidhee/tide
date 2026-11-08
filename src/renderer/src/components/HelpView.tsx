import { reveal } from '../lib/scroll'
import { useEffect, useMemo, useRef, useState } from 'react'
import guide from '../../../../docs/user-guide.md?raw'
import { renderMarkdown, slugify } from '../lib/markdown'

interface Heading {
  id: string
  text: string
  level: 2 | 3
}

/** The user guide, bundled with the app and rendered like a note */
export function HelpView({ section }: { section?: string }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const articleRef = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState('')
  const [filter, setFilter] = useState('')

  const html = useMemo(() => renderMarkdown(guide, { notePath: '', filesByName: new Map() }), [])
  const headings: Heading[] = useMemo(
    () =>
      // Code examples in the guide contain heading-like lines; leave them out of the contents
      [...guide.replace(/^```[\s\S]*?^```/gm, '').matchAll(/^(##|###)\s+(.+)$/gm)].map((m) => ({
        id: slugify(m[2]),
        text: m[2].replace(/[*`]/g, ''),
        level: m[1].length as 2 | 3
      })),
    []
  )

  const jump = (id: string) => reveal(articleRef.current?.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`))

  useEffect(() => {
    if (section) setTimeout(() => jump(slugify(section)), 50)
  }, [section])

  // Highlight the section being read
  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller) return
    const onScroll = () => {
      const line = scroller.getBoundingClientRect().top + 120
      let current = headings[0]?.id ?? ''
      for (const h of headings) {
        const el = articleRef.current?.querySelector<HTMLElement>(`[id="${CSS.escape(h.id)}"]`)
        if (el && el.getBoundingClientRect().top <= line) current = h.id
      }
      setActive(current)
    }
    onScroll()
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => scroller.removeEventListener('scroll', onScroll)
  }, [headings])

  // Links between sections stay in the page; web links open in the browser
  const onClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a')
    if (!a) return
    const href = a.getAttribute('href') ?? ''
    if (href.startsWith('#') && href.length > 1) {
      e.preventDefault()
      jump(href.slice(1))
    }
  }

  const q = filter.trim().toLowerCase()
  const visible = q ? headings.filter((h) => h.text.toLowerCase().includes(q)) : headings

  return (
    <div className="doc-view help">
      <header className="doc-toolbar drag">
        <div className="crumbs no-drag">
          <span className="crumb current">Tide guide</span>
        </div>
      </header>
      <div className="help-layout">
        <nav className="help-toc" aria-label="Contents">
          <input className="filter-input small" placeholder="Find a topic" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Find a topic" />
          <ul>
            {visible.map((h) => (
              <li key={h.id}>
                <button className={`help-toc-item l${h.level}${active === h.id ? ' on' : ''}`} onClick={() => jump(h.id)}>
                  {h.text}
                </button>
              </li>
            ))}
            {!visible.length && <li className="muted small">No section matches.</li>}
          </ul>
        </nav>
        <div className="doc-scroll" ref={scrollRef}>
          <article ref={articleRef} className="prose reading-column help-article" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      </div>
    </div>
  )
}
