import { useEffect, useState } from 'react'
import { Professor } from './Professor'

/** What the tutor is "doing" while a reply hasn't started: a little personality, and proof it's alive */
const PHRASES = [
  'Thinking',
  'Pondering',
  'Ruminating',
  'Mulling it over',
  'Connecting the dots',
  'Leafing through your notes',
  'Consulting the margins',
  'Sharpening the pencil',
  'Checking my working',
  'Untangling it',
  'Sketching a diagram in my head',
  'Brewing an answer',
  'Finding a good example',
  'Rereading the question',
  'Choosing my words',
  'Warming up the chalkboard'
]

const pick = (not?: string) => {
  let p = PHRASES[Math.floor(Math.random() * PHRASES.length)]
  if (p === not) p = PHRASES[(PHRASES.indexOf(p) + 1) % PHRASES.length]
  return p
}

/**
 * A shimmering status line that changes every few seconds, with a timer once it's been a while, so a
 * slow local model never looks frozen.
 */
export function Thinking({ className = '', professor = true }: { className?: string; professor?: boolean }) {
  const [phrase, setPhrase] = useState(() => (Math.random() < 0.5 ? 'Thinking' : pick()))
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    const started = Date.now()
    const tick = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000)
    const swap = setInterval(() => setPhrase((p) => pick(p)), 2600)
    return () => {
      clearInterval(tick)
      clearInterval(swap)
    }
  }, [])
  return (
    <div className={`thinking-line ${className}`} role="status" aria-label="The tutor is thinking">
      {professor ? <Professor state="thinking" size={20} /> : <span className="thinking-glyph" aria-hidden="true" />}
      <span className="thinking-text" key={phrase}>
        {phrase}…
      </span>
      {seconds >= 4 && <span className="thinking-time">{seconds}s</span>}
    </div>
  )
}
