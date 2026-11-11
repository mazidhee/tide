import { subjectIcon } from '@shared/subjectIcon'
import { useAreaClass } from '../../lib/areas'
import { Icon } from '../Icon'

/**
 * The mark of a notebook or area of study: an icon chosen from its name (shared/subjectIcon.ts),
 * the same one wherever the subject appears. Its area colour tints it, as a second, quieter cue.
 */
export function AreaMark({ area, size = 15, className }: { /** The notebook's name or path */ area: string | null | undefined; size?: number; className?: string }) {
  const colour = useAreaClass()(area)
  return <Icon name={subjectIcon(area)} size={size} className={`td-area-ic ${colour}${className ? ` ${className}` : ''}`} />
}
