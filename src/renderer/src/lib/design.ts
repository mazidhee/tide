import { resolveDesign, type DesignId } from '@shared/design'
import { useApp } from '../state'

/** The design being drawn. Components that need a different structure in the new design ask this. */
export const useDesign = (): DesignId => resolveDesign(useApp().settings.design)
export const useTideDesign = (): boolean => useDesign() === 'tide'
