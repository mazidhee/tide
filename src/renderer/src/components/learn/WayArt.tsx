import type { ReactNode } from 'react'

/**
 * Each way of learning as a miniature of what the session looks like, drawn from theme tokens
 * (styles/learn.css) so it works in every theme. Decoration only: hidden from screen readers.
 */
export type WayId = 'teach' | 'quiz' | 'mixed' | 'exam' | 'comprehension' | 'review' | 'interview'

const ln = (w?: string, cls = 'ln') => <div className={cls} style={w ? { width: w } : undefined} />

export const WAY_ART: Record<WayId, ReactNode> = {
  teach: (
    <div className="mini">
      <div className="bub">What does a switch do?</div>
      <div className="bub me">on or off</div>
      <div className="bub" style={{ width: '46%' }}>
        Right. Now two switches…
      </div>
    </div>
  ),
  quiz: (
    <div className="mini">
      {ln('80%')}
      {ln('55%')}
      <div className="opt4">
        <i />
        <i className="ok" />
        <i />
        <i />
      </div>
    </div>
  ),
  mixed: (
    <div className="mini stack">
      <i style={{ left: '6%', top: 16, transform: 'rotate(-5deg)' }} />
      <i style={{ left: '20%', top: 8, transform: 'rotate(3deg)' }} />
      <i style={{ left: '32%', top: 20 }}>
        <span className="tag">binary</span>
        <span className="tag">gates</span>
      </i>
    </div>
  ),
  exam: (
    <div className="mini">
      <div className="paper">
        {ln('70%')}
        {ln()}
        {ln('85%')}
        {ln('60%')}
      </div>
      <div className="clock" />
    </div>
  ),
  comprehension: (
    <div className="mini">
      <div className="page">
        {ln()}
        {ln()}
        {ln(undefined, 'ln fade')}
        {ln('70%', 'ln fade')}
      </div>
      <div className="bub me said">It says that…</div>
    </div>
  ),
  review: (
    <div className="mini">
      <div className="page">
        {ln(undefined, 'uline')}
        {ln(undefined, 'uline m')}
        {ln('80%', 'uline')}
      </div>
      <div className="side-note">
        {ln()}
        {ln('70%')}
      </div>
    </div>
  ),
  interview: (
    <div className="mini">
      <div className="code">
        def add(a, b):
        <br />
        {'  '}return a ^ b
      </div>
      <div className="tests">
        <i />
        <i />
        <i />
        <i className="x" />
      </div>
    </div>
  )
}
