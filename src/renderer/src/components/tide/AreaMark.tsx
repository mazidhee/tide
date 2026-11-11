import { subjectIcon } from '@shared/subjectIcon'
import { Icon } from '../Icon'

/**
 * The mark of a notebook or area of study: an icon chosen from its name (shared/subjectIcon.ts),
 * the same one wherever the subject appears, in plain ink like the navigation's icons.
 */
export function AreaMark({ area, size = 15, className }: { /** The notebook's name or path */ area: string | null | undefined; size?: number; className?: string }) {
  return <Icon name={subjectIcon(area)} size={size} className={`td-area-ic${className ? ` ${className}` : ''}`} />
}
