/*
 * TideMachine: the computing kit inside a visual's sandboxed frame (served by Tide at
 * /lib/tide-machine.js, never from the network, loaded in every frame like TideMath), so a lesson
 * on how computers work shows the real thing in a few lines:
 *   TideMachine.bits(el, {n, value, signed})      a register of switches and bulbs, place values, binary/hex/decimal
 *   TideMachine.circuit(el, spec | TideMachine.circuits.halfAdder())   gates and wires that light as signals settle
 *   TideMachine.truthTable(el, circuit)           its truth table, the current row marked
 *   TideMachine.memory(el, {size, cols})          addressed bytes: writeInt (endianness), mark, pointer arrows
 *   TideMachine.cpu(el, {asm})                    a tiny CPU stepping fetch, decode, execute
 *   TideMachine.stackHeap(el, {steps})            frames, heap blocks and pointer arrows, step by step
 *   TideMachine.python(el, {trace})               names, objects and references from a real Python trace
 *   TideMachine.die(el) / TideMachine.gpu(el)     3D: a CPU die with cores and caches, a GPU's SMs and warps
 *   TideMachine.scene(el, opts)                   the 3D helper they are built on (three.js, labels, orbit, focus)
 * Stepped parts have .captions and .draw(i), for visual.steps(part.captions, part.draw).
 * Colours are Tide's CSS variables; every control is a real button or a focusable part with Enter;
 * what the learner does is reported to the tutor (visual.report, visual.select).
 * Plain ES2020 so it runs as written in the frame.
 */
(function () {
  'use strict';
  var M = {};
  var NS = 'http://www.w3.org/2000/svg';

  /** An SVG element with attributes (null and undefined skipped) and optional text */
  M.el = function (tag, attrs, text) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  };
  /** An HTML element */
  M.h = function (tag, attrs, text) {
    var e = document.createElement(tag);
    for (var k in attrs) if (attrs[k] != null) { if (k === 'style') e.style.cssText = attrs[k]; else e.setAttribute(k, attrs[k]); }
    if (text != null) e.textContent = text;
    return e;
  };
  M.host = function (into) {
    if (typeof into === 'string') { var found = document.querySelector(into); if (!found) throw new Error('TideMachine: nothing matches ' + into); return found; }
    return into || document.body;
  };
  /** An SVG of a given size in user units, shown at that size (shrinking on a narrow screen) */
  M.svg = function (into, w, h, label) {
    var s = M.el('svg', { viewBox: '0 0 ' + w + ' ' + h, width: w, role: 'img', 'aria-label': label || 'A diagram' });
    s.style.fontFamily = 'var(--font)';
    M.host(into).append(s);
    return s;
  };
  M.resize = function (svg, w, h) { svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h); svg.setAttribute('width', w); };

  /** Makes an SVG part selectable: click or Enter tells Tide (visual.select) and calls back */
  M.pickable = function (g, label, data, then) {
    g.setAttribute('tabindex', '0');
    g.setAttribute('role', 'button');
    g.setAttribute('aria-label', label);
    g.style.cursor = 'pointer';
    var pick = function (e) {
      if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
      if (e.type === 'keydown') e.preventDefault();
      var d = typeof data === 'function' ? data() : data;
      if (window.visual) window.visual.select(typeof label === 'function' ? label() : label, d);
      if (then) then(e);
    };
    g.addEventListener('click', pick);
    g.addEventListener('keydown', pick);
    return g;
  };

  M.report = function (text, data) { if (window.visual) window.visual.report(text, data); };
  M.reduced = function () { return !!(window.visual && window.visual.reducedMotion) || matchMedia('(prefers-reduced-motion: reduce)').matches; };
  M.color = function (name) { return getComputedStyle(document.documentElement).getPropertyValue('--' + name).trim(); };

  // ---- Numbers ----
  var pad = function (s, n, c) { s = String(s); while (s.length < n) s = (c || '0') + s; return s; };
  /** v as n binary digits (two's complement when negative) */
  M.bin = function (v, n) { n = n || 8; var u = ((v % Math.pow(2, n)) + Math.pow(2, n)) % Math.pow(2, n); return pad(u.toString(2), n); };
  /** v as hex digits (two's complement when negative), upper case */
  M.hex = function (v, digits) { digits = digits || 2; var m = Math.pow(16, digits), u = ((v % m) + m) % m; return pad(u.toString(16).toUpperCase(), digits); };
  /** The unsigned n-bit pattern u read as a two's complement number */
  M.signed = function (u, n) { n = n || 8; return u >= Math.pow(2, n - 1) ? u - Math.pow(2, n) : u; };
  /** The n-bit pattern (unsigned) that stores v in two's complement */
  M.unsigned = function (v, n) { n = n || 8; var m = Math.pow(2, n); return ((v % m) + m) % m; };
  /** bits of v, most significant first */
  M.bitsOf = function (v, n) { return M.bin(v, n).split('').map(Number); };
  /** Bytes of an integer: size bytes, little- or big-endian */
  M.bytesOf = function (v, size, endian) {
    size = size || 4;
    var u = M.unsigned(v, size * 8), out = [];
    for (var i = 0; i < size; i++) { out.push(u % 256); u = Math.floor(u / 256); }
    return endian === 'big' ? out.reverse() : out;
  };
  M.pad = pad;
  M.sup = function (n) { var d = '⁰¹²³⁴⁵⁶⁷⁸⁹'; return String(n).split('').map(function (c) { return c === '-' ? '⁻' : d[+c]; }).join(''); };

  // ---- Arrows ----
  /** A marker for arrow heads in this SVG, once per colour */
  M.arrowHead = function (svg, color) {
    var id = 'tm-head-' + String(color).replace(/[^a-z0-9]/gi, '');
    if (!svg.querySelector('#' + id)) {
      var defs = svg.querySelector('defs') || svg.insertBefore(M.el('defs'), svg.firstChild);
      var m = M.el('marker', { id: id, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' });
      m.append(M.el('path', { d: 'M0 1 L9 5 L0 9 Z', fill: color }));
      defs.append(m);
    }
    return 'url(#' + id + ')';
  };
  /** A curved arrow from (x1, y1) to (x2, y2), leaving and arriving horizontally; with a halo so it reads over other lines */
  M.arrow = function (svg, layer, x1, y1, x2, y2, o) {
    o = o || {};
    var c = o.color || 'var(--ink-soft)';
    var dx = Math.max(30, Math.abs(x2 - x1) * 0.45);
    var d = o.d || ('M' + x1 + ' ' + y1 + ' C' + (x1 + dx) + ' ' + y1 + ' ' + (x2 - dx) + ' ' + y2 + ' ' + x2 + ' ' + y2);
    var g = M.el('g', { class: 'tm-arrow' });
    g.append(M.el('path', { d: d, fill: 'none', stroke: 'var(--bg)', 'stroke-width': (o.width || 1.6) + 3, 'stroke-linecap': 'round', opacity: 0.85 }));
    g.append(M.el('path', { d: d, fill: 'none', stroke: c, 'stroke-width': o.width || 1.6, 'marker-end': M.arrowHead(svg, c), 'stroke-dasharray': o.dashed ? '4 3' : null }));
    (layer || svg).append(g);
    return g;
  };

  /** A row of small buttons (real <button>s) under a part */
  M.buttons = function (into, list) {
    var bar = M.h('div', { style: 'display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 0' });
    list.forEach(function (b) {
      var btn = M.h('button', { type: 'button' }, b.label);
      if (b.title) btn.title = b.title;
      btn.addEventListener('click', b.run);
      bar.append(btn);
    });
    M.host(into).append(bar);
    return bar;
  };

  window.__TideMachine = M;
})();
