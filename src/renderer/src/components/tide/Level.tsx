/**
 * The level: how solidly a concept is held, drawn as water standing in a small tank. The fill is
 * where it stands now; the line is the highest it has stood. A gap between the two is something
 * fading. One mark, used wherever a concept's state appears.
 */
export function Level({ now, high, area, large, className }: { /** How solid it is now, 0 to 1 */ now: number; /** The highest it has stood, 0 to 1 */ high?: number; /** The class carrying its area's colour */ area?: string; large?: boolean; className?: string }) {
  const v = Math.round(Math.max(0, Math.min(1, now)) * 100)
  const hw = Math.round(Math.max(now, Math.min(1, high ?? now)) * 100)
  const label = hw - v >= 3 ? `Held at ${v}% now; it stood at ${hw}%` : `Held at ${v}%`
  return <span className={`td-level${large ? ' lg' : ''}${hw === 0 ? ' empty' : ''}${area ? ` ${area}` : ''}${className ? ` ${className}` : ''}`} style={{ ['--v' as string]: v, ['--hw' as string]: hw }} role="img" aria-label={label} title={label} />
}
