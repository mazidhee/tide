/* TideMachine.memory: addressed bytes in rows, with marked ranges (ints, strings) and pointer arrows */
(function (M) {
  'use strict';
  var el = M.el;

  /**
   * opts: size (32 bytes), cols (8), base (0: the first address), bytes (initial values),
   * show ('hex' | 'dec' | 'bin'), label, addrDigits (4).
   * Returns { el, read(addr), write(addr, bytes), writeInt(addr, value, {size, endian, signed, label}),
   * readInt(addr, {size, endian, signed}), mark(addr, len, {label, color}), pointer(from, to, {label}),
   * focus(addr, len) (the bytes being read or written now), clear() (marks, arrows, focus) }.
   * Addresses are absolute (base + offset).
   */
  M.memory = function (into, opts) {
    opts = opts || {};
    var size = Math.max(1, Math.min(256, opts.size || 32)), cols = Math.max(1, Math.min(16, opts.cols || 8));
    var base = opts.base || 0, show = opts.show || 'hex', digits = opts.addrDigits || 4;
    var bytes = new Array(size).fill(0);
    (opts.bytes || []).forEach(function (b, i) { if (i < size) bytes[i] = b & 255; });
    var rows = Math.ceil(size / cols);
    var cw = show === 'bin' ? 74 : 40, ch = 30, gx = 82, gy = 44;
    var gridW = gx + cols * cw;
    var noteW = opts.notes === false ? 0 : 210;
    var W = Math.max(360, gridW + noteW + 16), H = gy + rows * ch + 34;
    var svg = M.svg(into, W, H, opts.label || 'Memory: ' + size + ' bytes');
    var marks = [], pointers = [], focus = null;
    var color = function (c) { return c ? (/^--/.test(c) ? 'var(' + c + ')' : /^c\d$|^accent$|^warn$|^good$|^bad$/.test(c) ? 'var(--' + c + ')' : c) : 'var(--c1)'; };
    var fmt = function (b) { return show === 'dec' ? String(b) : show === 'bin' ? M.bin(b, 8) : M.hex(b, 2); };
    var cell = function (addr) { var o = addr - base; return { x: gx + (o % cols) * cw, y: gy + Math.floor(o / cols) * ch }; };
    var inRange = function (addr) { return addr >= base && addr < base + size; };

    function draw() {
      svg.replaceChildren();
      svg.append(el('text', { x: 0, y: 16, 'font-size': 12, fill: 'var(--muted)' }, opts.label || 'Memory'));
      for (var c = 0; c < cols; c++) svg.append(el('text', { x: gx + c * cw + cw / 2, y: gy - 6, 'text-anchor': 'middle', 'font-size': 11, 'font-family': 'var(--mono)', fill: 'var(--muted)' }, '+' + c.toString(16).toUpperCase()));
      for (var r = 0; r < rows; r++) svg.append(el('text', { x: gx - 10, y: gy + r * ch + ch / 2 + 4, 'text-anchor': 'end', 'font-size': 12, 'font-family': 'var(--mono)', fill: 'var(--muted)' }, '0x' + M.hex(base + r * cols, digits)));
      // Marked ranges tint their cells
      var tint = {};
      marks.forEach(function (m) { for (var a = m.addr; a < m.addr + m.len; a++) tint[a] = m; });
      for (var i = 0; i < size; i++) {
        var addr = base + i, p = cell(addr), m = tint[addr], f = focus && addr >= focus.addr && addr < focus.addr + focus.len;
        var g = el('g');
        g.append(el('rect', { x: p.x + 1, y: p.y + 1, width: cw - 2, height: ch - 2, rx: 4, fill: m ? 'color-mix(in srgb, ' + color(m.color) + ' 16%, var(--bg))' : 'var(--bg)', stroke: f ? 'var(--accent)' : m ? color(m.color) : 'var(--line)', 'stroke-width': f ? 2 : 1 }));
        g.append(el('text', { x: p.x + cw / 2, y: p.y + ch / 2 + 4, 'text-anchor': 'middle', 'font-size': 12, 'font-family': 'var(--mono)', fill: bytes[i] || m ? 'var(--ink)' : 'var(--muted)' }, fmt(bytes[i])));
        (function (addr, i) {
          M.pickable(g, 'address 0x' + M.hex(addr, digits), function () { return { address: '0x' + M.hex(addr, digits), value: bytes[i], hex: '0x' + M.hex(bytes[i], 2), binary: M.bin(bytes[i], 8) }; });
        })(addr, i);
        svg.append(g);
      }
      // Notes on the right, one per mark, in address order, never overlapping
      var noteY = gy + 12;
      marks.slice().sort(function (a, b) { return a.addr - b.addr; }).forEach(function (m) {
        if (!m.label || !noteW) return;
        var start = cell(m.addr), endA = cell(m.addr + m.len - 1);
        var y = Math.max(noteY, start.y + ch / 2 + 4);
        var lx = gridW + 14;
        // Under the cells: it runs behind any it passes, out to its note
        svg.insertBefore(el('path', { d: 'M' + (endA.x + cw) + ' ' + (endA.y + ch / 2) + ' H' + (gridW + 4) + ' L' + (lx - 2) + ' ' + (y - 4), fill: 'none', stroke: color(m.color), 'stroke-width': 1, opacity: 0.7 }), svg.firstChild);
        var t = el('text', { x: lx, y: y, 'font-size': 12, fill: 'var(--ink)' });
        var lines = String(m.label).split('\n');
        lines.forEach(function (line, k) { t.append(el('tspan', { x: lx, dy: k ? 15 : 0, fill: k ? 'var(--muted)' : color(m.color), 'font-weight': k ? 400 : 600 }, line)); });
        svg.append(t);
        noteY = y + 15 * lines.length + 8;
      });
      pointers.forEach(function (p) {
        if (!inRange(p.from) || !inRange(p.to)) return;
        var a = cell(p.from), b = cell(p.to);
        var x1 = a.x + cw / 2, x2 = b.x + cw / 2, d;
        if (a.y === b.y) {
          // Along the row: an arc over it
          var lift = 18 + Math.abs(x2 - x1) * 0.12;
          d = 'M' + x1 + ' ' + (a.y + 4) + ' C' + x1 + ' ' + (a.y - lift) + ' ' + x2 + ' ' + (b.y - lift) + ' ' + x2 + ' ' + (b.y + 3);
        } else if (b.y < a.y) {
          // Up: from the top of the pointer's cell to the bottom of the target's
          d = 'M' + x1 + ' ' + (a.y + 3) + ' C' + x1 + ' ' + (a.y - ch) + ' ' + x2 + ' ' + (b.y + ch * 2) + ' ' + x2 + ' ' + (b.y + ch - 3);
        } else {
          d = 'M' + x1 + ' ' + (a.y + ch - 3) + ' C' + x1 + ' ' + (a.y + ch * 2) + ' ' + x2 + ' ' + (b.y - ch) + ' ' + x2 + ' ' + (b.y + 3);
        }
        var y1 = a.y, y2 = b.y, lift2 = 18;
        M.arrow(svg, svg, 0, 0, 0, 0, { d: d, color: 'var(--accent)', width: 1.8 });
        if (p.label) svg.append(el('text', { x: (x1 + x2) / 2, y: Math.min(y1, y2) - lift2 * 0.5, 'text-anchor': 'middle', 'font-size': 11, fill: 'var(--accent)' }, p.label));
      });
      var need = Math.max(gy + rows * ch + 34, noteY + 8);
      if (need !== H) { H = need; M.resize(svg, W, H); }
    }

    var api = {
      el: svg,
      bytes: bytes,
      read: function (addr) { return bytes[addr - base]; },
      write: function (addr, list) { (Array.isArray(list) ? list : [list]).forEach(function (b, k) { if (inRange(addr + k)) bytes[addr - base + k] = b & 255; }); draw(); return api; },
      /** Writes an integer's bytes (size 4, little-endian unless endian: 'big') and marks them with what they mean */
      writeInt: function (addr, value, o) {
        o = o || {};
        var sz = o.size || 4, endian = o.endian || 'little';
        var bs = M.bytesOf(value, sz, endian);
        api.write(addr, bs);
        var label = (o.label ? o.label + ': ' : '') + (o.signed === false ? 'uint' : 'int') + sz * 8 + ' ' + value + '\n' + (endian === 'little' ? 'little-endian: lowest byte first' : 'big-endian: highest byte first') + '\n= 0x' + M.hex(M.unsigned(value, sz * 8), sz * 2);
        if (o.mark !== false) api.mark(addr, sz, { label: label, color: o.color || 'c1' });
        return api;
      },
      readInt: function (addr, o) {
        o = o || {};
        var sz = o.size || 4, bs = [];
        for (var k = 0; k < sz; k++) bs.push(bytes[addr - base + k]);
        if (o.endian !== 'big') bs.reverse();
        var u = bs.reduce(function (a, b) { return a * 256 + b; }, 0);
        return o.signed === false ? u : M.signed(u, sz * 8);
      },
      /** Writes a string's UTF-8 bytes, a 0 after it unless nul: false, and marks them */
      writeString: function (addr, s, o) {
        o = o || {};
        var bs = Array.from(new TextEncoder().encode(s));
        if (o.nul !== false) bs.push(0);
        api.write(addr, bs);
        if (o.mark !== false) api.mark(addr, bs.length, { label: (o.label ? o.label + ': ' : '') + JSON.stringify(s) + '\n' + bs.length + ' bytes' + (o.nul !== false ? ', ending in 0' : ''), color: o.color || 'c3' });
        return api;
      },
      mark: function (addr, len, o) { o = o || {}; marks = marks.filter(function (m) { return m.addr !== addr; }); marks.push({ addr: addr, len: len || 1, label: o.label || '', color: o.color }); draw(); return api; },
      /** An arrow from the cell holding a pointer to the address it holds */
      pointer: function (from, to, o) { o = o || {}; pointers.push({ from: from, to: to, label: o.label || '' }); draw(); return api; },
      focus: function (addr, len) { focus = addr == null ? null : { addr: addr, len: len || 1 }; draw(); return api; },
      clear: function () { marks = []; pointers = []; focus = null; draw(); return api; },
      cellAt: function (addr) { var p = cell(addr); return { x: p.x, y: p.y, w: cw, h: ch }; }
    };
    draw();
    return api;
  };
})(window.__TideMachine);
