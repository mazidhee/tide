import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { hasProfile, initials, shownPicture, type Profile } from '@shared/profile'
import { blinkPixels, spriteRects, type PixelSprite } from '@shared/pixelise'
import { motionPaused } from '../lib/motion'
import { useProfile } from '../lib/profile'

const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/**
 * Blinks now and then, at an irregular rhythm like the Professor's, when the sprite has eyes marked.
 * Still when the system asks for reduced motion, when the window is hidden or the model is busy.
 */
function useBlink(on: boolean): boolean {
  const [shut, setShut] = useState(false)
  useEffect(() => {
    if (!on || reducedMotion()) return
    let timer: ReturnType<typeof setTimeout>
    const next = () => {
      timer = setTimeout(
        () => {
          if (motionPaused()) return next()
          setShut(true)
          timer = setTimeout(() => {
            setShut(false)
            next()
          }, 140)
        },
        2600 + Math.random() * 3400
      )
    }
    next()
    return () => clearTimeout(timer)
  }, [on])
  return shut
}

/** Your pixel self, as crisp SVG squares at any size */
export function PixelSelf({ sprite, size = 32, blink = false, className, label }: { sprite: PixelSprite; size?: number; blink?: boolean; className?: string; label?: string }) {
  const shut = useBlink(blink && sprite.eyes.length > 0)
  const html = useMemo(() => spriteRects(sprite, shut ? blinkPixels(sprite) : sprite.pixels), [sprite, shut])
  return (
    <svg className={`pixel-self${className ? ` ${className}` : ''}`} width={size} height={size} viewBox={`0 0 ${sprite.size} ${sprite.size}`} shapeRendering="crispEdges" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <g dangerouslySetInnerHTML={{ __html: html }} />
    </svg>
  )
}

/** A small person, for a circle with no name or picture yet */
function Someone({ size }: { size: number }) {
  return (
    <svg width={size * 0.58} height={size * 0.58} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true">
      <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20.5a7.5 7.5 0 0 1 15 0" />
    </svg>
  )
}

/**
 * You, in a circle: the picture you chose (photo or pixel self), else your initials, else a small
 * person. `animate` lets the pixel self blink (only where one avatar sits on its own, not in lists).
 */
export function Avatar({ size = 24, animate = false, className, profile: given, title }: { size?: number; animate?: boolean; className?: string; profile?: Profile; title?: string }) {
  const live = useProfile()
  const p = given ?? live
  const shown = shownPicture(p)
  const cls = `avatar avatar-${shown}${className ? ` ${className}` : ''}`
  const style = { width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.4)) }
  const label = title ?? (p.name || 'You')
  if (shown === 'photo' && p.photo)
    return (
      <span className={cls} style={style} title={title} data-avatar="photo">
        <img src={p.photo} alt={label} draggable={false} />
      </span>
    )
  if (shown === 'pixel' && p.pixel)
    return (
      <span className={`${cls}${p.pixel.background ? ' has-backdrop' : ''}`} style={style} title={title} data-avatar="pixel">
        <PixelSelf sprite={p.pixel} size={size} blink={animate && p.blink} label={label} />
      </span>
    )
  const letters = initials(p.name)
  return (
    <span className={cls} style={style} title={title} data-avatar={letters ? 'initials' : 'empty'} aria-label={letters ? label : undefined} role={letters ? 'img' : undefined}>
      {letters ? <span aria-hidden="true">{letters}</span> : <Someone size={size} />}
    </span>
  )
}

/**
 * Your side of a chat or a lesson: your words with you beside them, once you've set up a name or
 * a picture; just your words before that.
 */
export function YouBeside({ children, size = 24 }: { children: ReactNode; size?: number }) {
  const p = useProfile()
  if (!hasProfile(p)) return <>{children}</>
  return (
    <div className="you-row">
      {children}
      <Avatar size={size} />
    </div>
  )
}

/** You, beside your chat message: nothing until you've set up a name or a picture */
export function YouMark({ size = 26 }: { size?: number }) {
  const p = useProfile()
  return hasProfile(p) ? <Avatar size={size} className="you-mark" /> : null
}
