/**
 * What the visual gallery (scripts/visuals/gallery.mjs) needs from Tide's own code, bundled by vite
 * so the frame is served exactly as the app serves it: the frame document and its headers
 * (shared/visuals), Tide's libraries (main/visualLibs), the kit visuals and trace injection.
 */
export { frameResponse, frameUrl, VISUAL_SCHEME } from '../../src/shared/visuals'
export { libraryResponse } from '../../src/main/visualLibs'
export { KIT_VISUALS } from '../../src/shared/kitVisuals'
export { traceSourceOf, withTrace, cleanTrace } from '../../src/shared/pyTrace'
