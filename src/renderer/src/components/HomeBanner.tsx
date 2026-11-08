import { useState } from 'react'
import { PixelScene } from './PixelScene'
import { Icon } from './Icon'

/**
 * The top of Home: the tutor's day in the pixel world, drawn for the time it is (tea in the
 * garden, the study, the pond at sunset, the fireside), with neighbours, ducks and the cat.
 */
export function HomeBanner() {
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem('tide.home.banner') === 'off'
    } catch {
      return false
    }
  })
  const [label, setLabel] = useState('')
  if (hidden) return null
  return (
    <div className="home-banner">
      <PixelScene place="home" rows={42} onLabel={setLabel} />
      {label && <span className="home-banner-label">{label}</span>}
      <button
        className="home-banner-hide icon-btn small"
        title="Hide this"
        onClick={() => {
          try {
            localStorage.setItem('tide.home.banner', 'off')
          } catch {
            // Hidden for now
          }
          setHidden(true)
        }}
      >
        <Icon name="x" size={12} />
      </button>
    </div>
  )
}
