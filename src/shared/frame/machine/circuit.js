/* TideMachine.circuit: logic gates, blocks and wires; signals settle one gate delay at a time */
(function (M) {
  'use strict';
  var el = M.el;

  var GATES = {
    AND: function (v) { return v.every(Boolean) ? 1 : 0; },
    OR: function (v) { return v.some(Boolean) ? 1 : 0; },
    NOT: function (v) { return v[0] ? 0 : 1; },
    BUF: function (v) { return v[0] ? 1 : 0; },
    NAND: function (v) { return v.every(Boolean) ? 0 : 1; },
    NOR: function (v) { return v.some(Boolean) ? 0 : 1; },
    XOR: function (v) { return v.reduce(function (a, b) { return a ^ b; }, 0); },
    XNOR: function (v) { return v.reduce(function (a, b) { return a ^ b; }, 0) ? 0 : 1; }
  };
  /** Blocks: named inputs and outputs, and what they compute */
  var BLOCKS = {
    HA: { ins: ['a', 'b'], outs: ['s', 'c'], f: function (v) { return { s: v[0] ^ v[1], c: v[0] & v[1] }; }, label: 'half adder' },
    FA: { ins: ['cin', 'a', 'b'], outs: ['s', 'cout'], f: function (v) { var t = v[0] + v[1] + v[2]; return { s: t & 1, cout: t >> 1 }; }, label: 'full adder' },
    MUX: { ins: ['d0', 'd1', 'sel'], outs: ['y'], f: function (v) { return { y: v[2] ? v[1] : v[0] }; }, label: 'mux' }
  };

  /**
   * spec: { inputs: ['A', {id:'B', value:1, fixed:true}], gates: [{id, type, in: [refs], x?, y?}],
   * outputs: [{id, from}] }. A ref is an input's id, a gate's id, or block.port ('fa0.cout').
   * Gate types AND OR NOT BUF NAND NOR XOR XNOR; blocks HA (a b → s c), FA (cin a b → s cout),
   * MUX (d0 d1 sel → y). Without x and y, gates are laid out by depth.
   * opts: label, delayMs (260: one gate delay when the learner flips a switch), onChange(values).
   * Returns { el, set(inputs), values(), value(ref), propagate(inputs) → states, stepsFor(inputs) → {captions, draw}, onChange(fn) }.
   */
  M.circuit = function (into, spec, opts) {
    opts = opts || {};
    var inputs = (spec.inputs || []).map(function (i) { return typeof i === 'string' ? { id: i } : i; });
    var gates = (spec.gates || []).map(function (g) { return Object.assign({}, g, { type: String(g.type).toUpperCase(), in: g.in || [] }); });
    var outputs = (spec.outputs || []).map(function (o) { return typeof o === 'string' ? { id: o, from: o } : o; });
    var byId = {};
    gates.forEach(function (g) {
      if (!GATES[g.type] && !BLOCKS[g.type]) throw new Error('TideMachine.circuit: unknown gate type ' + g.type);
      byId[g.id] = g;
    });
    var isInput = {};
    inputs.forEach(function (i) { isInput[i.id] = i; });
    var srcOf = function (ref) { var p = String(ref).split('.'); return { node: p[0], port: p[1] || (byId[p[0]] && BLOCKS[byId[p[0]].type] ? BLOCKS[byId[p[0]].type].outs[0] : '') }; };
    var keyOf = function (ref) { var s = srcOf(ref); return s.port ? s.node + '.' + s.port : s.node; };
    var outsOf = function (g) { return BLOCKS[g.type] ? BLOCKS[g.type].outs.map(function (p) { return g.id + '.' + p; }) : [g.id]; };
    [].concat.apply([], gates.map(function (g) { return g.in; })).concat(outputs.map(function (o) { return o.from; })).forEach(function (ref) {
      var s = srcOf(ref);
      if (!isInput[s.node] && !byId[s.node]) throw new Error('TideMachine.circuit: nothing called ' + s.node);
    });

    // ---- Depth (for layout and for the order things settle) ----
    var level = {};
    var depth = function (id, seen) {
      if (isInput[id]) return 0;
      if (level[id] != null) return level[id];
      if (seen[id]) return 1;
      seen[id] = 1;
      var g = byId[id], d = 0;
      g.in.forEach(function (r) { d = Math.max(d, depth(srcOf(r).node, seen)); });
      return (level[id] = d + 1);
    };
    gates.forEach(function (g) { depth(g.id, {}); });

    // ---- Geometry ----
    var size = function (g) { return BLOCKS[g.type] ? { w: 92, h: g.type === 'MUX' ? 72 : 84 } : { w: 58, h: g.in.length > 2 ? 52 : 40 }; };
    var auto = gates.some(function (g) { return g.x == null || g.y == null; });
    var pinY = {};
    if (auto) {
      var cols = {}, maxLevel = 0;
      gates.forEach(function (g) { (cols[level[g.id]] = cols[level[g.id]] || []).push(g); maxLevel = Math.max(maxLevel, level[g.id]); });
      inputs.forEach(function (inp, k) { if (inp.y == null) inp.y = 46 + k * 58; });
      inputs.forEach(function (inp) { pinY[inp.id] = inp.y; });
      for (var L = 1; L <= maxLevel; L++) {
        var col = cols[L] || [];
        col.forEach(function (g) {
          var ys = g.in.map(function (r) { var s = srcOf(r); return pinY[s.node] != null ? pinY[s.node] : 0; });
          g._bary = ys.reduce(function (a, b) { return a + b; }, 0) / Math.max(1, ys.length);
        });
        col.sort(function (a, b) { return a._bary - b._bary; });
        var next = 24;
        col.forEach(function (g) {
          var sz = size(g), y = Math.max(next, g._bary - sz.h / 2);
          if (g.x == null) g.x = 170 + (L - 1) * 150;
          if (g.y == null) g.y = y;
          next = g.y + sz.h + 26;
          pinY[g.id] = g.y + sz.h / 2;
        });
      }
    }
    inputs.forEach(function (inp, k) { if (inp.y == null) inp.y = 46 + k * 58; if (inp.x == null) inp.x = 64; });
    var inPort = function (g, k) {
      var sz = size(g), n = g.in.length;
      var fr = BLOCKS[g.type] ? (k + 0.5) / n : n === 1 ? 0.5 : 0.18 + (0.64 * k) / (n - 1);
      return { x: g.x, y: g.y + sz.h * fr };
    };
    var outPort = function (ref) {
      var s = srcOf(ref);
      if (isInput[s.node]) return { x: isInput[s.node].x + 52, y: isInput[s.node].y };
      var g = byId[s.node], sz = size(g);
      if (!BLOCKS[g.type]) return { x: g.x + sz.w + (/^N|XN/.test(g.type) && g.type !== 'NOT' ? 8 : g.type === 'NOT' ? 8 : 0), y: g.y + sz.h / 2 };
      var outs = BLOCKS[g.type].outs, k = outs.indexOf(s.port);
      return { x: g.x + sz.w, y: g.y + sz.h * (outs.length === 1 ? 0.5 : k === 0 ? 0.22 : 0.8) };
    };
    var right = 0, bottom = 0;
    gates.forEach(function (g) { var sz = size(g); right = Math.max(right, g.x + sz.w); bottom = Math.max(bottom, g.y + sz.h); });
    inputs.forEach(function (i) { bottom = Math.max(bottom, i.y + 24); });
    var outX = opts.outX || right + 70;
    outputs.forEach(function (o) { if (o.y == null) o.y = outPort(o.from).y; bottom = Math.max(bottom, o.y + 24); });
    var W = Math.max(360, outX + 90), H = bottom + 16;
    var svg = M.svg(into, W, H, opts.label || 'A logic circuit');

    // ---- Signals ----
    var vals = {};
    var compute = function (g, read) {
      var v = g.in.map(function (r) { return read(keyOf(r)) ? 1 : 0; });
      if (GATES[g.type]) { var o = {}; o[g.id] = GATES[g.type](v); return o; }
      var res = BLOCKS[g.type].f(v), out = {};
      for (var p in res) out[g.id + '.' + p] = res[p];
      return out;
    };
    var settle = function (inVals) {
      var v = {};
      inputs.forEach(function (i) { v[i.id] = inVals[i.id] ? 1 : 0; });
      var order = gates.slice().sort(function (a, b) { return level[a.id] - level[b.id]; });
      for (var pass = 0; pass < 3; pass++) order.forEach(function (g) { Object.assign(v, compute(g, function (k) { return v[k] || 0; })); });
      return v;
    };
    var current = {};
    inputs.forEach(function (i) { current[i.id] = i.value ? 1 : 0; });
    vals = settle(current);

    /** The states from the settled `from` as new inputs arrive: one gate delay per state, until nothing changes */
    var propagate = function (inVals, from) {
      var v = Object.assign({}, from || vals), states = [];
      inputs.forEach(function (i) { if (inVals[i.id] != null) v[i.id] = inVals[i.id] ? 1 : 0; });
      states.push(Object.assign({}, v));
      for (var t = 0; t < 64; t++) {
        var nv = Object.assign({}, v), changed = [];
        gates.forEach(function (g) {
          var o = compute(g, function (k) { return v[k] || 0; });
          for (var k in o) if (nv[k] !== o[k]) { nv[k] = o[k]; changed.push(k); }
        });
        if (!changed.length) break;
        v = nv;
        var s = Object.assign({}, v);
        Object.defineProperty(s, '_changed', { value: changed, enumerable: false });
        states.push(s);
      }
      return states;
    };

    // ---- Drawing ----
    var wiresLayer = el('g'), partsLayer = el('g');
    svg.append(wiresLayer, partsLayer);
    var shape = function (g, on) {
      var sz = size(g), x = g.x, y = g.y, w = sz.w, h = sz.h, t = g.type, grp = el('g');
      var stroke = 'var(--ink-soft)', fill = 'var(--bg)';
      var base = t.replace(/^N(?=AND|OR)/, '').replace(/^XN/, 'X');
      var bubble = /^NAND|^NOR|^XNOR|^NOT/.test(t);
      var bw = bubble ? w : w;
      if (BLOCKS[t]) {
        grp.append(el('rect', { x: x, y: y, width: w, height: h, rx: 8, fill: 'var(--surface)', stroke: stroke, 'stroke-width': 1.4 }));
        grp.append(el('text', { x: x + w / 2, y: y + h / 2 + 4, 'text-anchor': 'middle', 'font-size': 12, 'font-weight': 600, fill: 'var(--ink)' }, g.label || BLOCKS[t].label));
        BLOCKS[t].ins.forEach(function (p, k) { var pt = inPort(g, k); grp.append(el('text', { x: pt.x + 5, y: pt.y + 4, 'font-size': 11, fill: 'var(--muted)' }, p)); });
        BLOCKS[t].outs.forEach(function (p) { var pt = outPort(g.id + '.' + p); grp.append(el('text', { x: pt.x - 5, y: pt.y + 4, 'text-anchor': 'end', 'font-size': 11, fill: 'var(--muted)' }, p)); });
        return grp;
      }
      var d;
      if (base === 'AND') d = 'M' + x + ' ' + y + ' H' + (x + bw - h / 2) + ' A' + h / 2 + ' ' + h / 2 + ' 0 0 1 ' + (x + bw - h / 2) + ' ' + (y + h) + ' H' + x + ' Z';
      else if (base === 'OR' || base === 'XOR') d = 'M' + x + ' ' + y + ' Q' + (x + 12) + ' ' + (y + h / 2) + ' ' + x + ' ' + (y + h) + ' Q' + (x + bw * 0.62) + ' ' + (y + h) + ' ' + (x + bw) + ' ' + (y + h / 2) + ' Q' + (x + bw * 0.62) + ' ' + y + ' ' + x + ' ' + y + ' Z';
      else d = 'M' + (x + 6) + ' ' + (y + 4) + ' L' + (x + bw - 2) + ' ' + (y + h / 2) + ' L' + (x + 6) + ' ' + (y + h - 4) + ' Z';
      grp.append(el('path', { d: d, fill: fill, stroke: on ? 'var(--accent)' : stroke, 'stroke-width': 1.5 }));
      if (base === 'XOR') grp.append(el('path', { d: 'M' + (x - 6) + ' ' + y + ' Q' + (x + 6) + ' ' + (y + h / 2) + ' ' + (x - 6) + ' ' + (y + h), fill: 'none', stroke: stroke, 'stroke-width': 1.5 }));
      if (bubble) grp.append(el('circle', { cx: x + bw + 4, cy: y + h / 2, r: 4, fill: 'var(--bg)', stroke: on ? 'var(--accent)' : stroke, 'stroke-width': 1.5 }));
      grp.append(el('text', { x: x + (base === 'AND' ? bw * 0.42 : base === 'BUF' || base === 'NOT' ? bw * 0.36 : bw * 0.46), y: y + h / 2 + 4, 'text-anchor': 'middle', 'font-size': 11, 'font-weight': 600, fill: 'var(--ink-soft)' }, t));
      return grp;
    };
    // Each input port's wire: horizontal, vertical in its own lane, horizontal
    var wires = [];
    gates.forEach(function (g) {
      g.in.forEach(function (r, k) { wires.push({ from: keyOf(r), a: outPort(r), b: inPort(g, k), lane: k, to: g.id }); });
    });
    outputs.forEach(function (o) { wires.push({ from: keyOf(o.from), a: outPort(o.from), b: { x: outX, y: o.y }, lane: 0, to: o.id }); });
    // Each channel (the gap before a column of parts) gives every net that turns in it a trunk of its own
    var channels = {};
    wires.forEach(function (w) {
      if (Math.abs(w.a.y - w.b.y) < 0.5) return;
      var ch = channels[w.b.x] = channels[w.b.x] || {};
      (ch[w.from] = ch[w.from] || []).push(w);
    });
    Object.keys(channels).forEach(function (bx) {
      var nets = Object.keys(channels[bx]).sort(function (p, q) { return channels[bx][p][0].a.y - channels[bx][q][0].a.y; });
      var startX = Math.max.apply(null, nets.map(function (n) { return channels[bx][n][0].a.x; }));
      var room = +bx - 12 - (startX + 10), step = nets.length > 1 ? Math.min(14, room / (nets.length - 1)) : 0;
      nets.forEach(function (n, k) {
        var ws = channels[bx][n], x = +bx - 12 - (nets.length - 1 - k) * step;
        var ys = ws.map(function (w) { return w.b.y; }).concat([ws[0].a.y]);
        var lo = Math.min.apply(null, ys), hi = Math.max.apply(null, ys);
        ws.forEach(function (w) {
          w.xm = Math.max(w.a.x + 8, x);
          // A junction where the trunk carries on past this branch
          w.dots = [];
          if (ws.length > 1 || w.b.y > lo + 0.5 && w.b.y < hi - 0.5) { if (w.b.y > lo + 0.5 && w.b.y < hi - 0.5) w.dots.push([w.xm, w.b.y]); }
          if (ws[0] === w && w.a.y > lo + 0.5 && w.a.y < hi - 0.5) w.dots.push([w.xm, w.a.y]);
        });
      });
    });

    var drawState = function (v, changed) {
      wiresLayer.replaceChildren();
      partsLayer.replaceChildren();
      changed = changed || [];
      wires.forEach(function (w) {
        var on = !!v[w.from], hot = changed.indexOf(w.from) >= 0;
        var xm = w.xm != null ? w.xm : Math.max(w.a.x + 10, w.b.x - 14);
        var d = Math.abs(w.a.y - w.b.y) < 0.5 ? 'M' + w.a.x + ' ' + w.a.y + ' H' + w.b.x : 'M' + w.a.x + ' ' + w.a.y + ' H' + xm + ' V' + w.b.y + ' H' + w.b.x;
        wiresLayer.append(el('path', { d: d, fill: 'none', stroke: on ? 'var(--accent)' : 'var(--line-strong)', 'stroke-width': on ? 2.6 : 1.6, 'stroke-linejoin': 'round', style: 'transition: stroke .2s ease' }));
        if (hot && !M.reduced()) {
          var pulse = el('path', { d: d, fill: 'none', stroke: on ? 'var(--accent)' : 'var(--muted)', 'stroke-width': 4, opacity: 0.35, 'stroke-linecap': 'round' });
          wiresLayer.append(pulse);
          setTimeout(function () { pulse.remove(); }, 240);
        }
        (w.dots || []).forEach(function (d) { wiresLayer.append(el('circle', { cx: d[0], cy: d[1], r: 3.2, fill: on ? 'var(--accent)' : 'var(--line-strong)' })); });
      });
      gates.forEach(function (g) {
        var outsOn = outsOf(g).some(function (k) { return v[k]; });
        var part = shape(g, outsOn);
        M.pickable(part, function () { return (g.label || g.type) + ' ' + g.id; }, function () {
          var d = { type: g.type, inputs: g.in.map(function (r) { return v[keyOf(r)] ? 1 : 0; }).join(' ') };
          outsOf(g).forEach(function (k) { d[k.indexOf('.') > 0 ? k.split('.')[1] : 'output'] = v[k] ? 1 : 0; });
          return d;
        });
        partsLayer.append(part);
      });
      inputs.forEach(function (i) {
        var on = !!v[i.id], g = el('g');
        g.append(el('rect', { x: i.x, y: i.y - 13, width: 40, height: 26, rx: 13, fill: on ? 'var(--accent)' : 'var(--surface)', stroke: on ? 'var(--accent)' : 'var(--line-strong)', 'stroke-width': 1.3 }));
        g.append(el('circle', { cx: on ? i.x + 27 : i.x + 13, cy: i.y, r: 9, fill: 'var(--bg)', stroke: 'var(--line-strong)', style: 'transition: cx .15s ease' }));
        g.append(el('line', { x1: i.x + 40, y1: i.y, x2: i.x + 52, y2: i.y, stroke: on ? 'var(--accent)' : 'var(--line-strong)', 'stroke-width': on ? 2.6 : 1.6 }));
        g.append(el('text', { x: i.x - 8, y: i.y + 4, 'text-anchor': 'end', 'font-size': 12, 'font-weight': 600, fill: i.fixed ? 'var(--muted)' : 'var(--ink)' }, (i.label || i.id) + ' = ' + (on ? 1 : 0)));
        if (!i.fixed) {
          g.setAttribute('role', 'switch');
          g.setAttribute('aria-checked', on ? 'true' : 'false');
          g.setAttribute('aria-label', 'Input ' + (i.label || i.id));
          g.setAttribute('tabindex', '0');
          g.style.cursor = 'pointer';
          var flip = function (e) {
            if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            var next = {}; next[i.id] = current[i.id] ? 0 : 1;
            api.flip(next, true);
            var again = svg.querySelector('[aria-label="Input ' + (i.label || i.id) + '"]');
            if (again) again.focus();
          };
          g.addEventListener('click', flip);
          g.addEventListener('keydown', flip);
        }
        partsLayer.append(g);
      });
      outputs.forEach(function (o) {
        var on = !!v[keyOf(o.from)], g = el('g');
        if (on) g.append(el('circle', { cx: outX + 14, cy: o.y, r: 19, fill: 'var(--accent-soft)' }));
        g.append(el('circle', { cx: outX + 14, cy: o.y, r: 12, fill: on ? 'var(--accent)' : 'var(--bg)', stroke: on ? 'var(--accent)' : 'var(--line-strong)', 'stroke-width': 1.5 }));
        g.append(el('text', { x: outX + 34, y: o.y + 4, 'font-size': 12, 'font-weight': 600 }, (o.label || o.id) + ' = ' + (on ? 1 : 0)));
        M.pickable(g, 'output ' + (o.label || o.id), function () { return { value: v[keyOf(o.from)] ? 1 : 0 }; });
        partsLayer.append(g);
      });
    };

    var listeners = opts.onChange ? [opts.onChange] : [];
    /** A signal's name for a caption: a block's port in words */
    var nameOf = function (key) {
      var p = key.split('.'), g = byId[p[0]];
      if (!g) return key;
      var who = g.label || g.id;
      if (!p[1]) return 'the ' + g.type + ' gate\u2019s output';
      return ({ s: 'the sum of ', c: 'the carry of ', cout: 'the carry out of ', y: 'the output of ' })[p[1]] + who;
    };
    var timer = 0;
    var describe = function (v) {
      return inputs.map(function (i) { return (i.label || i.id) + ' = ' + (v[i.id] ? 1 : 0); }).join(', ') + ': ' + outputs.map(function (o) { return (o.label || o.id) + ' = ' + (v[keyOf(o.from)] ? 1 : 0); }).join(', ');
    };
    var api = {
      el: svg,
      inputs: inputs.map(function (i) { return i.id; }),
      outputs: outputs.map(function (o) { return o.id; }),
      values: function () { return Object.assign({}, vals); },
      value: function (ref) { var k = keyOf(ref); if (outputs.some(function (o) { return o.id === ref; })) k = keyOf(outputs.filter(function (o) { return o.id === ref; })[0].from); return vals[k] ? 1 : 0; },
      current: function () { return Object.assign({}, current); },
      isFixed: function (id) { return !!(isInput[id] && isInput[id].fixed); },
      /** An output's (or any ref's) value in a state from propagate */
      valueIn: function (state, ref) { var o = outputs.filter(function (out) { return out.id === ref; })[0]; return state[keyOf(o ? o.from : ref)] ? 1 : 0; },
      /** Settled at once for these inputs (no animation) */
      set: function (inVals) {
        for (var k in inVals) if (isInput[k]) current[k] = inVals[k] ? 1 : 0;
        vals = settle(current);
        drawState(vals);
        listeners.forEach(function (f) { f(api.values()); });
        return api;
      },
      /** New inputs, settling one gate delay at a time on screen (at once with reduced motion) */
      flip: function (inVals, byLearner) {
        clearInterval(timer);
        for (var k in inVals) if (isInput[k]) current[k] = inVals[k] ? 1 : 0;
        var states = propagate(current, vals), i = 0;
        var done = function () {
          vals = states[states.length - 1];
          drawState(vals);
          listeners.forEach(function (f) { f(api.values()); });
          if (byLearner) M.report('set ' + describe(vals) + ' (settled after ' + (states.length - 1) + ' gate delay' + (states.length === 2 ? '' : 's') + ')', Object.assign({ delays: states.length - 1 }, outputs.reduce(function (o, out) { o[out.label || out.id] = vals[keyOf(out.from)] ? 1 : 0; return o; }, {})));
        };
        if (M.reduced() || states.length < 2) return done();
        drawState(states[0]);
        timer = setInterval(function () {
          i++;
          if (i >= states.length - 1) { clearInterval(timer); return done(); }
          drawState(states[i], states[i]._changed);
        }, opts.delayMs || 260);
        return api;
      },
      propagate: function (inVals) { return propagate(inVals, vals); },
      /**
       * Steps for visual.steps: from the circuit as it is now, new inputs arrive and settle one
       * gate delay per step. Returns { captions, draw }.
       */
      stepsFor: function (inVals, before) {
        var from = before ? settle(Object.assign({}, current, before)) : vals;
        var states = propagate(inVals, from);
        var captions = states.map(function (s, k) {
          if (k === 0) return 'The inputs change to ' + inputs.map(function (i) { return (i.label || i.id) + ' = ' + s[i.id]; }).join(', ') + '. Nothing after them has reacted yet.';
          var ch = s._changed || [];
          var said = ch.map(function (key) { var o = outputs.filter(function (out) { return keyOf(out.from) === key; })[0]; return (o ? (o.label || o.id) : nameOf(key)) + ' becomes ' + s[key]; });
          return 'After ' + k + ' gate delay' + (k === 1 ? '' : 's') + ': ' + said.join(', ') + (k === states.length - 1 ? '. Settled: ' + describe(s) + '.' : '.');
        });
        return { captions: captions, states: states, draw: function (i) {
          var s = states[Math.max(0, Math.min(states.length - 1, i))];
          inputs.forEach(function (inp) { current[inp.id] = s[inp.id]; });
          vals = s;
          drawState(s, s._changed);
          listeners.forEach(function (f) { f(api.values()); });
        } };
      },
      onChange: function (f) { listeners.push(f); }
    };
    drawState(vals);
    if (window.visual) window.visual.onReset(function () { inputs.forEach(function (i) { current[i.id] = i.value ? 1 : 0; }); api.set(current); });
    return api;
  };

  /** A truth table for a circuit (at most 5 inputs): every row settled; the row it is in now is marked, and a row clicked sets it */
  M.truthTable = function (into, circuit) {
    var ins = circuit.inputs.filter(function (n) { return !circuit.isFixed(n); }), outs = circuit.outputs;
    if (ins.length > 5) throw new Error('TideMachine.truthTable: at most 5 inputs');
    var table = M.h('table', { style: 'border-collapse:collapse;font:12px var(--mono);margin:10px 0 0', 'aria-label': 'Truth table' });
    var head = M.h('tr');
    ins.concat(outs).forEach(function (n, k) { head.append(M.h('th', { style: 'padding:3px 12px;text-align:center;font-weight:600;color:var(--ink-soft);border-bottom:1px solid var(--line-strong);' + (k === ins.length ? 'border-left:1px solid var(--line-strong)' : '') }, n)); });
    table.append(head);
    var rows = [];
    for (var r = 0; r < Math.pow(2, ins.length); r++) {
      var inVals = {};
      ins.forEach(function (n, k) { inVals[n] = (r >> (ins.length - 1 - k)) & 1; });
      var st = circuit.propagate(inVals), last = st[st.length - 1];
      var tr = M.h('tr', { tabindex: '0', role: 'button', 'aria-label': 'Set ' + ins.map(function (n) { return n + ' = ' + inVals[n]; }).join(', '), style: 'cursor:pointer' });
      ins.forEach(function (n) { tr.append(M.h('td', { style: 'padding:3px 12px;text-align:center;color:var(--ink-soft)' }, String(inVals[n]))); });
      outs.forEach(function (n, k) { tr.append(M.h('td', { style: 'padding:3px 12px;text-align:center;font-weight:600;' + (k === 0 ? 'border-left:1px solid var(--line-strong)' : '') }, String(circuit.valueIn(last, n)))); });
      (function (inVals, tr) {
        var go = function (e) { if (e.type === 'keydown' && e.key !== 'Enter') return; circuit.flip(inVals, true); };
        tr.addEventListener('click', go);
        tr.addEventListener('keydown', go);
        rows.push({ inVals: inVals, tr: tr });
      })(inVals, tr);
      table.append(tr);
    }
    var mark = function () {
      var c = circuit.current();
      rows.forEach(function (row) {
        var on = ins.every(function (n) { return row.inVals[n] === c[n]; });
        row.tr.style.background = on ? 'var(--accent-soft)' : '';
        row.tr.style.boxShadow = on ? 'inset 3px 0 0 var(--accent)' : '';
      });
    };
    circuit.onChange(mark);
    mark();
    M.host(into).append(table);
    return { el: table, mark: mark };
  };

  /** Ready-made circuits, laid out by hand; pass to TideMachine.circuit */
  M.circuits = {
    halfAdder: function () {
      return {
        inputs: [{ id: 'A', y: 56 }, { id: 'B', y: 122 }],
        gates: [{ id: 'sum', type: 'XOR', in: ['A', 'B'], x: 190, y: 40 }, { id: 'carry', type: 'AND', in: ['A', 'B'], x: 190, y: 120 }],
        outputs: [{ id: 'S', from: 'sum' }, { id: 'C', from: 'carry', label: 'Carry' }]
      };
    },
    fullAdder: function () {
      return {
        inputs: [{ id: 'A', y: 50 }, { id: 'B', y: 108 }, { id: 'Cin', y: 196 }],
        gates: [
          { id: 'x1', type: 'XOR', in: ['A', 'B'], x: 150, y: 58 },
          { id: 'x2', type: 'XOR', in: ['x1', 'Cin'], x: 320, y: 40 },
          { id: 'a1', type: 'AND', in: ['A', 'B'], x: 150, y: 210 },
          { id: 'a2', type: 'AND', in: ['x1', 'Cin'], x: 320, y: 150 },
          { id: 'o1', type: 'OR', in: ['a2', 'a1'], x: 460, y: 176 }
        ],
        outputs: [{ id: 'S', from: 'x2' }, { id: 'Cout', from: 'o1' }]
      };
    },
    mux2: function () {
      return {
        inputs: [{ id: 'D0', y: 50 }, { id: 'D1', y: 130 }, { id: 'S', label: 'Sel', y: 214 }],
        gates: [
          { id: 'n', type: 'NOT', in: ['S'], x: 130, y: 194 },
          { id: 'a0', type: 'AND', in: ['D0', 'n'], x: 300, y: 40 },
          { id: 'a1', type: 'AND', in: ['D1', 'S'], x: 300, y: 132 },
          { id: 'o', type: 'OR', in: ['a0', 'a1'], x: 440, y: 80 }
        ],
        outputs: [{ id: 'Y', from: 'o' }]
      };
    },
    /** n full adders, carry rippling from bit 0 (top) to bit n−1 */
    rippleAdder: function (n) {
      n = Math.max(2, Math.min(8, n || 4));
      var inputs = [{ id: 'C0', label: 'Cin', value: 0, fixed: true, y: 34 }], gates = [], outputs = [];
      for (var i = 0; i < n; i++) {
        var y = 20 + i * 96;
        inputs.push({ id: 'A' + i, y: y + 42 }, { id: 'B' + i, y: y + 70 });
        gates.push({ id: 'fa' + i, type: 'FA', label: 'FA ' + i, in: [i === 0 ? 'C0' : 'fa' + (i - 1) + '.cout', 'A' + i, 'B' + i], x: 196 + i * 112, y: y });
        outputs.push({ id: 'S' + i, from: 'fa' + i + '.s' });
      }
      outputs.push({ id: 'Cout', from: 'fa' + (n - 1) + '.cout' });
      return { inputs: inputs, gates: gates, outputs: outputs };
    }
  };
})(window.__TideMachine);
