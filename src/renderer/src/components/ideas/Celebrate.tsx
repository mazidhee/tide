import { useEffect } from 'react'
import type { Celebration } from '@shared/ideaScore'
import { PartyScene } from '../workout/PartyScene'
import { PixelText } from '../workout/pixel'
import { Icon } from '../Icon'
import '../../styles/workout.css'
import '../../styles/ideas.css'

const BANNER: Record<Celebration['kind'], string> = { party: 'LEVEL UP', done: 'MILESTONE', streak: 'STREAK' }

/**
 * A project celebration: the morning workout's pixel party (PartyScene and its pixel title), over
 * the page for a moment. A new level or tier is the full party; a milestone the quieter scene.
 */
export function Celebrate({ c, onClose }: { c: Celebration; onClose(): void }) {
  useEffect(() => {
    const t = setTimeout(onClose, c.kind === 'done' ? 4500 : 7000)
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', key)
    return () => (clearTimeout(t), window.removeEventListener('keydown', key))
  }, [c, onClose])
  const banner = c.title.startsWith('TIER') ? 'NEW TIER' : BANNER[c.kind]
  return (
    <div className="ip-celebrate-scrim no-drag" onMouseDown={onClose} role="dialog" aria-label={`${banner}: ${c.title}`}>
      <div className={`wo-party ip-celebrate ${c.kind}`} onMouseDown={(e) => e.stopPropagation()}>
        <PartyScene kind={c.kind === 'done' ? 'done' : c.kind === 'streak' ? 'streak' : 'party'} height={c.kind === 'done' ? 250 : 300} />
        <div className="wo-party-msg">
          <span className="wo-banner">
            <PixelText text={banner} px={2} />
          </span>
          <h1>
            <PixelText text={c.title} px={c.kind === 'done' ? 4 : 5} />
          </h1>
          <p>{c.line}</p>
        </div>
        <button className="icon-btn small ip-celebrate-close" onClick={onClose} aria-label="Close">
          <Icon name="x" size={13} />
        </button>
      </div>
    </div>
  )
}
