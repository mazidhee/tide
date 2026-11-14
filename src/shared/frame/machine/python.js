/* TideMachine.stackHeap and TideMachine.python: frames, names, objects and the arrows between them */
(function (M) {
  'use strict';
  var el = M.el;

  /**
   * Draws one state into an SVG group: frames on the left, containers in the middle, atoms on the
   * right, arrows from names and slots to what they point at. state:
   *   frames:  [{ name, vars: [{ name, text } | { name, to: objectId }], active }]
   *   objects: [{ id, title, sub, kind: 'atom' | 'seq' | 'map', value, lines: [], cells: [{ label, text } | { label, to }], hot }]
   *   hotVars: ['frameIndex:name']
   * Returns the height used.
   */
  function diagram(svg, layer, state, o) {
    o = o || {};
    var W = o.width || 680, top = o.top || 0;
    var fx = 0, fw = 196, cx = 236, cw = 236, ax = 506, aw = W - 506 - 2;
    var rowH = 26, objs = {}, at = {}, arrows = [];
    (state.objects || []).forEach(function (ob) { objs[ob.id] = ob; });
    var isAtom = function (ob) { return ob.kind === 'atom'; };
    layer.append(el('text', { x: fx, y: top + 12, 'font-size': 11, 'font-weight': 600, fill: 'var(--muted)' }, o.framesTitle || 'Frames'));
    layer.append(el('text', { x: cx, y: top + 12, 'font-size': 11, 'font-weight': 600, fill: 'var(--muted)' }, o.objectsTitle || 'Objects'));
    // Frames
    var y = top + 22;
    var wants = [];
    (state.frames || []).forEach(function (f, fi) {
      var h = 28 + Math.max(1, f.vars.length) * rowH + 6;
      var g = el('g');
      g.append(el('rect', { x: fx, y: y, width: fw, height: h, rx: 8, fill: f.active ? 'var(--bg)' : 'var(--surface)', stroke: f.active ? 'var(--accent)' : 'var(--line-strong)', 'stroke-width': f.active ? 1.8 : 1 }));
      g.append(el('text', { x: fx + 10, y: y + 18, 'font-size': 12, 'font-weight': 600, fill: f.active ? 'var(--accent)' : 'var(--ink-soft)' }, f.name));
      if (!f.vars.length) g.append(el('text', { x: fx + 10, y: y + 28 + 17, 'font-size': 12, fill: 'var(--muted)' }, 'no names yet'));
      f.vars.forEach(function (v, k) {
        var ry = y + 28 + k * rowH, hot = (state.hotVars || []).indexOf(fi + ':' + v.name) >= 0;
        var vg = el('g');
        if (hot) vg.append(el('rect', { x: fx + 4, y: ry, width: fw - 8, height: rowH - 2, rx: 5, fill: 'var(--accent-soft)' }));
        vg.append(el('text', { x: fx + 12, y: ry + 17, 'font-size': 13, 'font-family': 'var(--mono)', fill: 'var(--ink)' }, v.name));
        vg.append(el('rect', { x: fx + fw - 64, y: ry + 3, width: 54, height: rowH - 8, rx: 4, fill: 'var(--bg)', stroke: 'var(--line-strong)' }));
        if (v.to) {
          vg.append(el('circle', { cx: fx + fw - 37, cy: ry + rowH / 2 - 1, r: 3.5, fill: hot ? 'var(--accent)' : 'var(--ink-soft)' }));
          wants.push({ from: [fx + fw - 37, ry + rowH / 2 - 1], to: v.to, hot: hot, y: ry });
        } else vg.append(el('text', { x: fx + fw - 37, y: ry + 17, 'text-anchor': 'middle', 'font-size': 12, 'font-family': 'var(--mono)' }, v.text));
        M.pickable(vg, 'the name ' + v.name + ' in ' + f.name, function () { var ob = v.to && objs[v.to]; return ob ? { name: v.name, type: ob.title, value: ob.value || '', id: ob.id } : { name: v.name, value: v.text }; });
        g.append(vg);
      });
      layer.append(g);
      y += h + 10;
    });
    var bottom = y;
    // Objects in the order they are first pointed at
    var order = [], seen = {};
    var visit = function (id) {
      if (!id || seen[id] || !objs[id]) return;
      seen[id] = 1;
      order.push(id);
      (objs[id].cells || []).forEach(function (c) { visit(c.to); });
    };
    wants.forEach(function (w) { visit(w.to); });
    (state.objects || []).forEach(function (ob) { visit(ob.id); });
    var cy = top + 22, ay = top + 22;
    var place = function (id, wantY) {
      var ob = objs[id];
      var atom = isAtom(ob);
      var w = atom ? aw : cw, x = atom ? ax : cx;
      var lines = ob.lines || [];
      var slots = ob.kind === 'seq' ? (ob.cells || []).length : 0;
      var perRow = Math.max(1, Math.floor((w - 16) / 38));
      var h = atom ? 44 + lines.length * 15 : ob.kind === 'seq' ? 30 + Math.max(1, Math.ceil(slots / perRow)) * 44 + lines.length * 15 : 30 + Math.max(1, (ob.cells || []).length) * rowH + 4 + lines.length * 15;
      var yy = Math.max(atom ? ay : cy, wantY == null ? 0 : wantY - 10);
      if (atom) ay = yy + h + 10; else cy = yy + h + 10;
      at[id] = { x: x, y: yy, w: w, h: h, perRow: perRow };
      return at[id];
    };
    var firstY = {};
    wants.forEach(function (w) { if (firstY[w.to] == null) firstY[w.to] = w.y; });
    order.forEach(function (id) {
      var ob = objs[id];
      var p = place(id, firstY[id]);
      var g = el('g');
      g.append(el('rect', { x: p.x, y: p.y, width: p.w, height: p.h, rx: 8, fill: 'var(--bg)', stroke: ob.hot ? 'var(--accent)' : 'var(--line-strong)', 'stroke-width': ob.hot ? 2 : 1.1 }));
      g.append(el('text', { x: p.x + 10, y: p.y + 17, 'font-size': 12, 'font-weight': 600, fill: ob.hot ? 'var(--accent)' : 'var(--ink-soft)' }, ob.title));
      if (ob.sub) g.append(el('text', { x: p.x + p.w - 8, y: p.y + 17, 'text-anchor': 'end', 'font-size': 11, 'font-family': 'var(--mono)', fill: 'var(--muted)' }, ob.sub));
      var ly = p.y + 30;
      if (ob.kind === 'atom') {
        g.append(el('text', { x: p.x + 10, y: p.y + 36, 'font-size': 14, 'font-family': 'var(--mono)', 'font-weight': 600, fill: 'var(--ink)' }, ob.value));
        ly = p.y + 44;
      } else if (ob.kind === 'seq') {
        (ob.cells || []).forEach(function (c, k) {
          var sx = p.x + 10 + (k % p.perRow) * 38, sy = p.y + 30 + Math.floor(k / p.perRow) * 44;
          g.append(el('text', { x: sx + 17, y: sy + 9, 'text-anchor': 'middle', 'font-size': 10, fill: 'var(--muted)' }, c.label != null ? c.label : String(k)));
          g.append(el('rect', { x: sx, y: sy + 13, width: 34, height: 24, rx: 4, fill: c.empty ? 'var(--surface)' : 'var(--bg)', stroke: c.hot ? 'var(--accent)' : 'var(--line-strong)', 'stroke-dasharray': c.empty ? '3 3' : null }));
          if (c.to) { g.append(el('circle', { cx: sx + 17, cy: sy + 25, r: 3.5, fill: c.hot ? 'var(--accent)' : 'var(--ink-soft)' })); arrows.push({ from: [sx + 17, sy + 25], to: c.to, hot: c.hot, slot: true }); }
          else if (c.text != null) g.append(el('text', { x: sx + 17, y: sy + 30, 'text-anchor': 'middle', 'font-size': 12, 'font-family': 'var(--mono)' }, c.text));
        });
        ly = p.y + 30 + Math.max(1, Math.ceil((ob.cells || []).length / p.perRow)) * 44;
      } else {
        (ob.cells || []).forEach(function (c, k) {
          var ry = p.y + 28 + k * rowH;
          g.append(el('text', { x: p.x + 12, y: ry + 17, 'font-size': 12, 'font-family': 'var(--mono)', fill: c.empty ? 'var(--muted)' : ob.index ? 'var(--muted)' : 'var(--ink)' }, ob.index ? '[' + c.label + ']' : c.label));
          g.append(el('rect', { x: p.x + p.w - 64, y: ry + 3, width: 54, height: rowH - 8, rx: 4, fill: c.empty ? 'var(--surface)' : 'var(--bg)', stroke: c.hot ? 'var(--accent)' : 'var(--line-strong)', 'stroke-dasharray': c.empty ? '3 3' : null }));
          if (c.empty) return;
          if (c.to) { g.append(el('circle', { cx: p.x + p.w - 37, cy: ry + rowH / 2 - 1, r: 3.5, fill: c.hot ? 'var(--accent)' : 'var(--ink-soft)' })); arrows.push({ from: [p.x + p.w - 37, ry + rowH / 2 - 1], to: c.to, hot: c.hot }); }
          else g.append(el('text', { x: p.x + p.w - 37, y: ry + 17, 'text-anchor': 'middle', 'font-size': 12, 'font-family': 'var(--mono)' }, c.text));
        });
        ly = p.y + 30 + Math.max(1, (ob.cells || []).length) * rowH;
      }
      (ob.lines || []).forEach(function (line, k) { g.append(el('text', { x: p.x + 10, y: ly + 4 + k * 15, 'font-size': 11, 'font-family': 'var(--mono)', fill: 'var(--muted)' }, line)); });
      M.pickable(g, ob.title + (ob.value ? ' ' + ob.value : '') + ' at ' + ob.id, function () { return Object.assign({ type: ob.title, id: ob.id }, ob.value ? { value: ob.value } : {}, ob.data || {}); });
      layer.append(g);
    });
    // Arrows last, so they read over the boxes
    var arrowLayer = el('g');
    wants.concat(arrows).forEach(function (a) {
      var t = at[a.to];
      if (!t) return;
      var x2 = t.x - 1, y2 = t.y + 16, x1 = a.from[0], y1 = a.from[1];
      var c = a.hot ? 'var(--accent)' : 'var(--ink-soft)';
      if (a.slot) {
        var d = 'M' + x1 + ' ' + y1 + ' C' + x1 + ' ' + (y1 + 46) + ' ' + (x2 - 50) + ' ' + y2 + ' ' + x2 + ' ' + y2;
        M.arrow(svg, arrowLayer, 0, 0, 0, 0, { d: d, color: c, width: a.hot ? 2 : 1.4 });
      } else if (x2 < x1) {
        // Back to the left (an object pointing at one in an earlier column): around the right
        var d2 = 'M' + x1 + ' ' + y1 + ' C' + (x1 + 40) + ' ' + y1 + ' ' + (x2 + t.w + 40) + ' ' + y2 + ' ' + (x2 + t.w + 1) + ' ' + y2;
        M.arrow(svg, arrowLayer, 0, 0, 0, 0, { d: d2, color: c, width: a.hot ? 2 : 1.4 });
      } else M.arrow(svg, arrowLayer, x1, y1, x2, y2, { color: c, width: a.hot ? 2 : 1.4 });
    });
    layer.append(arrowLayer);
    return Math.max(bottom, cy, ay) - top;
  }
  M.diagram = diagram;

  /**
   * Stack and heap, step by step, from states you give. opts.steps: [{ frames, objects, say }]
   * (shapes as in the diagram above: a variable holds text or points at an object with to). Returns
   * { el, captions, draw(i) }.
   */
  M.stackHeap = function (into, opts) {
    opts = opts || {};
    var steps = opts.steps || [];
    var W = opts.width || 680;
    var svg = M.svg(into, W, 200, opts.label || 'The stack and the heap');
    var draw = function (i) {
      var st = steps[Math.max(0, Math.min(steps.length - 1, i))] || { frames: [], objects: [] };
      svg.replaceChildren();
      var layer = el('g');
      svg.append(layer);
      var h = diagram(svg, layer, st, { width: W, framesTitle: opts.framesTitle || 'Stack (frames)', objectsTitle: opts.objectsTitle || 'Heap' });
      M.resize(svg, W, h + 12);
      return st.say;
    };
    draw(0);
    return { el: svg, captions: steps.map(function (s) { return s.say || ''; }), draw: draw };
  };

  // ---------- Python, from a real trace ----------

  var ATOMS = ['int', 'float', 'str', 'bool', 'NoneType', 'complex', 'bytes', 'function', 'class'];
  var short = function (id) { return '…' + id.slice(-4); };

  /**
   * opts: trace (window.TIDE_TRACE when not given: Tide traces a <script type="text/x-python">
   * in the visual), digits (show an int's CPython digits and size), sizes (show sys.getsizeof),
   * label. Returns { el, captions, draw(i), trace } for visual.steps(py.captions, py.draw).
   */
  M.python = function (into, opts) {
    opts = opts || {};
    var trace = opts.trace || window.TIDE_TRACE;
    var host = M.host(into);
    if (!trace || !trace.steps || !trace.steps.length) {
      var msg = M.h('p', { style: 'color:var(--muted);margin:4px 0' }, window.TIDE_TRACE_ERROR ? 'Tide could not trace this code: ' + window.TIDE_TRACE_ERROR : 'No trace to show: put the Python in a <script type="text/x-python"> and Tide traces it.');
      host.append(msg);
      return { el: msg, captions: ['No trace'], draw: function () {} };
    }
    var W = opts.width || 680;
    var code = trace.code.split('\n');
    var steps = trace.steps, objects = trace.objects;
    var heapOf = function (st) { var m = {}; st.heap.forEach(function (k) { var ob = objects[k]; m[ob.id] = ob; }); return m; };
    var reprOf = function (heap, id, depth) {
      var ob = heap[id];
      if (!ob) return '…';
      if (ob.v != null) return ob.t === 'function' ? 'function ' + ob.v : ob.v;
      if (depth > 2) return '[…]';
      if (ob.items) {
        var parts = ob.items.map(function (x) { return Array.isArray(x) ? reprOf(heap, x[0], depth + 1) + ': ' + reprOf(heap, x[1], depth + 1) : reprOf(heap, x, depth + 1); });
        if (ob.more) parts.push('…');
        var br = ob.t === 'list' ? '[]' : ob.t === 'tuple' ? '()' : '{}';
        return br[0] + parts.join(', ') + (ob.t === 'tuple' && parts.length === 1 ? ',' : '') + br[1];
      }
      if (ob.attrs) return ob.t + '(' + ob.attrs.map(function (a) { return a[0] + '=' + reprOf(heap, a[1], depth + 1); }).join(', ') + ')';
      return ob.t;
    };
    var refsIn = function (st, heap) {
      var n = {};
      var add = function (id) { n[id] = (n[id] || 0) + 1; };
      st.frames.forEach(function (f) { f.names.forEach(function (nm) { add(nm[1]); }); });
      if (st.ret && st.frames.length > 1) add(st.ret);
      Object.keys(heap).forEach(function (id) {
        var ob = heap[id];
        (ob.items || []).forEach(function (x) { if (Array.isArray(x)) { add(x[0]); add(x[1]); } else add(x); });
        (ob.attrs || []).forEach(function (a) { add(a[1]); });
      });
      return n;
    };
    var smallInt = function (ob) { return ob.t === 'int' && /^-?\d+$/.test(ob.v || '') && +ob.v >= -5 && +ob.v <= 256; };

    // Captions, from what changed between steps
    var captions = steps.map(function (st, i) {
      var line = (code[st.line - 1] || '').trim();
      var next = st.event === 'line' ? 'Next: line ' + st.line + ', ' + line : '';
      if (i === 0) return 'Nothing has run yet. ' + next;
      var pv = steps[i - 1], heap = heapOf(st), pheap = heapOf(pv), said = [];
      var desc = function (id, h) { var ob = (h || heap)[id]; return ob ? (ATOMS.indexOf(ob.t) >= 0 && ob.t !== 'function' ? ob.t + ' ' + reprOf(h || heap, id, 0) : 'the ' + ob.t + ' ' + reprOf(h || heap, id, 0)) : 'an object'; };
      if (st.frames.length > pv.frames.length) {
        var f = st.frames[st.frames.length - 1];
        said.push(f.name + '(' + f.names.map(function (nm) { return nm[0] + '=' + reprOf(heap, nm[1], 1); }).join(', ') + ') is called: a new frame on top, with its own names');
      } else if (st.frames.length < pv.frames.length) {
        var gone = pv.frames[pv.frames.length - 1];
        said.push(gone.name + '’s frame is gone; back in ' + st.frames[st.frames.length - 1].name + (pv.ret ? ' with the result ' + reprOf(pheap, pv.ret, 1) : ''));
      }
      var depth = Math.min(st.frames.length, pv.frames.length);
      for (var fi = 0; fi < depth; fi++) {
        var before = {}; pv.frames[fi].names.forEach(function (nm) { before[nm[0]] = nm[1]; });
        st.frames[fi].names.forEach(function (nm) {
          if (before[nm[0]] === nm[1]) return;
          var others = [];
          st.frames[fi].names.forEach(function (o) { if (o[0] !== nm[0] && o[1] === nm[1]) others.push(o[0]); });
          said.push(nm[0] + ' now names ' + desc(nm[1]) + (others.length ? ', the same object as ' + others.join(' and ') + ': no copy was made' : ''));
        });
      }
      Object.keys(heap).forEach(function (id) {
        var a = heap[id], b = pheap[id];
        if (!b || a === b || a.v != null) return;
        if (JSON.stringify(a.items || a.attrs) === JSON.stringify(b.items || b.attrs)) return;
        var names = [];
        st.frames.forEach(function (f) { f.names.forEach(function (nm) { if (nm[1] === id) names.push(nm[0]); }); });
        said.push('the ' + a.t + ' at ' + short(id) + ' changed in place, ' + reprOf(pheap, id, 0) + ' → ' + reprOf(heap, id, 0) + (names.length > 1 ? '; ' + names.join(' and ') + ' both see it' : ''));
      });
      if (st.event === 'return' && st.frames.length > 1 && st.ret) said.push(st.frames[st.frames.length - 1].name + ' returns ' + desc(st.ret));
      if (st.out.length > pv.out.length) said.push('it prints ' + JSON.stringify(st.out.slice(pv.out.length).replace(/\n$/, '')));
      if (st.exc) said.push('an exception: ' + st.exc);
      var end = i === steps.length - 1 && st.event === 'return' && st.frames.length === 1;
      var text = said.length ? said.join('; ') + '.' : 'Line ' + pv.line + ' ran.';
      return text + (end ? ' The program has finished.' + (trace.error ? ' It stopped with ' + trace.error + '.' : '') : next ? ' ' + next : '');
    });

    var svg = M.svg(host, W, 300, opts.label || 'Python names and objects, step by step');
    var draw = function (i) {
      i = Math.max(0, Math.min(steps.length - 1, i));
      var st = steps[i], heap = heapOf(st), refs = refsIn(st, heap), pv = steps[Math.max(0, i - 1)], pheap = heapOf(pv);
      svg.replaceChildren();
      // Code, with the line about to run
      var codeW = 400, lh = 19, ch = code.length * lh + 14;
      svg.append(el('rect', { x: 0, y: 0, width: codeW, height: ch, rx: 8, fill: 'var(--surface)' }));
      code.forEach(function (c, k) {
        var y = 7 + k * lh, on = k + 1 === st.line && i < steps.length - 1, ran = k + 1 === pv.line && i > 0;
        if (on) svg.append(el('rect', { x: 2, y: y, width: codeW - 4, height: lh, rx: 4, fill: 'var(--accent-soft)' }));
        if (on) svg.append(el('path', { d: 'M6 ' + (y + 5) + ' l7 4.5 l-7 4.5 z', fill: 'var(--accent)' }));
        else if (ran) svg.append(el('path', { d: 'M6 ' + (y + 5) + ' l7 4.5 l-7 4.5 z', fill: 'none', stroke: 'var(--muted)' }));
        svg.append(el('text', { x: 34, y: y + 14, 'text-anchor': 'end', 'font-size': 11, 'font-family': 'var(--mono)', fill: 'var(--muted)' }, String(k + 1)));
        var t = el('text', { x: 44, y: y + 14, 'font-size': 12.5, 'font-family': 'var(--mono)', fill: on ? 'var(--ink)' : 'var(--ink-soft)' });
        t.textContent = c.replace(/\t/g, '    ');
        t.setAttribute('xml:space', 'preserve');
        t.style.whiteSpace = 'pre';
        svg.append(t);
      });
      // What it printed
      var ox = codeW + 16, ow = W - ox;
      svg.append(el('text', { x: ox, y: 13, 'font-size': 11, 'font-weight': 600, fill: 'var(--muted)' }, 'Printed'));
      svg.append(el('rect', { x: ox, y: 20, width: ow, height: ch - 20, rx: 8, fill: 'var(--bg)', stroke: 'var(--line)' }));
      var outLines = st.out.replace(/\n$/, '').split('\n').slice(-Math.max(1, Math.floor((ch - 30) / 17)));
      outLines.forEach(function (l, k) { if (l) svg.append(el('text', { x: ox + 10, y: 40 + k * 17, 'font-size': 12, 'font-family': 'var(--mono)' }, l.length > 34 ? l.slice(0, 33) + '…' : l)); });
      // Frames and objects
      var hotVars = [], keyOnly = {}, pointed = {};
      st.frames.forEach(function (f) { f.names.forEach(function (nm) { pointed[nm[1]] = 1; }); });
      Object.keys(heap).forEach(function (id) {
        var ob = heap[id];
        (ob.items || []).forEach(function (x) { if (Array.isArray(x)) { if (!pointed[x[0]]) keyOnly[x[0]] = 1; pointed[x[1]] = 1; } else pointed[x] = 1; });
        (ob.attrs || []).forEach(function (a) { pointed[a[1]] = 1; });
      });
      Object.keys(keyOnly).forEach(function (id) { if (pointed[id]) delete keyOnly[id]; });
      if (st.ret) delete keyOnly[st.ret];
      st.frames.forEach(function (f, fi) {
        var p = pv.frames[fi];
        f.names.forEach(function (nm) { var was = p && p.names.filter(function (x) { return x[0] === nm[0]; })[0]; if (i > 0 && (!was || was[1] !== nm[1] || st.frames.length !== pv.frames.length && fi === st.frames.length - 1)) hotVars.push(fi + ':' + nm[0]); });
      });
      var state = {
        hotVars: hotVars,
        frames: st.frames.map(function (f, fi) {
          return { name: f.name === 'module' ? 'Global frame' : f.name + (fi > 0 ? '  (line ' + f.line + ')' : ''), active: fi === st.frames.length - 1, vars: f.names.map(function (nm) { return { name: nm[0], to: nm[1] }; }).concat(st.event === 'return' && fi === st.frames.length - 1 && st.ret && st.frames.length > 1 ? [{ name: 'return', to: st.ret }] : []) };
        }),
        objects: Object.keys(heap).filter(function (id) { return !keyOnly[id]; }).map(function (id) {
          var ob = heap[id], pb = pheap[id], changed = i > 0 && (!pb || pb !== ob);
          var lines = [];
          if (ob.t === 'int' && opts.digits && ob.d) lines.push('digits (base 2' + M.sup(30) + '): ' + ob.d.join(', '));
          if (opts.sizes || opts.digits) { if (ob.sz) lines.push(ob.sz + ' bytes'); }
          if (ob.t === 'list' && ob.cap != null && opts.capacity !== false) lines.push(ob.items.length + ' used of ' + ob.cap + ' slots');
          var r = refs[id] || 0;
          var sub = short(id) + (smallInt(ob) ? ' · cached' : '') + ' · refs ' + r;
          var base = { id: id, title: ob.t === 'function' ? 'function' : ob.t, sub: sub, hot: changed, lines: lines, data: { refs: r, id: id } };
          if (ob.items && ob.t !== 'dict') {
            var cells = ob.items.map(function (x, k) { return { label: ob.t === 'list' || ob.t === 'tuple' ? String(k) : '\u2022', to: x, hot: changed && (!pb || !pb.items || pb.items[k] !== x) }; });
            if (ob.t === 'list' && ob.cap && opts.capacity !== false) for (var e = ob.items.length; e < Math.min(ob.cap, ob.items.length + 2); e++) cells.push({ label: String(e), empty: true });
            // Slots one under another, each a pointer: the arrows run straight to what they hold
            return Object.assign(base, { kind: 'map', index: true, cells: cells, value: reprOf(heap, id, 0) });
          }
          if (ob.items) return Object.assign(base, { kind: 'map', cells: ob.items.map(function (kv) { return { label: reprOf(heap, kv[0], 2), to: kv[1] }; }), value: reprOf(heap, id, 0) });
          if (ob.attrs) return Object.assign(base, { kind: 'map', cells: ob.attrs.map(function (a) { return { label: a[0], to: a[1] }; }) });
          return Object.assign(base, { kind: 'atom', value: ob.t === 'function' ? ob.v + '()' : ob.v });
        })
      };
      // Dict keys that are plain values are written inline: they need no arrows of their own
      var layer = el('g', { transform: 'translate(0,' + (ch + 14) + ')' });
      svg.append(layer);
      var h = diagram(svg, layer, state, { width: W });
      M.resize(svg, W, ch + 14 + h + 8);
      return captions[i];
    };
    draw(0);
    return { el: svg, captions: captions, draw: draw, trace: trace };
  };
})(window.__TideMachine);
