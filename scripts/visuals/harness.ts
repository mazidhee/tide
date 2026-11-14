/**
 * What the visual gallery and the scene pre-generator (scripts/visuals) need from Tide's own code,
 * bundled by vite so the frame is served exactly as the app serves it: the frame document and its
 * headers (shared/visuals), Tide's libraries (main/visualLibs), the kit visuals, trace injection,
 * and the modules, the scene prompts and the kept-visual files.
 */
export { frameResponse, frameUrl, VISUAL_SCHEME, extractVisual, looksComplete, visualTitle, repairPrompt, VISUAL_REPAIR_SYSTEM, MAX_SCENE } from '../../src/shared/visuals'
export { libraryResponse } from '../../src/main/visualLibs'
export { KIT_VISUALS, kitVisualFor } from '../../src/shared/kitVisuals'
export { traceSourceOf, withTrace, cleanTrace } from '../../src/shared/pyTrace'
export { parseModule } from '../../src/shared/modules'
export { PART_SCENE_SYSTEM, SCENE_REPAIR_NOTE, partBrief, partScenePrompt, partKey, partFile, keptText, readKept, usable } from '../../src/shared/sceneCache'
export { CLAUDE_DEFAULTS } from '../../src/shared/claude'
