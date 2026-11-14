/**
 * Visuals Claude writes for one concept: a ```visual block holding a small, self-contained
 * HTML/SVG/canvas program, run by Tide in a sandboxed frame inside the lesson (renderer
 * lib/visuals, main visualFrames). Everything here is pure, so the frame's document, its message
 * schema and the tutor's instructions can be tested without a browser.
 *
 * Security, in layers:
 * - the frame is <iframe sandbox="allow-scripts"> (never allow-same-origin), so it has an opaque
 *   origin: it cannot touch the app's window, its storage, window.tide or Node;
 * - it is served from the tide-visual: scheme with its own CSP (VISUAL_CSP): no network of any
 *   kind, no nested frames, objects, workers or forms; scripts only inline, inside the frame;
 * - each frame gets its own host (tide-visual://v<random>/), so Chromium runs it in its own
 *   process: a runaway loop freezes only that process, which main kills (CPU, memory, a missed
 *   heartbeat);
 * - the bootstrap (FRAME_BOOTSTRAP) runs before the visual's own code and removes what CSP does
 *   not cover (WebRTC, nested frames, preconnect hints);
 * - main blocks any navigation of a visual frame away from tide-visual: and denies it every
 *   permission;
 * - the frame talks to Tide only by postMessage, and every message is checked against
 *   parseFrameMessage before Tide acts on it.
 */

import { KIT_VISUALS } from './kitVisuals'

export const VISUAL_SCHEME = 'tide-visual'

/** The ids of Tide's own kit visuals, for the tutor */
const kitVisualIds = () => KIT_VISUALS.map((v) => v.id).join(', ')

/** Whether a fenced block is a visual: labelled visual (or html-visual, which some write) */
export const isVisualSource = (lang: string) => /^(visual|html-visual|tide-visual)$/i.test(lang.trim())

/** Whether a fenced block asks for a visual of a concept (```draw): Tide's own, a kept one, or one written once by the visual model */
export const isDrawSource = (lang: string) => /^draw$/i.test(lang.trim())

/** What a ```draw block asks for: concept: …, show: … (or just the concept on its own) */
export function parseDraw(text: string): { concept: string; show: string } | null {
  const t = text.trim()
  if (!t) return null
  const field = (k: string) => new RegExp(`^\\s*${k}\\s*:\\s*(.+)$`, 'im').exec(t)?.[1].trim() ?? ''
  const concept = (field('concept') || (/^\s*\w+\s*:/.test(t) ? '' : t.split('\n')[0])).slice(0, 120)
  const show = field('show').slice(0, 400)
  return concept ? { concept, show } : null
}

/**
 * A block looks complete: it ends at a closing tag and its <script> tags are balanced. The text
 * of a reply streams in; a visual is only tried once its block stops changing and looks whole.
 */
export function looksComplete(code: string): boolean {
  const t = code.trim()
  if (t.length < 20 || !t.endsWith('>')) return false
  const opens = (t.match(/<script\b/gi) ?? []).length
  const closes = (t.match(/<\/script\s*>/gi) ?? []).length
  return opens === closes
}

/** The visual's title, from its <title> or first <h1>-<h3>, for the frame around it */
export function visualTitle(code: string): string {
  const m = /<title>([^<]{1,120})<\/title>/i.exec(code) ?? /<h[1-3][^>]*>([^<]{1,120})<\/h[1-3]>/i.exec(code)
  return m ? m[1].replace(/\s+/g, ' ').trim() : ''
}

/** A short, stable key for a visual's source: its place in a lesson's cache */
export function visualKey(code: string): string {
  // FNV-1a, twice with different seeds: 64 bits, the same in the renderer and in main
  let a = 0x811c9dc5
  let b = 0x01000193 ^ code.length
  for (let i = 0; i < code.length; i++) {
    const c = code.charCodeAt(i)
    a = Math.imul(a ^ c, 0x01000193) >>> 0
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0
  }
  return `v${a.toString(36)}${b.toString(36)}`
}

// ---------- The frame ----------

/**
 * The frame's own policy. No network at all: nothing may be fetched, connected to, framed,
 * embedded or submitted. Scripts and styles only inline (inside the frame); images, fonts and
 * media only from data: and blob: URLs the visual makes itself.
 */
export const VISUAL_CSP = [
  "default-src 'none'",
  // Inline scripts, and Tide's own libraries served to the frame at /lib/ (main visualLibs)
  "script-src 'unsafe-inline' tide-visual:",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  'media-src data: blob:',
  "connect-src 'none'",
  "frame-src 'none'",
  "child-src 'none'",
  "worker-src 'none'",
  "object-src 'none'",
  "manifest-src 'none'",
  "form-action 'none'",
  "base-uri 'none'"
].join('; ')

/** Powerful features the frame never gets, whatever it asks */
export const VISUAL_PERMISSIONS_POLICY = [
  'accelerometer',
  'ambient-light-sensor',
  'autoplay',
  'bluetooth',
  'camera',
  'clipboard-read',
  'clipboard-write',
  'display-capture',
  'encrypted-media',
  'fullscreen',
  'gamepad',
  'geolocation',
  'gyroscope',
  'hid',
  'idle-detection',
  'local-fonts',
  'magnetometer',
  'microphone',
  'midi',
  'payment',
  'publickey-credentials-get',
  'screen-wake-lock',
  'serial',
  'storage-access',
  'usb',
  'web-share',
  'window-management',
  'xr-spatial-tracking'
]
  .map((f) => `${f}=()`)
  .join(', ')

/** The response headers the frame is served with */
export const VISUAL_HEADERS: Record<string, string> = {
  'content-type': 'text/html; charset=utf-8',
  'content-security-policy': VISUAL_CSP,
  'permissions-policy': VISUAL_PERMISSIONS_POLICY,
  'x-dns-prefetch-control': 'off',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store',
  'cross-origin-resource-policy': 'same-origin'
}

/** A frame's host: v and 6 to 24 letters or digits, fresh for each frame (so each gets its own process) */
export const isFrameHost = (host: string) => /^v[a-z0-9]{6,24}$/.test(host)

/** Theme tokens, as CSS colours, handed to the frame (renderer lib/visuals reads them from the app's theme) */
export interface VisualTheme {
  scheme: 'light' | 'dark'
  tokens: Record<string, string>
}

/** The tokens a visual may use, as CSS variables in the frame */
export const THEME_TOKENS = ['bg', 'surface', 'ink', 'ink-soft', 'muted', 'line', 'line-strong', 'accent', 'accent-soft', 'pos', 'neg', 'good', 'bad', 'warn', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6'] as const

/** A colour Tide's theme could produce: rgb()/rgba()/hex/a plain name, nothing that could close the rule */
const COLOUR = /^(#[0-9a-f]{3,8}|rgba?\([\d.,\s%/]+\)|color\(srgb[\d.\s/%]+\)|[a-z]{3,20})$/i

export function themeCss(theme: VisualTheme | null): string {
  const scheme = theme?.scheme === 'dark' ? 'dark' : 'light'
  const lines = [`color-scheme: ${scheme};`]
  for (const t of THEME_TOKENS) {
    const v = theme?.tokens[t]
    if (v && COLOUR.test(v.trim())) lines.push(`--${t}: ${v.trim()};`)
  }
  return `:root { ${lines.join(' ')} }`
}

/** Fallbacks when no theme came, and the frame's base look: Tide's type, controls and focus */
const BASE_CSS = `
:root { --bg: #fff; --surface: #f6f5f2; --ink: #1d1d1f; --ink-soft: #4a4a4f; --muted: #86868b; --line: rgba(0,0,0,.09); --line-strong: rgba(0,0,0,.16);
  --accent: #2f8f7f; --accent-soft: rgba(47,143,127,.14); --pos: #2f6fd6; --neg: #c8641a; --good: #199e70; --bad: #d1453b; --warn: #c98500;
  --c1: #3987e5; --c2: #d95926; --c3: #199e70; --c4: #c98500; --c5: #d55181; --c6: #008300;
  --font: -apple-system, BlinkMacSystemFont, 'Inter', 'Helvetica Neue', sans-serif; --mono: ui-monospace, 'SF Mono', Menlo, monospace; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: var(--bg); color: var(--ink); font: 13px/1.45 var(--font); -webkit-font-smoothing: antialiased; overflow: hidden; }
body { padding: 12px 16px 14px; }
svg { display: block; max-width: 100%; height: auto; overflow: visible; }
/* Zero specificity and only where no fill is given: a fill attribute or any rule of the visual's own wins */
:where(svg text:not([fill])) { fill: var(--ink); }
:where(svg text) { font-family: var(--font); }
canvas { display: block; max-width: 100%; }
button, input, select { font: inherit; color: inherit; }
button { height: 28px; padding: 0 12px; border: 0; border-radius: 7px; background: color-mix(in srgb, var(--ink) 8%, var(--bg)); font-size: 12px; font-weight: 550; cursor: pointer; transition: background-color 120ms ease; }
button:hover { background: color-mix(in srgb, var(--ink) 12%, var(--bg)); }
button[aria-pressed='true'] { background: var(--accent-soft); box-shadow: inset 0 0 0 1px var(--accent); }
button:disabled { opacity: .4; cursor: default; }
input[type='range'] { accent-color: var(--accent); }
label { color: var(--ink-soft); }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
code, .mono { font-family: var(--mono); font-size: 12px; }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition: none !important; animation: none !important; } }
`

/**
 * Runs inside the frame before the visual's own code. It removes what the frame's CSP doesn't
 * cover, watches for errors and a stuck main thread, and gives the visual the small host API
 * (window.visual) through which it reaches Tide: steps, reports and selections, by postMessage.
 * Plain ES2020 in a string, so it runs as written whatever builds the app.
 */
export const FRAME_BOOTSTRAP = String.raw`(function () {
  'use strict';
  var P = window.parent;
  var send = function (m) { m.tv = 1; try { P.postMessage(m, '*'); } catch (e) {} };
  var cut = function (s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

  // ---- What CSP can't stop ----
  // WebRTC reaches the network without fetch (STUN and TURN). A nested frame can't hand the
  // constructors back: it has an opaque origin of its own, so the visual can't reach into it.
  Object.getOwnPropertyNames(window).forEach(function (k) {
    if (/^(webkit)?RTC|^(webkit)?MediaStream|^WebTransport|^PresentationRequest|^BroadcastChannel$|^SharedWorker$/.test(k)) {
      try { Object.defineProperty(window, k, { value: undefined, writable: false, configurable: false }); } catch (e) {}
    }
  });
  try { Object.defineProperty(Navigator.prototype, 'mediaDevices', { get: function () { return undefined; }, configurable: false }); } catch (e) {}
  try { Object.defineProperty(Navigator.prototype, 'sendBeacon', { value: function () { return false; }, configurable: false }); } catch (e) {}
  // Nested frames, plugins and resource hints (a hint opens a connection without fetching)
  var BANNED = 'iframe,frame,frameset,object,embed,portal,fencedframe,link,meta[http-equiv],base,script[type="speculationrules" i]';
  var said = {};
  var removed = function (el) {
    var tag = el.tagName.toLowerCase();
    if (!said[tag]) { said[tag] = 1; send({ t: 'error', msg: 'Tide removed a <' + tag + '>: visuals cannot load, link or frame anything.' }); }
    el.remove();
  };
  var strip = function (root) {
    if (!root || root.nodeType !== 1 && root.nodeType !== 11 && root.nodeType !== 9) return;
    if (root.nodeType === 1 && root.matches(BANNED)) return removed(root);
    var all = root.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      if (all[i].matches(BANNED)) removed(all[i]);
      else if (all[i].shadowRoot) strip(all[i].shadowRoot);
    }
  };
  new MutationObserver(function (records) {
    for (var r = 0; r < records.length; r++) for (var n = 0; n < records[r].addedNodes.length; n++) strip(records[r].addedNodes[n]);
  }).observe(document, { childList: true, subtree: true });
  // Inserted by script: taken out before it is connected, so it never loads
  var guard = function (proto, name) {
    var orig = proto && proto[name];
    if (typeof orig !== 'function') return;
    var single = name === 'appendChild' || name === 'insertBefore' || name === 'replaceChild' || name === 'insertAdjacentElement';
    Object.defineProperty(proto, name, { configurable: false, writable: false, value: function () {
      var args = Array.prototype.slice.call(arguments);
      var node = name === 'insertAdjacentElement' ? args[1] : args[0];
      if (single) {
        // The node itself is banned: it is never put in (and what would have come back is returned)
        if (node && node.nodeType === 1 && node.matches(BANNED)) { removed(node); return name === 'replaceChild' ? args[1] : node; }
        strip(node);
        return orig.apply(this, args);
      }
      var kept = [];
      for (var i = 0; i < args.length; i++) {
        var a = args[i];
        if (a && a.nodeType === 1 && a.matches(BANNED)) { removed(a); continue; }
        strip(a);
        kept.push(a);
      }
      return orig.apply(this, kept);
    } });
  };
  ['appendChild', 'insertBefore', 'replaceChild'].forEach(function (n) { guard(Node.prototype, n); });
  [Element.prototype, Document.prototype, DocumentFragment.prototype].forEach(function (proto) {
    ['append', 'prepend', 'replaceChildren', 'after', 'before', 'replaceWith', 'insertAdjacentElement'].forEach(function (n) { if (Object.prototype.hasOwnProperty.call(proto, n)) guard(proto, n); });
  });
  if (typeof CharacterData !== 'undefined') ['after', 'before', 'replaceWith'].forEach(function (n) { guard(CharacterData.prototype, n); });
  if (typeof DocumentType !== 'undefined') ['after', 'before', 'replaceWith'].forEach(function (n) { guard(DocumentType.prototype, n); });
  // HTML set as text: parsed in a detached copy of its context (the same tag and namespace, so
  // SVG stays SVG and scripts stay inert, as innerHTML leaves them), checked, then moved in
  var origInner = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  var origShadowInner = Object.getOwnPropertyDescriptor(ShadowRoot.prototype, 'innerHTML');
  var parsedIn = function (context, html) {
    var temp = context && context.nodeType === 1 ? context.cloneNode(false) : document.createElement('div');
    origInner.set.call(temp, String(html));
    strip(temp);
    return Array.prototype.slice.call(temp.childNodes);
  };
  var nodes = function (list) { var f = document.createDocumentFragment(); for (var i = 0; i < list.length; i++) f.appendChild(list[i]); return f; };
  Object.defineProperty(Element.prototype, 'innerHTML', { configurable: false, get: origInner.get, set: function (v) {
    if (this.tagName === 'TEMPLATE' || this.tagName === 'SCRIPT' || this.tagName === 'STYLE') { origInner.set.call(this, v); if (this.content) strip(this.content); return; }
    this.replaceChildren(nodes(parsedIn(this, v)));
  } });
  Object.defineProperty(ShadowRoot.prototype, 'innerHTML', { configurable: false, get: origShadowInner.get, set: function (v) { this.replaceChildren(nodes(parsedIn(this.host, v))); } });
  var origOuter = Object.getOwnPropertyDescriptor(Element.prototype, 'outerHTML');
  Object.defineProperty(Element.prototype, 'outerHTML', { configurable: false, get: origOuter.get, set: function (v) {
    if (!this.parentNode) return;
    this.replaceWith(nodes(parsedIn(this.parentNode.nodeType === 1 ? this.parentNode : null, v)));
  } });
  Object.defineProperty(Element.prototype, 'insertAdjacentHTML', { configurable: false, writable: false, value: function (pos, html) {
    var p = String(pos).toLowerCase(), outside = p === 'beforebegin' || p === 'afterend';
    var f = nodes(parsedIn(outside ? (this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null) : this, html));
    if (p === 'beforebegin') this.before(f); else if (p === 'afterbegin') this.prepend(f); else if (p === 'beforeend') this.append(f); else if (p === 'afterend') this.after(f);
    else throw new SyntaxError('insertAdjacentHTML: bad position');
  } });
  var cfrag = Range.prototype.createContextualFragment;
  Object.defineProperty(Range.prototype, 'createContextualFragment', { configurable: false, writable: false, value: function (html) { var f = cfrag.call(this, html); strip(f); return f; } });
  // Ways to parse HTML that could carry a closed shadow root past the checks: not offered
  var refuse = function (proto, n) {
    if (!proto || typeof proto[n] !== 'function') return;
    Object.defineProperty(proto, n, { configurable: false, writable: false, value: function () { throw new Error(n + ' is not available in a visual: use innerHTML'); } });
  };
  refuse(Element.prototype, 'setHTMLUnsafe'); refuse(ShadowRoot.prototype, 'setHTMLUnsafe'); refuse(Document, 'parseHTMLUnsafe');
  refuse(Element.prototype, 'setHTML'); refuse(ShadowRoot.prototype, 'setHTML');
  ['write', 'writeln', 'open'].forEach(function (n) { refuse(Document.prototype, n); });
  // Modal dialogs would stop the frame (and are blocked by the sandbox anyway): say so instead
  ['alert', 'confirm', 'prompt', 'print'].forEach(function (n) {
    try { Object.defineProperty(window, n, { configurable: false, writable: false, value: function () { send({ t: 'error', msg: n + '() is not available in a visual: show it on the page instead.' }); return n === 'confirm' ? false : null; } }); } catch (e) {}
  });

  // ---- Errors ----
  addEventListener('error', function (e) {
    if (e.target && e.target !== window && e.target.tagName) { send({ t: 'error', msg: 'A <' + e.target.tagName.toLowerCase() + '> failed to load: visuals can only use data: URLs.' }); return; }
    send({ t: 'error', msg: cut((e.message || 'Script error') + (e.lineno ? ' (line ' + e.lineno + ', column ' + e.colno + ')' : ''), 400) });
  }, true);
  addEventListener('unhandledrejection', function (e) { send({ t: 'error', msg: cut('Unhandled promise rejection: ' + (e.reason && e.reason.message || e.reason), 400) }); });
  document.addEventListener('securitypolicyviolation', function (e) {
    send({ t: 'error', msg: cut('Blocked by the sandbox (' + e.effectiveDirective + (e.blockedURI ? ': ' + e.blockedURI : '') + '): visuals have no network and load nothing.', 400) });
  });
  var cerr = console.error;
  console.error = function () { send({ t: 'warn', msg: cut(Array.prototype.map.call(arguments, String).join(' '), 300) }); return cerr.apply(console, arguments); };

  // ---- Heartbeat: Tide stops a frame whose main thread stops answering ----
  setInterval(function () { send({ t: 'beat' }); }, 400);

  // ---- Size ----
  var lastH = 0;
  // The body's own height (the document's is never less than the frame's, so it could only grow)
  var measure = function () {
    var h = document.body ? Math.ceil(document.body.scrollHeight) : 0;
    if (Math.abs(h - lastH) > 1) { lastH = h; send({ t: 'size', h: h }); }
  };

  // ---- The host API ----
  var steps = null, at = 0, timer = 0, resetters = [], themers = [];
  var reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var say = function () { return steps && steps.captions ? steps.captions[at] || '' : steps && steps.said ? steps.said : ''; };
  var tell = function () { if (steps) send({ t: 'steps', i: at, n: steps.n, say: cut(say(), 300), playing: !!timer }); };
  var draw = function () {
    if (!steps) return;
    try { var r = steps.draw(at); if (typeof r === 'string') steps.said = r; } catch (e) { send({ t: 'error', msg: cut('Drawing step ' + (at + 1) + ' failed: ' + (e && e.message || e), 400) }); }
    tell();
  };
  var stop = function () { if (timer) { clearInterval(timer); timer = 0; } };
  var go = function (i) { if (!steps) return; at = Math.max(0, Math.min(steps.n - 1, i | 0)); draw(); };
  var play = function () {
    if (!steps || timer) return;
    if (at >= steps.n - 1) go(0);
    timer = setInterval(function () { if (at >= steps.n - 1) { stop(); tell(); return; } go(at + 1); }, steps.ms);
    tell();
  };
  var control = function (action, i) {
    if (action === 'play') play();
    else if (action === 'pause') { stop(); tell(); }
    else if (action === 'next') { stop(); go(at + 1); }
    else if (action === 'back') { stop(); go(at - 1); }
    else if (action === 'goto') { stop(); go(i); }
    else if (action === 'reset') {
      stop();
      resetters.forEach(function (f) { try { f(); } catch (e) { send({ t: 'error', msg: cut('Reset failed: ' + (e && e.message || e), 300) }); } });
      if (steps) go(0);
    }
    else if (action === 'audit') audit();
  };
  // ---- Legibility: labels that overlap, or run off the edge ----
  var labels = function () {
    var out = [], els = document.body ? document.body.querySelectorAll('text, p, span, div, td, th, label, button, li, h1, h2, h3, h4, b, strong, em, code') : [];
    for (var i = 0; i < els.length && out.length < 400; i++) {
      var el = els[i];
      if (el.tagName !== 'text' && el.children.length) continue;
      var t = (el.textContent || '').trim();
      if (!t) continue;
      var cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue;
      var r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      out.push({ t: t.slice(0, 40), r: r });
    }
    return out;
  };
  var layoutProblems = function (where) {
    var found = [], ls = labels(), W = document.documentElement.clientWidth;
    for (var i = 0; i < ls.length && found.length < 3; i++) {
      var a = ls[i].r;
      if (a.right > W + 2 || a.left < -2) { found.push(where + 'the label "' + ls[i].t + '" runs off the edge of the frame.'); continue; }
      for (var j = i + 1; j < ls.length && found.length < 3; j++) {
        var b = ls[j].r;
        var w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (w <= 0 || h <= 0 || ls[i].t === ls[j].t) continue;
        var small = Math.min(a.width * a.height, b.width * b.height);
        if (w * h > 0.25 * small) found.push(where + 'the labels "' + ls[i].t + '" and "' + ls[j].t + '" overlap.');
      }
    }
    return found;
  };
  // Every step drawn once, before the visual is shown: errors and unreadable layouts in any of them
  var audit = function () {
    var problems = [], n = steps ? steps.n : 1;
    stop();
    for (var i = 0; i < n && problems.length < 6; i++) {
      if (steps) {
        try { var r = steps.draw(i); if (typeof r === 'string') steps.said = r; } catch (e) { problems.push(cut('Drawing step ' + (i + 1) + ' failed: ' + (e && e.message || e), 300)); continue; }
      }
      problems = problems.concat(layoutProblems(steps ? 'At step ' + (i + 1) + ', ' : ''));
    }
    if (steps) { at = 0; draw(); }
    send({ t: 'audit', problems: problems.slice(0, 6) });
  };
  var clean2 = function (data) {
    if (!data || typeof data !== 'object') return undefined;
    var out = {}, n = 0;
    Object.keys(data).slice(0, 12).forEach(function (k) {
      var v = data[k];
      if (typeof v === 'number' && isFinite(v)) out[cut(k, 40)] = Math.round(v * 1e4) / 1e4;
      else if (typeof v === 'string' || typeof v === 'boolean') out[cut(k, 40)] = typeof v === 'string' ? cut(v, 80) : v;
      else return;
      n++;
    });
    return n ? out : undefined;
  };
  var lastReport = 0;
  var api = {
    /** steps(captions or count, draw[, ms]): Tide shows Back, Play, Step and Reset, and the caption */
    steps: function (spec, fn, ms) {
      if (typeof fn !== 'function') throw new TypeError('visual.steps needs a draw function');
      var captions = Array.isArray(spec) ? spec.map(function (s) { return String(s); }) : null;
      var n = captions ? captions.length : Math.max(1, spec | 0);
      steps = { n: n, captions: captions, draw: fn, ms: Math.max(250, Math.min(5000, ms || 1200)), said: '' };
      at = 0;
      setTimeout(draw, 0);
    },
    next: function () { control('next'); },
    back: function () { control('back'); },
    goTo: function (i) { control('goto', i); },
    get step() { return at; },
    onReset: function (fn) { if (typeof fn === 'function') resetters.push(fn); },
    /** report(text[, data]): tells the tutor what the learner did or sees now */
    report: function (text, data) {
      var now = Date.now();
      if (now - lastReport < 150) return;
      lastReport = now;
      send({ t: 'report', text: cut(text, 400), data: clean2(data) });
    },
    /** predict(question, value): the learner locked in a prediction before the answer was shown */
    predict: function (question, value) { send({ t: 'predict', question: cut(question, 200), value: cut(value, 80) }); },
    /** goal(text, met): a small target for the learner, and whether it is met now */
    goal: function (text, met) { send({ t: 'goal', text: cut(text, 200), met: !!met }); },
    /** select(label[, data]): the learner picked a part; Tide offers "Ask about this" */
    select: function (label, data) { send({ t: 'select', label: cut(label, 200), data: clean2(data) }); },
    theme: {},
    onTheme: function (fn) { if (typeof fn === 'function') themers.push(fn); },
    reducedMotion: reduced,
    color: function (name) { return getComputedStyle(document.documentElement).getPropertyValue('--' + name).trim(); }
  };
  var readTheme = function () {
    var cs = getComputedStyle(document.documentElement), t = {};
    ['bg','surface','ink','ink-soft','muted','line','line-strong','accent','accent-soft','pos','neg','good','bad','warn','c1','c2','c3','c4','c5','c6'].forEach(function (k) { t[k] = cs.getPropertyValue('--' + k).trim(); });
    api.theme = t;
  };
  Object.defineProperty(window, 'visual', { value: api, writable: false, configurable: false });

  // ---- Messages from Tide: only from the parent, only these shapes ----
  addEventListener('message', function (e) {
    if (e.source !== P) return;
    var m = e.data;
    if (!m || m.tv !== 1 || typeof m.t !== 'string') return;
    if (m.t === 'control' && typeof m.action === 'string') control(m.action, typeof m.i === 'number' ? m.i : 0);
    else if (m.t === 'theme' && m.css && typeof m.css === 'string' && m.css.length < 4000 && !/[<>{}]/.test(m.css.replace(/^:root \{|\}$/g, ''))) {
      var s = document.getElementById('tide-theme');
      if (s) s.textContent = m.css;
      readTheme();
      themers.forEach(function (f) { try { f(api.theme); } catch (err) {} });
    }
  });

  // ---- Keys: Tide's steps work from inside the frame too ----
  addEventListener('keydown', function (e) {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    var tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (!steps) return;
    if (e.key === 'ArrowRight') { control('next'); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { control('back'); e.preventDefault(); }
    else if (e.key === ' ' && tag !== 'BUTTON') { timer ? control('pause') : control('play'); e.preventDefault(); }
  });

  // ---- Ready ----
  addEventListener('DOMContentLoaded', readTheme);
  addEventListener('load', function () {
    readTheme();
    setTimeout(function () {
      measure();
      if (document.body) new ResizeObserver(measure).observe(document.body);
      var b = document.body, drawn = false;
      if (b) {
        var els = b.querySelectorAll('svg, canvas, button, input, table, div, p, span, img');
        for (var i = 0; i < els.length && !drawn; i++) { var r = els[i].getBoundingClientRect(); drawn = r.width > 4 && r.height > 4; }
        drawn = drawn || (b.innerText || '').trim().length > 0;
      }
      send({ t: 'ready', h: lastH, drawn: drawn, steps: steps ? steps.n : 0 });
    }, 60);
  });
})();`

/** The whole document the frame is served: Tide's base look, the theme, the bootstrap, then the visual */
export function frameDocument(code: string, theme: VisualTheme | null): string {
  // The visual's text goes in the body as written: it can't reach outside the frame whatever it holds
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${BASE_CSS}</style><style id="tide-theme">${themeCss(theme)}</style><script>${FRAME_BOOTSTRAP}</script><script src="/lib/tide-math.js"></script><script src="/lib/tide-machine.js"></script></head><body>\n${code}\n</body></html>`
}

// base64url of UTF-8, both ways (the frame's code travels in its URL, so its document needs no state in main)
export function toBase64Url(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromBase64Url(s: string): string {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

/** Largest visual a lesson keeps, in characters */
export const MAX_VISUAL = 60_000
/** Largest 3D scene (a module part's big picture, main/conceptVisuals) */
export const MAX_SCENE = 140_000
/** Largest document a frame is given: a scene, or a visual with its Python trace in front */
export const MAX_FRAME = 240_000

export function frameUrl(host: string, code: string, theme: VisualTheme | null): string {
  return `${VISUAL_SCHEME}://${host}/?c=${toBase64Url(code.slice(0, MAX_FRAME))}&t=${toBase64Url(JSON.stringify(theme ?? null))}`
}

/** The frame's document for a request to tide-visual: (main's protocol handler), or null to refuse it */
export function frameResponse(url: string, method = 'GET'): { body: string; headers: Record<string, string> } | null {
  if (method !== 'GET') return null
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (u.protocol !== `${VISUAL_SCHEME}:` || !isFrameHost(u.hostname) || (u.pathname !== '/' && u.pathname !== '')) return null
  const c = u.searchParams.get('c')
  if (!c || c.length > MAX_FRAME * 2) return null
  let code: string
  let theme: VisualTheme | null = null
  try {
    code = fromBase64Url(c)
    const t = u.searchParams.get('t')
    const parsed = t ? (JSON.parse(fromBase64Url(t)) as unknown) : null
    if (parsed && typeof parsed === 'object' && 'tokens' in parsed) {
      const p = parsed as { scheme?: unknown; tokens?: unknown }
      const tokens: Record<string, string> = {}
      if (p.tokens && typeof p.tokens === 'object') for (const [k, v] of Object.entries(p.tokens)) if (typeof v === 'string' && (THEME_TOKENS as readonly string[]).includes(k)) tokens[k] = v
      theme = { scheme: p.scheme === 'dark' ? 'dark' : 'light', tokens }
    }
  } catch {
    return null
  }
  return { body: frameDocument(code, theme), headers: { ...VISUAL_HEADERS } }
}

// ---------- Messages ----------

export type FrameMessage =
  | { t: 'ready'; h: number; drawn: boolean; steps: number }
  | { t: 'size'; h: number }
  | { t: 'beat' }
  | { t: 'error'; msg: string }
  | { t: 'warn'; msg: string }
  | { t: 'steps'; i: number; n: number; say: string; playing: boolean }
  | { t: 'report'; text: string; data?: Record<string, number | string | boolean> }
  | { t: 'select'; label: string; data?: Record<string, number | string | boolean> }
  /** Every step drawn once, hidden: what was wrong in any of them */
  | { t: 'audit'; problems: string[] }
  /** The learner's prediction, locked in before the answer showed */
  | { t: 'predict'; question: string; value: string }
  /** A small target, and whether it is met */
  | { t: 'goal'; text: string; met: boolean }

const str = (v: unknown, max: number): string | null => (typeof v === 'string' ? (v.length > max ? v.slice(0, max) : v) : null)
const int = (v: unknown, lo: number, hi: number): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : null)

function data(v: unknown): Record<string, number | string | boolean> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
  const out: Record<string, number | string | boolean> = {}
  for (const [k, x] of Object.entries(v as Record<string, unknown>).slice(0, 12)) {
    const key = k.slice(0, 40)
    if (typeof x === 'number' && Number.isFinite(x)) out[key] = x
    else if (typeof x === 'boolean') out[key] = x
    else if (typeof x === 'string') out[key] = x.slice(0, 80)
  }
  return Object.keys(out).length ? out : undefined
}

/**
 * A message from a frame, checked field by field; null for anything else. Whatever a visual
 * sends, Tide only ever sees these shapes, with these limits.
 */
export function parseFrameMessage(m: unknown): FrameMessage | null {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return null
  const o = m as Record<string, unknown>
  if (o.tv !== 1 || typeof o.t !== 'string') return null
  switch (o.t) {
    case 'ready': {
      const h = int(o.h, 0, 100_000)
      return h === null ? null : { t: 'ready', h, drawn: o.drawn === true, steps: int(o.steps, 0, 10_000) ?? 0 }
    }
    case 'size': {
      const h = int(o.h, 0, 100_000)
      return h === null ? null : { t: 'size', h }
    }
    case 'beat':
      return { t: 'beat' }
    case 'error':
    case 'warn': {
      const msg = str(o.msg, 400)
      return msg === null ? null : { t: o.t, msg }
    }
    case 'steps': {
      const n = int(o.n, 1, 10_000)
      const i = int(o.i, 0, 10_000)
      if (n === null || i === null) return null
      return { t: 'steps', i: Math.min(i, n - 1), n, say: str(o.say, 300) ?? '', playing: o.playing === true }
    }
    case 'report': {
      const text = str(o.text, 400)
      return text === null ? null : { t: 'report', text, data: data(o.data) }
    }
    case 'audit':
      return Array.isArray(o.problems) ? { t: 'audit', problems: o.problems.filter((p): p is string => typeof p === 'string').slice(0, 6).map((p) => p.slice(0, 300)) } : null
    case 'predict': {
      const question = str(o.question, 200)
      const value = str(o.value, 80)
      return question === null || value === null || !value.trim() ? null : { t: 'predict', question, value }
    }
    case 'goal': {
      const text = str(o.text, 200)
      return text === null || !text.trim() ? null : { t: 'goal', text, met: o.met === true }
    }
    case 'select': {
      const label = str(o.label, 200)
      return label === null || !label.trim() ? null : { t: 'select', label, data: data(o.data) }
    }
    default:
      return null
  }
}

/** Messages a frame may send each second before Tide treats it as running away */
export const MAX_MESSAGES_PER_SECOND = 120

// ---------- What the tutor hears ----------

export interface VisualState {
  title: string
  step?: { i: number; n: number; say: string }
  report?: { text: string; data?: Record<string, number | string | boolean> }
  selected?: { label: string; data?: Record<string, number | string | boolean> }
  /** What they predicted before the answer showed */
  predicted?: { question: string; value: string }
  goal?: { text: string; met: boolean }
}

const values = (d?: Record<string, number | string | boolean>) =>
  d && Object.keys(d).length
    ? ` (${Object.entries(d)
        .map(([k, v]) => `${k} = ${v}`)
        .join(', ')})`
    : ''

/** What the visual shows now, in a sentence or two, for the tutor */
export function describeState(s: VisualState): string {
  const parts: string[] = []
  if (s.step) parts.push(`it is at step ${s.step.i + 1} of ${s.step.n}${s.step.say ? ` ("${s.step.say}")` : ''}`)
  if (s.report) parts.push(`the visual reports: ${s.report.text}${values(s.report.data)}`)
  if (s.selected) parts.push(`the learner selected ${s.selected.label}${values(s.selected.data)}`)
  if (s.predicted) parts.push(`they predicted "${s.predicted.value}" for "${s.predicted.question}"`)
  if (s.goal) parts.push(`its goal "${s.goal.text}" is ${s.goal.met ? 'met' : 'not met yet'}`)
  return parts.join('; ')
}

/** The hidden note sent with the learner's next message, when they have used a visual since the last one */
export const visualNote = (s: VisualState) => {
  const d = describeState(s)
  return d ? `(Tide: the learner has been using your visual${s.title ? ` "${s.title}"` : ''}: ${d}. If it bears on what they say, answer about exactly that state.)` : ''
}

/** "Tell the tutor": what the learner found, at the start of their answer, for them to finish */
export const tellTutor = (s: VisualState) => `From the visual${s.title ? ` "${s.title}"` : ''}: ${describeState(s) || 'I tried it'}. `

/** "What's happening here?" pressed on a visual */
export const whatsHappening = (s: VisualState) =>
  `What's happening here, in the visual${s.title ? ` "${s.title}"` : ''}?\n\n(Tide: ${describeState(s) || 'the learner has not changed anything yet'}. Explain exactly this state in two or three sentences, using its numbers, then ask them to predict what the next step will do, as an <ask>; they can press Step to check.)`

/** "Ask about this" on a part the learner selected */
export const askAboutPart = (s: VisualState) =>
  s.selected ? `In the visual${s.title ? ` "${s.title}"` : ''}, what is ${s.selected.label}${values(s.selected.data)}?\n\n(Tide: ${describeState(s)}. Answer about exactly this part and its values.)` : ''

// ---------- What Claude is told ----------

const EXAMPLE_STEPS = `<title>Hash map resize at load factor 0.75</title>
<svg id="m" viewBox="0 0 640 150" width="640" role="img" aria-label="Buckets of a hash map"></svg>
<script>
const keys = [12, 7, 33, 20, 5, 18, 41]
const plan = []  // every state, computed up front so Back and Reset are exact
let cap = 4, table = Array.from({ length: cap }, () => [])
for (const k of keys) {
  if ((table.flat().length + 1) / cap > 0.75) {
    plan.push({ t: table.map(b => b.slice()), cap, say: \`Inserting \${k} would make the load \${table.flat().length + 1}/\${cap} > 0.75: double to \${cap * 2} and rehash every key.\` })
    cap *= 2
    const old = table.flat(); table = Array.from({ length: cap }, () => [])
    for (const x of old) table[x % cap].push(x)
  }
  table[k % cap].push(k)
  plan.push({ t: table.map(b => b.slice()), cap, hot: k % cap, say: \`\${k} mod \${cap} = \${k % cap}: into bucket \${k % cap}.\` })
}
const svg = document.getElementById('m'), NS = 'http://www.w3.org/2000/svg'
const el = (tag, a, text) => { const e = document.createElementNS(NS, tag); for (const k in a) e.setAttribute(k, a[k]); if (text != null) e.textContent = text; return e }
visual.steps(plan.map(p => p.say), i => {
  const p = plan[i], w = 600 / p.cap
  svg.replaceChildren()
  p.t.forEach((bucket, b) => {
    const g = el('g', { tabindex: 0, role: 'button', 'aria-label': \`Bucket \${b}: \${bucket.join(', ') || 'empty'}\` })
    g.append(el('rect', { x: 20 + b * w, y: 20, width: w - 6, height: 90, rx: 6, fill: b === p.hot ? 'var(--accent-soft)' : 'none', stroke: b === p.hot ? 'var(--accent)' : 'var(--line-strong)' }))
    g.append(el('text', { x: 20 + b * w + (w - 6) / 2, y: 130, 'text-anchor': 'middle', fill: 'var(--muted)', 'font-size': 11 }, b))
    bucket.forEach((k, j) => g.append(el('text', { x: 20 + b * w + (w - 6) / 2, y: 44 + j * 18, 'text-anchor': 'middle', 'font-size': 13 }, k)))
    const pick = () => visual.select(\`bucket \${b}\`, { keys: bucket.join(' ') || 'none', capacity: p.cap })
    g.addEventListener('click', pick); g.addEventListener('keydown', e => e.key === 'Enter' && pick())
    svg.append(g)
  })
})
</script>`


const EXAMPLE_KIT = `<title>Signed bytes: the top bit weighs −128</title>
<div id="reg"></div>
<script>
const reg = TideMachine.bits('#reg', { n: 8, signed: true, value: 5 })
const values = [5, -5, 127, -128]
visual.steps(values.map(v => \`\${v} is \${TideMachine.bin(v, 8)}: add the place values of the lit bulbs.\`), i => reg.set(values[i]))
</script>`

const EXAMPLE_TRACE = `<title>A list holds references</title>
<script type="text/x-python">
row = [0] * 3
grid = [row] * 2
grid[0][0] = 5
print(grid)
</script>
<div id="py"></div>
<script>
const py = TideMachine.python('#py')
visual.steps(py.captions, py.draw)
</script>`

/** The computing kit, as the tutor (and the visual model) is told it */
export const KIT_GUIDE = `TideMachine, Tide's computing kit, is loaded in every frame too. Build with it rather than drawing hardware or memory by hand: it is checked, themed and accessible, and each part reports what the learner does.
  - TideMachine.bits(el, {n, value, signed, label, onChange}): a register of switches and light bulbs with place values (−2^(n−1) for the top bit when signed), the sum, and hex under each nibble. .set(v) .get() .mark(indexes, note).
  - TideMachine.circuit(el, spec): gates and wires that light as signals settle, one gate delay at a time. spec {inputs: ['A', 'B'], gates: [{id: 'g1', type: 'XOR', in: ['A', 'B']}], outputs: [{id: 'S', from: 'g1'}]}; types AND OR NOT NAND NOR XOR XNOR, blocks HA FA MUX (ports 'fa0.cout'); laid out by depth. Ready-made: TideMachine.circuits.halfAdder() fullAdder() mux2() rippleAdder(4). .set(inputs) .flip(inputs) .stepsFor(inputs, before) → {captions, draw}. TideMachine.truthTable(el, circuit).
  - TideMachine.memory(el, {size, base, cols}): addressed bytes. .writeInt(addr, v, {size, endian: 'little' | 'big', label}) .writeString(addr, s) .write(addr, bytes) .mark(addr, len, {label}) .pointer(fromAddr, toAddr) .focus(addr, len) .clear().
  - TideMachine.cpu(el, {asm, data}): a tiny 8-bit CPU (R0–R3, PC, IR, ALU, Z, 16 bytes of memory, buses) running LOADI LOAD STORE ADD SUB AND OR JMP JZ HALT, one step each for fetch, decode and execute: visual.steps(cpu.captions, cpu.draw).
  - TideMachine.python(el, {digits}): Python's frames, names, objects (type, id, refs) and the arrows between them, from a real trace: put the code (under 20 lines) in a <script type="text/x-python"> in the visual and Tide runs it under a tracer before the frame starts. visual.steps(py.captions, py.draw).
  - TideMachine.stackHeap(el, {steps: [{frames: [{name, vars: [{name, text} | {name, to: id}]}], objects: [{id, title, kind: 'atom' | 'seq' | 'map', value, cells: [{label, to | text}]}], say}]}): stack and heap for C, Rust or anything else, step by step.
  - TideMachine.die(el, {cores}) and TideMachine.gpu(el, {sms}): 3D scenes of a CPU die (cores, L1, L2, L3, memory controller, DRAM, a cache miss) and a GPU (SMs, a warp of 32 lanes, divergence, L2, HBM), captioned in steps. TideMachine.scene(el, {parts: [{id, label, note, box: [w, h, d], at: [x, y, z], color: 'c1', info}], lines, steps: [{say, focus: [ids], labels: [ids], show, view: {camera, target}}]}) builds any other 3D scene of boxes with labels, orbit, focus and picking; .ready gives {THREE, scene, render} for custom geometry.
  - Helpers: TideMachine.bin(v, n) hex(v, digits) signed(u, n) unsigned(v, n) bytesOf(v, size, endian) assemble(asm).`

/**
 * What Claude is told about visuals (CLAUDE_TUTOR_SYSTEM and CLAUDE_LESSON_SYSTEM only: Gemma
 * keeps to the fixed simulations and mermaid).
 */
export const VISUAL_GUIDE = `- Pictures lead. When an idea has a physical, spatial, memory or process picture (how hardware works, numbers as bits, data structures, an algorithm running, Python's memory, ML mechanics, a maths object, money moving between accounts), open that step of the lesson with a visual, before or beside your words, without being asked: at least one in every such step. Keep plain text for ideas with no picture (a definition, a date, a judgement). One visual per message, then one sentence on what to look at or try.
- For a standard idea, a \`\`\`draw block: \`concept: <the idea in a few words>\` and, on the next line, \`show: <what it must make visible, with the numbers you are using>\`. Tide shows its own checked visual for that concept when it has one, else one kept from an earlier lesson, else its visual model writes one once and keeps it. Tide's own: ${kitVisualIds()}.
- For this exact example, its numbers or the learner's code, write a custom visual in a fenced block whose language is visual. Tide runs it inside the lesson, in a sandboxed frame. Prefer a fixed simulation when one fits, and mermaid for a static structure.
  Format: an HTML fragment (no <html> or <head> needed): an optional <title>, inline <style>, SVG or a <canvas>, and inline <script>. It must be self-contained: the frame has no network at all, so no CDN libraries, fetch, fonts, images or links (only data: URLs you make yourself), no localStorage, no alert, no iframes. Under about 150 lines drawn by hand; built on the kits, up to about 300.
  Tide's host API, the global visual:
  - visual.steps(captions, draw, ms?): Tide shows Back, Play, Step and Reset with the caption for the step; draw(i) paints step i (from 0). Compute every state up front so any step can be drawn from i alone.
  - visual.report(text, data?): tell the tutor what the learner just did and what it shows now, with the numbers (on each change they make, not each frame).
  - visual.select(label, data?): the learner clicked or pressed Enter on a part; Tide offers "Ask about this" for it.
  - visual.onReset(fn), visual.reducedMotion, visual.theme.
  Maths helpers are already loaded in the frame as TideMath (served by Tide, no network): TideMath.parse(expr, ['x']) is Tide's safe expression reader (.f(x)); TideMath.plane(el, {x:[lo,hi], y:[lo,hi]}) is an SVG plane with axes and .fn(f or "x^2"), .point([x,y], {drag:true, onMove}), .segment, .line, .vector, .polygon, .text; TideMath.slider(label, {min,max,step,value,into}, onInput); TideMath.predict(question, onLocked) holds the answer back until they guess; TideMath.goal(text) returns met(true) to call when they reach it; TideMath.katex(el, tex) and TideMath.three() (three.js with THREE.OrbitControls) load on first use and return promises; TideMath.fmt(v, digits). No other libraries.
  ${KIT_GUIDE}
  Colours only from Tide's CSS variables, so every theme works: --bg --surface --ink --ink-soft --muted --line --line-strong --accent --accent-soft --pos --neg --good --bad --warn and --c1 to --c6 for series; fonts --font and --mono. Body text and SVG text already follow the theme. One accent for what matters now, neutrals for the rest.
  Make it legible and minimal: label parts directly, text at 12px or more, nothing decorative; leave room so no two labels overlap at any step (Tide draws every step before showing it and sends back overlaps). Animate only to show a change (a short transition, never a loop for its own sake). Keyboard accessible: real <button> and <input> elements with labels; a clickable SVG part gets tabindex="0", role="button", an aria-label and Enter. Give an SVG a viewBox and the same width (width="640" for viewBox="0 0 640 …"), so its text stays the size you wrote and it only shrinks on a narrow screen; at most about 420px tall. Every number is computed in the script, never typed in by hand.
  When Tide says what the learner did in a visual, answer about exactly that state, then often ask them to predict the next step as an <ask>; they check it by pressing Step.
  Examples:
\`\`\`draw
concept: two's complement
show: -5 in 8 bits: invert 5 and add one
\`\`\`
\`\`\`visual
${EXAMPLE_KIT}
\`\`\`
\`\`\`visual
${EXAMPLE_TRACE}
\`\`\`
\`\`\`visual
${EXAMPLE_STEPS}
\`\`\``

/** Said with Show me or Draw it when Claude teaches: a custom visual is one of its choices */
export const SHOW_ME_VISUAL_NOTE = `(Tide: you can also answer this with a custom \`\`\`visual explainer, as your instructions describe: choose it when the idea is a process or has moving parts, a step-by-step visual with captions usually beats a static table or diagram for that. Exact numbers, computed in the script.)`

/** The repair call's instructions */
export const VISUAL_REPAIR_SYSTEM = `You fix interactive visuals that a tutor wrote for Tide, a study app. A visual is an HTML fragment (SVG or canvas, inline style and script) that runs in a sandboxed frame with no network: no external scripts, fonts, images, fetch, storage, iframes or alert. Tide's host API is the global visual: visual.steps(captions, draw, ms?), visual.report(text, data?), visual.select(label, data?), visual.predict(question, value), visual.goal(text, met), visual.onReset(fn), visual.theme. Colours come from CSS variables (--bg --ink --muted --line --accent --accent-soft --pos --neg --good --bad --warn --c1 to --c6).
Reply with the corrected visual only, as one fenced block whose language is visual. Keep what it teaches and how it looks; fix the errors reported and anything else that would break it. TideMath (Tide's maths helpers: parse, plane, slider, predict, goal, katex, three, fmt) and TideMachine (Tide's computing kit: bits, circuit, circuits, truthTable, memory, cpu, python, stackHeap, die, gpu, scene, three, bin, hex) are available in the frame; any other library is not: rewrite that part with them or plain JavaScript and SVG. A <script type="text/x-python"> is traced by Tide before the frame starts (TideMachine.python replays it): keep it.`

export const repairPrompt = (code: string, errors: string[]) => `This visual failed when Tide ran it.\n\nErrors:\n${errors.map((e) => `- ${e}`).join('\n')}\n\nThe visual:\n\`\`\`visual\n${code.slice(0, MAX_SCENE)}\n\`\`\``

/** When the repair fails too: something Tide can always draw */
export const VISUAL_FALLBACK_SYSTEM = `A custom interactive visual could not be shown in a lesson. Give the learner the same idea in a form Tide always draws: a mermaid diagram (flowchart, sequenceDiagram or stateDiagram-v2, under about 12 nodes, each node an id with its label in quotes) in a fenced block whose language is mermaid, or a Markdown table tracing the steps with the exact numbers. Reply with that block and one line saying what to look at, nothing else.`

export const fallbackPrompt = (code: string, title: string) => `The visual${title ? ` "${title}"` : ''} that failed:\n\`\`\`visual\n${code.slice(0, 12_000)}\n\`\`\``

/** The visual block in a reply, without the fence; null when there is none */
export function extractVisual(reply: string): string | null {
  const m = /```(?:visual|html-visual|tide-visual)[^\n]*\n([\s\S]*?)\n```/i.exec(reply)
  return m ? m[1].trim() : null
}

/** A lesson's kept visuals: each by the key of the source it was written as */
export interface VisualRecord {
  status: 'ok' | 'fallback' | 'failed'
  /** The working version, when it had to be repaired */
  code?: string
  /** What is shown instead (Markdown with a mermaid block or a table), when it couldn't be repaired */
  fallback?: string
  errors?: string[]
  at: number
}

/** Keeps a record worth keeping: bounded sizes, known statuses */
export function cleanRecord(r: unknown): VisualRecord | null {
  if (!r || typeof r !== 'object') return null
  const o = r as Record<string, unknown>
  if (o.status !== 'ok' && o.status !== 'fallback' && o.status !== 'failed') return null
  return {
    status: o.status,
    ...(typeof o.code === 'string' && o.code.length <= MAX_VISUAL ? { code: o.code } : {}),
    ...(typeof o.fallback === 'string' && o.fallback.length <= 20_000 ? { fallback: o.fallback } : {}),
    ...(Array.isArray(o.errors) ? { errors: o.errors.filter((e): e is string => typeof e === 'string').slice(0, 6).map((e) => e.slice(0, 400)) } : {}),
    at: typeof o.at === 'number' ? o.at : Date.now()
  }
}
