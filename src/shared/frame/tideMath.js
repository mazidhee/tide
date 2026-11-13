/*
 * TideMath: the maths library inside a visual's sandboxed frame (served by Tide at
 * /lib/tide-math.js, never from the network), so an explorable Claude writes on the fly is built
 * like Tide's own:
 *   TideMath.parse(expr, vars)   Tide's safe expression reader (the same grammar as the plot
 *                                simulation's: nothing is ever run as code)
 *   TideMath.plane(el, opts)     an SVG coordinate plane: axes and ticks, curves, points (draggable),
 *                                segments, vectors, polygons, text; in the theme's colours
 *   TideMath.slider(...)         a labelled range input
 *   TideMath.predict(...)        "predict first": a guess locked in before the answer shows
 *   TideMath.goal(text)          a small target, met or not
 *   TideMath.katex(el, tex)      KaTeX, loaded when first used
 *   TideMath.three()             three.js (with OrbitControls), loaded when first used
 *   TideMath.fmt(v, digits)      a number for display, with a real minus sign
 * Plain ES2020 so it runs as written in the frame.
 */
(function () {
  'use strict';
  var FUNCTIONS = {
    sin: Math.sin, cos: Math.cos, tan: Math.tan, exp: Math.exp, ln: Math.log, log: Math.log10, log10: Math.log10, log2: Math.log2,
    sqrt: Math.sqrt, abs: Math.abs, asin: Math.asin, acos: Math.acos, atan: Math.atan, sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
    floor: Math.floor, ceil: Math.ceil, round: Math.round, sign: Math.sign
  };
  var CONSTANTS = { pi: Math.PI, e: Math.E };
  var SIGNS = { '+': '+', '-': '-', '−': '-', '–': '-', '*': '*', '×': '*', '·': '*', '⋅': '*', '/': '/', '÷': '/', '^': '^', '(': '(', ')': ')' };
  var MAX = 120;

  function tokenise(src) {
    var out = [], i = 0, m;
    var pre = /^\s*(?:y|[A-Za-z]\w*\s*\(\s*[a-z](?:\s*,\s*[a-z])*\s*\))\s*=\s*/.exec(src);
    if (pre) i = pre[0].length;
    while (i < src.length) {
      var c = src[i];
      if (/\s/.test(c)) { i++; continue; }
      var num = /(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y; num.lastIndex = i;
      if ((m = num.exec(src))) { out.push({ k: 'num', v: Number(m[0]), pos: i }); i += m[0].length; continue; }
      var nm = /[A-Za-z_]+/y; nm.lastIndex = i;
      if ((m = nm.exec(src))) {
        var name = m[0].toLowerCase(), end = i + m[0].length;
        var base = name === 'log' ? /^(10|2)\s*\(/.exec(src.slice(end)) : null;
        if (base) { name += base[1]; end += base[1].length; }
        out.push({ k: 'name', name: name, pos: i }); i = end; continue;
      }
      if (c === 'π') out.push({ k: 'name', name: 'pi', pos: i });
      else if (c === '√') out.push({ k: 'name', name: 'sqrt', pos: i });
      else if (c === '²' || c === '³') out.push({ k: 'op', op: '^', pos: i }, { k: 'num', v: c === '²' ? 2 : 3, pos: i });
      else if (c === '*' && src[i + 1] === '*') { out.push({ k: 'op', op: '^', pos: i }); i++; }
      else if (SIGNS[c]) out.push({ k: 'op', op: SIGNS[c], pos: i });
      else throw new Error('Unexpected character ' + c);
      i++;
    }
    out.push({ k: 'end', pos: src.length });
    return out;
  }

  /** Reads an expression in the given variables (default x) into a function of an object of values; never evaluates text as code */
  function parse(src, vars) {
    vars = vars || ['x'];
    try {
      src = String(src);
      if (src.length > MAX) throw new Error('Too long: keep an expression under ' + MAX + ' characters');
      var toks = tokenise(src), at = 0, depth = 0;
      var peek = function () { return toks[at]; };
      var isOp = function (t, op) { return t.k === 'op' && t.op === op; };
      var starts = function (t) { return t.k === 'num' || t.k === 'name' || isOp(t, '('); };
      var deeper = function () { if (++depth > 32) throw new Error('Too deeply nested'); };
      var bracketed = function () { var inner = expr(); if (!isOp(peek(), ')')) throw new Error('Expected a closing bracket'); at++; return inner; };
      var primary = function () {
        var t = peek();
        if (t.k === 'num') { at++; if (peek().k === 'num') throw new Error('Expected an operator between numbers'); var v = t.v; return function () { return v; }; }
        if (isOp(t, '(')) { at++; return bracketed(); }
        if (t.k === 'name') {
          at++;
          var n = t.name;
          if (vars.indexOf(n) >= 0) return function (s) { return s[n]; };
          if (FUNCTIONS[n]) {
            if (!isOp(peek(), '(')) throw new Error('Expected an opening bracket after ' + n);
            at++;
            const a = bracketed(), fn = FUNCTIONS[n];
            return function (s) { return fn(a(s)); };
          }
          if (n in CONSTANTS) { var k = CONSTANTS[n]; return function () { return k; }; }
          // One known letter in front of a variable is a product: 2ax is written ax
          if (n.length === 2 && vars.indexOf(n[1]) >= 0 && (vars.indexOf(n[0]) >= 0 || n[0] in CONSTANTS)) {
            var f0 = n[0], v1 = n[1];
            return function (s) { return (f0 in CONSTANTS ? CONSTANTS[f0] : s[f0]) * s[v1]; };
          }
          throw new Error('Unknown name ' + n);
        }
        throw new Error(t.k === 'end' && at === 0 ? 'The expression is empty' : 'Expected a number, a variable or a bracket');
      };
      var power = function () {
        const b = primary();
        if (!isOp(peek(), '^')) return b;
        at++;
        const e = unary();
        return function (s) { return Math.pow(b(s), e(s)); };
      };
      var unary = function () {
        var t = peek();
        if (isOp(t, '-') || isOp(t, '+')) { deeper(); at++; const a = unary(); depth--; return isOp(t, '-') ? function (s) { return -a(s); } : a; }
        return power();
      };
      var term = function () {
        var left = unary();
        for (;;) {
          var t = peek();
          if (isOp(t, '*') || isOp(t, '/')) {
            at++;
            const l = left, r = unary();
            left = isOp(t, '/') ? function (s) { return l(s) / r(s); } : function (s) { return l(s) * r(s); };
          } else if (starts(t)) { const l2 = left, r2 = power(); left = function (s) { return l2(s) * r2(s); }; }
          else return left;
        }
      };
      var expr = function () {
        deeper();
        var left = term();
        for (;;) {
          var t = peek();
          if (!isOp(t, '+') && !isOp(t, '-')) break;
          at++;
          const l = left, r = term();
          left = isOp(t, '+') ? function (s) { return l(s) + r(s); } : function (s) { return l(s) - r(s); };
        }
        depth--;
        return left;
      };
      var tree = expr();
      if (peek().k !== 'end') throw new Error(isOp(peek(), ')') ? 'Unexpected closing bracket' : 'Unexpected text after the expression');
      return {
        ok: true,
        /** f({x: 1}) or, for one variable, f(1) */
        f: function (s) { if (typeof s === 'number') { var o = {}; o[vars[0]] = s; s = o; } return tree(s || {}); }
      };
    } catch (e) {
      return { ok: false, error: e && e.message || String(e), f: function () { return NaN; } };
    }
  }

  var fmt = function (v, d) {
    if (!isFinite(v)) return isNaN(v) ? '–' : v > 0 ? '∞' : '−∞';
    var t = Math.abs(v) >= 1e5 ? Math.abs(v).toExponential(2) : Math.abs(v).toFixed(d == null ? 3 : d);
    return (v < 0 && Number(t) !== 0 ? '−' : '') + t;
  };

  var NS = 'http://www.w3.org/2000/svg';
  var el = function (tag, attrs, text) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  };
  var nice = function (lo, hi, target) {
    var raw = (hi - lo) / (target || 6), p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p;
    var step = (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p, out = [];
    for (var v = Math.ceil(lo / step) * step; v <= hi + 1e-9 && out.length < 60; v += step) out.push(Math.abs(v) < step / 1e6 ? 0 : Number(v.toPrecision(12)));
    return out;
  };

  /**
   * An SVG coordinate plane. opts: { x: [lo, hi], y: [lo, hi], width (640), height (360), equal }.
   * Returns the plane: X(x), Y(y) to pixels, and fn, point, segment, line, vector, polygon, text,
   * clear() (keeps the axes). Colours default to the theme: ink for data, the accent for what moves.
   */
  function plane(host, opts) {
    opts = opts || {};
    var W = opts.width || 640, H = opts.height || 360, pad = 28;
    var xr = opts.x || [-5, 5], yr = opts.y || [-5, 5];
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, role: 'img', 'aria-label': opts.label || 'A graph' });
    var axes = el('g'), layer = el('g');
    svg.append(axes, layer);
    (typeof host === 'string' ? document.querySelector(host) : host || document.body).append(svg);
    var X = function (x) { return pad + ((x - xr[0]) / (xr[1] - xr[0])) * (W - 2 * pad); };
    var Y = function (y) { return H - pad - ((y - yr[0]) / (yr[1] - yr[0])) * (H - 2 * pad); };
    var fromPx = function (px, py) { return [xr[0] + ((px - pad) / (W - 2 * pad)) * (xr[1] - xr[0]), yr[0] + ((H - pad - py) / (H - 2 * pad)) * (yr[1] - yr[0])]; };
    var drawAxes = function () {
      axes.replaceChildren();
      nice(xr[0], xr[1], 8).forEach(function (v) {
        axes.append(el('line', { x1: X(v), x2: X(v), y1: pad, y2: H - pad, stroke: 'var(--line)' }));
        if (v !== 0) axes.append(el('text', { x: X(v), y: Math.min(H - pad + 14, Math.max(pad + 12, Y(0) + 14)), 'text-anchor': 'middle', 'font-size': 11, fill: 'var(--muted)' }, fmt(v, Math.abs(v) < 1 ? 2 : 0).replace(/\.?0+$/, '') || '0'));
      });
      nice(yr[0], yr[1], 6).forEach(function (v) {
        axes.append(el('line', { y1: Y(v), y2: Y(v), x1: pad, x2: W - pad, stroke: 'var(--line)' }));
        if (v !== 0) axes.append(el('text', { y: Y(v) + 4, x: Math.min(W - pad - 4, Math.max(pad + 4, X(0) - 6)), 'text-anchor': 'end', 'font-size': 11, fill: 'var(--muted)' }, fmt(v, Math.abs(v) < 1 ? 2 : 0).replace(/\.?0+$/, '') || '0'));
      });
      if (yr[0] <= 0 && yr[1] >= 0) axes.append(el('line', { x1: pad, x2: W - pad, y1: Y(0), y2: Y(0), stroke: 'var(--ink-soft)', 'stroke-width': 1.2 }));
      if (xr[0] <= 0 && xr[1] >= 0) axes.append(el('line', { y1: pad, y2: H - pad, x1: X(0), x2: X(0), stroke: 'var(--ink-soft)', 'stroke-width': 1.2 }));
    };
    drawAxes();
    var api = {
      svg: svg, X: X, Y: Y, fromPx: fromPx,
      setView: function (x, y) { xr = x || xr; yr = y || yr; drawAxes(); },
      clear: function () { layer.replaceChildren(); },
      /** A curve y = f(x): f a function or an expression string */
      fn: function (f, o) {
        o = o || {};
        if (typeof f === 'string') f = parse(f).f;
        var d = '', pen = false, n = o.samples || 400;
        for (var i = 0; i <= n; i++) {
          var x = xr[0] + ((xr[1] - xr[0]) * i) / n, y = f(x);
          if (!isFinite(y) || y < yr[0] - (yr[1] - yr[0]) * 4 || y > yr[1] + (yr[1] - yr[0]) * 4) { pen = false; continue; }
          d += (pen ? 'L' : 'M') + X(x).toFixed(2) + ' ' + Y(y).toFixed(2); pen = true;
        }
        var p = el('path', { d: d, fill: 'none', stroke: o.color || 'var(--ink)', 'stroke-width': o.width || 2, 'stroke-dasharray': o.dashed ? '5 4' : null });
        layer.append(p);
        return p;
      },
      segment: function (a, b, o) { o = o || {}; var l = el('line', { x1: X(a[0]), y1: Y(a[1]), x2: X(b[0]), y2: Y(b[1]), stroke: o.color || 'var(--accent)', 'stroke-width': o.width || 2, 'stroke-dasharray': o.dashed ? '5 4' : null }); layer.append(l); return l; },
      /** The whole line through a and b */
      line: function (a, b, o) {
        var dx = b[0] - a[0], dy = b[1] - a[1], far = 1e3 * Math.max(xr[1] - xr[0], yr[1] - yr[0]), len = Math.hypot(dx, dy) || 1;
        return api.segment([a[0] - (dx / len) * far, a[1] - (dy / len) * far], [a[0] + (dx / len) * far, a[1] + (dy / len) * far], o);
      },
      vector: function (from, to, o) {
        o = o || {};
        var c = o.color || 'var(--accent)', ang = Math.atan2(Y(to[1]) - Y(from[1]), X(to[0]) - X(from[0])), hx = X(to[0]), hy = Y(to[1]);
        var g = el('g');
        g.append(el('line', { x1: X(from[0]), y1: Y(from[1]), x2: hx, y2: hy, stroke: c, 'stroke-width': o.width || 2.5 }));
        g.append(el('path', { d: 'M' + hx + ' ' + hy + 'L' + (hx - 10 * Math.cos(ang - 0.4)) + ' ' + (hy - 10 * Math.sin(ang - 0.4)) + 'L' + (hx - 10 * Math.cos(ang + 0.4)) + ' ' + (hy - 10 * Math.sin(ang + 0.4)) + 'Z', fill: c }));
        if (o.label) g.append(el('text', { x: hx + 6, y: hy - 6, fill: c, 'font-size': 13 }, o.label));
        layer.append(g);
        return g;
      },
      polygon: function (pts, o) { o = o || {}; var p = el('polygon', { points: pts.map(function (q) { return X(q[0]) + ',' + Y(q[1]); }).join(' '), fill: o.fill || 'var(--accent-soft)', stroke: o.color || 'none', 'stroke-width': o.width || 1 }); layer.append(p); return p; },
      text: function (at, s, o) { o = o || {}; var t = el('text', { x: X(at[0]) + (o.dx || 6), y: Y(at[1]) + (o.dy || -6), fill: o.color || 'var(--ink)', 'font-size': o.size || 13, 'text-anchor': o.anchor || 'start' }, s); layer.append(t); return t; },
      /** A point; with o.drag, the learner drags it: o.onMove([x, y]) (o.constrain maps a position to an allowed one) */
      point: function (at, o) {
        o = o || {};
        var c = el('circle', { cx: X(at[0]), cy: Y(at[1]), r: o.drag ? 7 : 4.5, fill: o.color || (o.drag ? 'var(--accent)' : 'var(--ink)'), stroke: o.drag ? 'var(--bg)' : null, 'stroke-width': o.drag ? 2 : null });
        if (o.label) c.setAttribute('aria-label', o.label);
        layer.append(c);
        if (o.drag) {
          c.style.cursor = 'grab'; c.setAttribute('tabindex', '0'); c.setAttribute('role', 'slider');
          var move = function (p) { if (o.constrain) p = o.constrain(p); c.setAttribute('cx', X(p[0])); c.setAttribute('cy', Y(p[1])); at = p; if (o.onMove) o.onMove(p); };
          var toPlane = function (e) { var r = svg.getBoundingClientRect(), k = W / r.width; return fromPx((e.clientX - r.left) * k, (e.clientY - r.top) * k); };
          c.addEventListener('pointerdown', function (e) { c.setPointerCapture(e.pointerId); c.style.cursor = 'grabbing'; });
          c.addEventListener('pointermove', function (e) { if (c.hasPointerCapture(e.pointerId)) move(toPlane(e)); });
          c.addEventListener('pointerup', function (e) { c.releasePointerCapture(e.pointerId); c.style.cursor = 'grab'; if (o.onDrop) o.onDrop(at); });
          c.addEventListener('keydown', function (e) {
            var s = (o.step || (xr[1] - xr[0]) / 100), d = { ArrowLeft: [-s, 0], ArrowRight: [s, 0], ArrowUp: [0, s], ArrowDown: [0, -s] }[e.key];
            if (d) { e.preventDefault(); move([at[0] + d[0], at[1] + d[1]]); if (o.onDrop) o.onDrop(at); }
          });
        }
        return c;
      }
    };
    return api;
  }

  /** A labelled slider; onInput(value) on every move */
  function slider(label, o, onInput) {
    var wrap = document.createElement('label');
    wrap.style.cssText = 'display:inline-flex;align-items:center;gap:8px;margin:4px 12px 4px 0';
    var input = document.createElement('input');
    input.type = 'range'; input.min = o.min; input.max = o.max; input.step = o.step || (o.max - o.min) / 100; input.value = o.value != null ? o.value : o.min;
    var out = document.createElement('output');
    out.className = 'mono';
    var show = function () { out.textContent = o.format ? o.format(+input.value) : fmt(+input.value, o.digits == null ? 2 : o.digits); };
    input.addEventListener('input', function () { show(); if (onInput) onInput(+input.value); });
    show();
    wrap.append(label + ' ', input, out);
    (o.into || document.body).append(wrap);
    return { el: wrap, input: input, get value() { return +input.value; }, set: function (v) { input.value = v; show(); } };
  }

  /** "Predict first": a question and a box; the answer stays hidden until onLocked(value) runs. Tide hears the guess. */
  function predict(question, onLocked, into) {
    var box = document.createElement('div');
    box.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:0 0 10px;padding:8px 10px;border-radius:8px;background:var(--accent-soft)';
    var q = document.createElement('span');
    q.textContent = question;
    var input = document.createElement('input');
    input.type = 'text'; input.setAttribute('aria-label', 'Your prediction'); input.placeholder = 'Your guess';
    input.style.cssText = 'width:110px;height:28px;padding:0 8px;border:0;border-radius:6px;background:var(--bg);box-shadow:inset 0 0 0 1px var(--line-strong)';
    var lock = document.createElement('button');
    lock.textContent = 'Lock in';
    var done = function () {
      var v = input.value.trim();
      if (!v) return input.focus();
      box.replaceChildren(document.createTextNode(question + ' You said ' + v + '. Now compare.'));
      if (window.visual && window.visual.predict) window.visual.predict(question, v);
      if (onLocked) onLocked(v);
    };
    lock.addEventListener('click', done);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); done(); } });
    box.append(q, input, lock);
    var host = into || document.body;
    host.insertBefore(box, host.firstChild);
    return box;
  }

  /** A small target; call the returned function with true when it is met. Tide shows it and tells the tutor. */
  function goal(text) {
    var met = false;
    if (window.visual && window.visual.goal) window.visual.goal(text, false);
    return function (now) { if (now && !met) { met = true; if (window.visual && window.visual.goal) window.visual.goal(text, true); } return met; };
  }

  var loading = {};
  var load = function (src, ready) {
    if (!loading[src]) loading[src] = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = function () { resolve(ready()); };
      s.onerror = function () { reject(new Error('Tide could not load ' + src)); };
      document.head.appendChild(s);
    });
    return loading[src];
  };
  /** KaTeX into an element (loaded the first time) */
  function katex(target, tex, display) {
    return load('/lib/katex.js', function () { return window.katex; }).then(function (k) {
      k.render(String(tex), target, { displayMode: !!display, throwOnError: false });
      return target;
    });
  }
  /** three.js with OrbitControls as THREE.OrbitControls (loaded the first time) */
  function three() { return load('/lib/three.js', function () { return window.THREE; }); }

  Object.defineProperty(window, 'TideMath', { value: Object.freeze({ parse: parse, plane: plane, slider: slider, predict: predict, goal: goal, katex: katex, three: three, fmt: fmt, nice: nice }), writable: false, configurable: false });
})();
