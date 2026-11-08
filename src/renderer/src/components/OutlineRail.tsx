import { reveal } from '../lib/scroll'
import { useEffect, useState, type RefObject } from 'react'

interface Heading {
  id: string
  text: string
  level: number
  el: HTMLElement
}

/** Quiet heading map on the right edge of a note; hover to read it, click to jump. */
export function OutlineRail({ articleRef, scrollRef, html }: { articleRef: RefObject<HTMLElement | null>; scrollRef: RefObject<HTMLElement | null>; html: string }) {
  const [headings, setHeadings] = useState<Heading[]>([])
  const [active, setActive] = useState(0)

  useEffect(() => {
    const article = articleRef.current
    if (!article) return
    setHeadings(
      [...article.querySelectorAll<HTMLElement>(':scope > h1, :scope > h2, :scope > h3')].map((el) => ({
        id: el.id,
        text: el.textContent ?? '',
        level: Number(el.tagName[1]),
        el
      }))
    )
  }, [articleRef, html])

  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller || headings.length < 3) return
    const onScroll = () => {
      const line = scroller.getBoundingClientRect().top + scroller.clientHeight * 0.25
      let current = 0
      headings.forEach((h, i) => {
        if (h.el.getBoundingClientRect().top <= line) current = i
      })
      setActive(current)
    }
    onScroll()
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => scroller.removeEventListener('scroll', onScroll)
  }, [scrollRef, headings])

  if (headings.length < 3) return null
  const minLevel = Math.min(...headings.map((h) => h.level))

  return (
    <nav className="outline-rail" aria-label="Outline">
      <div className="outline-marks" aria-hidden="true">
        {headings.map((h, i) => (
          <span key={i} className={`mark l${h.level - minLevel}${i === active ? ' on' : ''}`} />
        ))}
      </div>
      <div className="outline-panel">
        {headings.map((h, i) => (
          <button
            key={i}
            className={`outline-item l${h.level - minLevel}${i === active ? ' on' : ''}`}
            onClick={() => reveal(h.el)}
          >
            {h.text}
          </button>
        ))}
      </div>
    </nav>
  )
}
