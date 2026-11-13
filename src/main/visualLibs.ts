/**
 * The libraries a visual's frame may load, served by Tide from tide-visual://<frame>/lib/… (main
 * visualFrames), built into the app: nothing comes from the network. Each is a classic script
 * (the frame is sandboxed with an opaque origin, which module scripts can't load from):
 *   /lib/tide-math.js  Tide's maths helpers and safe expression reader (shared/frame/tideMath.js)
 *   /lib/katex.js      KaTeX, with its stylesheet and fonts (as data: URLs) put in by the script
 *   /lib/three.js      three.js and OrbitControls, as window.THREE
 */
import { VISUAL_SCHEME, isFrameHost } from '@shared/visuals'
import tideMath from '../shared/frame/tideMath.js?raw'
import katexJs from '../../node_modules/katex/dist/katex.min.js?raw'
import katexCss from '../../node_modules/katex/dist/katex.min.css?raw'
import threeCore from '../../node_modules/three/build/three.core.js?raw'
import threeModule from '../../node_modules/three/build/three.module.js?raw'
import orbit from '../../node_modules/three/examples/jsm/controls/OrbitControls.js?raw'

const fonts = import.meta.glob('../../node_modules/katex/dist/fonts/*.woff2', { query: '?inline', import: 'default', eager: true }) as Record<string, string>

/** "a, b as c" from an import list, as a destructuring "a, b: c" */
const importList = (list: string) =>
  list
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replace(/^(\w+)\s+as\s+(\w+)$/, '$1: $2'))
    .join(', ')

/** "a, b as c" from an export list, as object entries "a, c: b" */
const exportList = (list: string) =>
  list
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replace(/^(\w+)\s+as\s+(\w+)$/, '$2: $1'))
    .join(', ')

/**
 * A flat ES module (one import list, one export list, as three.js ships) as a classic script that
 * reads its imports from self.THREE and adds its exports to it. Re-exports are dropped: the module
 * they come from has already put them there.
 */
export function moduleToClassic(src: string): string {
  const body = src
    .replace(/^import\s*\{([^}]*)\}\s*from\s*['"][^'"]+['"];?/gm, (_m, list: string) => `const { ${importList(list)} } = self.THREE;`)
    .replace(/^export\s*\{[^}]*\}\s*from\s*['"][^'"]+['"];?/gm, '')
    .replace(/^export\s*\{([^}]*)\};?/gm, (_m, list: string) => `Object.assign(self.THREE, { ${exportList(list)} });`)
  return `(function () {\n'use strict';\nself.THREE = self.THREE || {};\n${body}\n})();\n`
}

/** KaTeX's stylesheet with its fonts inlined (woff2 only), put in the page by the script that loads KaTeX */
function katexBundle(): string {
  const byName = new Map(Object.entries(fonts).map(([path, url]) => [path.split('/').pop()!, url]))
  const css = katexCss.replace(/src:[^;}]*;?/g, (decl) => {
    const m = /url\(fonts\/([^)]+\.woff2)\)/.exec(decl)
    const url = m && byName.get(m[1])
    return url ? `src:url(${url}) format("woff2");` : ''
  })
  return `${katexJs}\n;(function () { var s = document.createElement('style'); s.textContent = ${JSON.stringify(css)}; document.head.appendChild(s); })();\n`
}

let built: Map<string, string> | null = null

/** The library files, by path */
export function visualLibraries(): Map<string, string> {
  built ??= new Map([
    ['/lib/tide-math.js', tideMath],
    ['/lib/katex.js', katexBundle()],
    ['/lib/three.js', [moduleToClassic(threeCore), moduleToClassic(threeModule), moduleToClassic(orbit)].join('\n')]
  ])
  return built
}

/** A library file for a frame's request (tide-visual://<frame host>/lib/…), or null */
export function libraryFor(url: string, method = 'GET'): ReturnType<typeof libraryResponse> {
  if (method !== 'GET') return null
  try {
    const u = new URL(url)
    return u.protocol === `${VISUAL_SCHEME}:` && isFrameHost(u.hostname) && u.pathname.startsWith('/lib/') ? libraryResponse(u.pathname) : null
  } catch {
    return null
  }
}

/** A library file's response, or null when there is no such file */
export function libraryResponse(pathname: string): { body: string; headers: Record<string, string> } | null {
  const body = visualLibraries().get(pathname)
  if (body === undefined) return null
  return {
    body,
    headers: {
      'content-type': 'text/javascript; charset=utf-8',
      'x-content-type-options': 'nosniff',
      // The frame's origin is opaque: a same-origin policy would refuse its own scripts
      'cross-origin-resource-policy': 'cross-origin',
      'cache-control': 'max-age=3600'
    }
  }
}
