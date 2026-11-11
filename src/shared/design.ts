import type { Settings } from './types'

/**
 * Tide has two designs, kept side by side. 'tide' is the current one; 'classic' is the earlier
 * one, kept whole so you can go back to it in Settings › Appearance. The choice is put on the
 * root element as data-design; every rule of the new design is scoped under it
 * (styles/tide/*.css), so 'classic' renders exactly as it did before the new design existed.
 */
export type DesignId = 'classic' | 'tide'

export const DEFAULT_DESIGN: DesignId = 'tide'

export const DESIGNS: { id: DesignId; name: string; about: string }[] = [
  { id: 'tide', name: 'Tide', about: 'The current design' },
  { id: 'classic', name: 'Classic', about: 'The earlier design' }
]

/** The design to draw: what was chosen, or the default when nothing (or nonsense) is stored */
export const resolveDesign = (value: unknown): DesignId => (value === 'classic' || value === 'tide' ? value : DEFAULT_DESIGN)

/**
 * The face long reading is set in. The new design reads in the serif unless you choose the sans
 * (the Aa button in a lesson or a note); the classic design keeps its own setting and its own
 * default, so switching designs never changes what the other one looked like.
 */
export const readingFace = (settings: Pick<Settings, 'design' | 'readingFont' | 'tideReadingFont'>): 'serif' | 'sans' =>
  resolveDesign(settings.design) === 'tide' ? (settings.tideReadingFont ?? 'serif') : (settings.readingFont ?? 'sans')
