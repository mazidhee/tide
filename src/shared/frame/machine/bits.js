/* TideMachine.bits: a register drawn as switches and light bulbs, with place values */
(function (M) {
  'use strict';
  var el = M.el;

  /**
   * opts: n (8), value (0), signed (false: the top bit weighs −2^(n−1)), editable (true),
   * label, nibbles (true: the hex digit under each group of four), sum (true: the place values
   * that add up), onChange(value).
   * Returns { el, get(), set(v), unsigned(), mark(indexes, text), setSigned(bool) }.
   */
  M.bits = function (into, opts) {
    opts = opts || {};
    var n = Math.max(1, Math.min(32, opts.n || 8));
    var signed = !!opts.signed;
    var editable = opts.editable !== false;
    var col = Math.min(60, Math.floor(600 / n));
    var r = Math.max(7, Math.min(15, col * 0.27));
    var left = 20, W = left * 2 + col * n;
    W = Math.max(W, 360);
    var x0 = (W - col * n) / 2;
    var H = 236;
    var svg = M.svg(into, W, H, (opts.label || 'A register of ' + n + ' bits') + ': switches and bulbs');
    var u = M.unsigned(opts.value || 0, n);
    var marks = { at: [], text: '' };
    var weight = function (i) { var p = n - 1 - i; return (signed && i === 0 ? -1 : 1) * Math.pow(2, p); };
    var cx = function (i) { return x0 + col * i + col / 2; };
    var bitAt = function (i) { return Math.floor(u / Math.pow(2, n - 1 - i)) % 2; };

    function toggle(i) {
      var p = Math.pow(2, n - 1 - i);
      u = bitAt(i) ? u - p : u + p;
      draw();
      var v = api.get();
      M.report('switched bit ' + (n - 1 - i) + ' (place value ' + weight(i) + ') ' + (bitAt(i) ? 'on' : 'off') + ': the register is now ' + M.bin(u, n) + ' = ' + v + (signed ? ' (two’s complement)' : '') + ' = 0x' + M.hex(u, Math.ceil(n / 4)), { bits: M.bin(u, n), value: v, hex: '0x' + M.hex(u, Math.ceil(n / 4)) });
      if (opts.onChange) opts.onChange(v);
    }

    function draw() {
      svg.replaceChildren();
      var title = opts.label || (signed ? n + '-bit signed register (two’s complement)' : n + '-bit register');
      svg.append(el('text', { x: x0, y: 16, 'font-size': 12, fill: 'var(--muted)' }, title));
      for (var i = 0; i < n; i++) {
        var on = bitAt(i) === 1, x = cx(i), marked = marks.at.indexOf(i) >= 0;
        var g = el('g', { 'data-bit': i });
        // Bulb: glass, filament, base
        if (on) g.append(el('circle', { cx: x, cy: 50, r: r + 7, fill: 'var(--accent-soft)' }));
        g.append(el('circle', { cx: x, cy: 50, r: r, fill: on ? 'var(--accent)' : 'var(--bg)', stroke: on ? 'var(--accent)' : 'var(--line-strong)', 'stroke-width': 1.5, style: 'transition: fill .18s ease' }));
        g.append(el('path', { d: 'M' + (x - r * 0.4) + ' ' + (50 + r * 0.15) + ' l' + r * 0.2 + ' ' + -r * 0.45 + ' l' + r * 0.2 + ' ' + r * 0.45 + ' l' + r * 0.2 + ' ' + -r * 0.45 + ' l' + r * 0.2 + ' ' + r * 0.45, fill: 'none', stroke: on ? 'var(--bg)' : 'var(--line-strong)', 'stroke-width': 1.2 }));
        g.append(el('rect', { x: x - r * 0.5, y: 50 + r - 1, width: r, height: 6, rx: 1.5, fill: 'var(--line-strong)' }));
        // Switch
        var sw = el('g', { class: 'tm-switch' });
        sw.append(el('rect', { x: x - 12, y: 82, width: 24, height: 38, rx: 6, fill: on ? 'var(--accent-soft)' : 'var(--surface)', stroke: marked ? 'var(--warn)' : on ? 'var(--accent)' : 'var(--line-strong)', 'stroke-width': marked ? 2 : 1.2 }));
        sw.append(el('rect', { x: x - 8, y: on ? 86 : 102, width: 16, height: 14, rx: 4, fill: on ? 'var(--accent)' : 'var(--muted)', style: 'transition: y .15s ease' }));
        sw.append(el('text', { x: x, y: 138, 'text-anchor': 'middle', 'font-size': 14, 'font-family': 'var(--mono)', 'font-weight': 600, fill: on ? 'var(--ink)' : 'var(--muted)' }, on ? '1' : '0'));
        if (editable) {
          (function (i, sw) {
            sw.setAttribute('role', 'switch');
            sw.setAttribute('aria-checked', on ? 'true' : 'false');
            sw.setAttribute('tabindex', '0');
            sw.setAttribute('aria-label', 'Bit ' + (n - 1 - i) + ', place value ' + weight(i));
            sw.style.cursor = 'pointer';
            sw.addEventListener('click', function () { toggle(i); focusBit(i); });
            sw.addEventListener('keydown', function (e) {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); toggle(i); focusBit(i); }
            });
          })(i, sw);
        }
        g.append(sw);
        // Place value
        var w = weight(i);
        g.append(el('text', { x: x, y: 160, 'text-anchor': 'middle', 'font-size': col < 34 ? 11 : 12, 'font-family': 'var(--mono)', fill: w < 0 ? 'var(--neg)' : on ? 'var(--ink)' : 'var(--muted)' }, (w < 0 ? '−' : '') + Math.abs(w)));
        g.append(el('text', { x: x, y: 175, 'text-anchor': 'middle', 'font-size': 11, fill: 'var(--muted)' }, (w < 0 ? '−' : '') + '2' + M.sup(n - 1 - i)));
        svg.append(g);
      }
      // Nibbles and their hex digits
      if (opts.nibbles !== false && n % 4 === 0) {
        for (var k = 0; k < n / 4; k++) {
          var a = x0 + col * 4 * k + 4, b = x0 + col * 4 * (k + 1) - 4, nib = 0;
          for (var j = 0; j < 4; j++) nib = nib * 2 + bitAt(k * 4 + j);
          svg.append(el('path', { d: 'M' + a + ' 184 v5 H' + b + ' v-5', fill: 'none', stroke: 'var(--line-strong)' }));
          svg.append(el('text', { x: (a + b) / 2, y: 204, 'text-anchor': 'middle', 'font-size': 13, 'font-family': 'var(--mono)', fill: 'var(--ink-soft)' }, nib.toString(16).toUpperCase()));
        }
      }
      // What it adds up to
      var v = api.get(), terms = [];
      for (var t = 0; t < n; t++) if (bitAt(t)) terms.push(weight(t));
      var sum = opts.sum === false ? '' : (terms.length ? terms.map(function (w, i) { return (i === 0 ? (w < 0 ? '−' : '') : (w < 0 ? ' − ' : ' + ')) + Math.abs(w); }).join('') + ' = ' : '');
      var line = el('text', { x: x0, y: 228, 'font-size': 13, 'font-family': 'var(--mono)' });
      line.append(el('tspan', { fill: 'var(--muted)' }, sum));
      line.append(el('tspan', { fill: 'var(--ink)', 'font-weight': 600 }, String(v).replace('-', '−')));
      line.append(el('tspan', { fill: 'var(--muted)', dx: 14 }, 'hex '));
      line.append(el('tspan', { fill: 'var(--ink)', 'font-weight': 600 }, '0x' + M.hex(u, Math.ceil(n / 4))));
      if (marks.text) line.append(el('tspan', { fill: 'var(--warn)', dx: 14 }, marks.text));
      svg.append(line);
    }
    function focusBit(i) { var s = svg.querySelectorAll('.tm-switch')[i]; if (s) s.focus(); }
    svg.addEventListener('keydown', function (e) {
      var sws = Array.prototype.slice.call(svg.querySelectorAll('.tm-switch')), i = sws.indexOf(document.activeElement);
      if (i < 0) return;
      // Arrow keys move between switches (and don't step the visual)
      if (e.key === 'ArrowLeft' && i > 0) { e.preventDefault(); e.stopPropagation(); sws[i - 1].focus(); }
      if (e.key === 'ArrowRight' && i < n - 1) { e.preventDefault(); e.stopPropagation(); sws[i + 1].focus(); }
    }, true);

    var api = {
      el: svg,
      n: n,
      get: function () { return signed ? M.signed(u, n) : u; },
      unsigned: function () { return u; },
      set: function (v) { u = M.unsigned(v, n); draw(); return api; },
      setSigned: function (s) { signed = !!s; draw(); return api; },
      /** Outline some bits (indexes from the left, 0 = most significant) with a note */
      mark: function (at, text) { marks = { at: at || [], text: text || '' }; draw(); return api; },
      bit: bitAt
    };
    draw();
    return api;
  };
})(window.__TideMachine);
