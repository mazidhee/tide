/* TideMachine.cpu: a tiny 8-bit CPU, stepped through fetch, decode and execute */
(function (M) {
  'use strict';
  var el = M.el;

  /**
   * The instruction set: two bytes each. Byte 0 is opcode (4 bits) | register a (2) | register b
   * (2); byte 1 is an address or a number. Four registers R0 to R3; one flag, Z (the last result
   * was zero). Arithmetic wraps at 256.
   */
  var OPS = {
    HALT: { code: 0, args: [], does: 'stop' },
    LOAD: { code: 1, args: ['r', 'addr'], does: 'Ra ← memory[addr]' },
    STORE: { code: 2, args: ['r', 'addr'], does: 'memory[addr] ← Ra' },
    LOADI: { code: 3, args: ['r', 'imm'], does: 'Ra ← number' },
    ADD: { code: 4, args: ['r', 'r'], does: 'Ra ← Ra + Rb' },
    SUB: { code: 5, args: ['r', 'r'], does: 'Ra ← Ra − Rb' },
    JMP: { code: 6, args: ['addr'], does: 'PC ← addr' },
    JZ: { code: 7, args: ['addr'], does: 'if Z: PC ← addr' },
    AND: { code: 8, args: ['r', 'r'], does: 'Ra ← Ra AND Rb' },
    OR: { code: 9, args: ['r', 'r'], does: 'Ra ← Ra OR Rb' }
  };
  var NAMES = {};
  Object.keys(OPS).forEach(function (k) { NAMES[OPS[k].code] = k; });

  /** Assembly text to bytes: one instruction a line, "label:" marks an address, ; or # starts a comment */
  M.assemble = function (text, size) {
    size = size || 16;
    var lines = String(text).split('\n'), labels = {}, at = 0, list = [];
    lines.forEach(function (raw, n) {
      var line = raw.replace(/[;#].*$/, '').trim();
      var lab = /^([A-Za-z_]\w*):\s*(.*)$/.exec(line);
      if (lab) { labels[lab[1].toLowerCase()] = at; line = lab[2].trim(); }
      if (!line) return;
      var m = /^([A-Za-z]+)\s*(.*)$/.exec(line);
      var op = m && OPS[m[1].toUpperCase()];
      if (!op) throw new Error('Line ' + (n + 1) + ': unknown instruction "' + line + '"');
      list.push({ op: m[1].toUpperCase(), args: m[2] ? m[2].split(',').map(function (s) { return s.trim(); }) : [], line: n + 1, at: at, text: line });
      at += 2;
    });
    var bytes = new Array(size).fill(0), source = {};
    var num = function (s, n) {
      var t = s.replace(/^\[|\]$/g, '').replace(/^#/, '').trim();
      if (labels[t.toLowerCase()] != null) return labels[t.toLowerCase()];
      var v = /^-?0x[0-9a-f]+$/i.test(t) ? parseInt(t, 16) : /^-?0b[01]+$/i.test(t) ? parseInt(t.replace(/0b/i, ''), 2) * (t[0] === '-' ? -1 : 1) : Number(t);
      if (!isFinite(v)) throw new Error('Line ' + n + ': "' + s + '" is not a number or a label');
      return v & 255;
    };
    var reg = function (s, n) { var r = /^r([0-3])$/i.exec(s); if (!r) throw new Error('Line ' + n + ': "' + s + '" is not a register (R0 to R3)'); return +r[1]; };
    list.forEach(function (ins) {
      var op = OPS[ins.op], ra = 0, rb = 0, operand = 0;
      if (ins.args.length !== op.args.length) throw new Error('Line ' + ins.line + ': ' + ins.op + ' takes ' + op.args.length + ' operand' + (op.args.length === 1 ? '' : 's'));
      op.args.forEach(function (kind, k) {
        if (kind === 'r') { if (k === 0) ra = reg(ins.args[k], ins.line); else rb = reg(ins.args[k], ins.line); }
        else operand = num(ins.args[k], ins.line);
      });
      if (ins.at + 1 >= size) throw new Error('The program does not fit in ' + size + ' bytes of memory');
      bytes[ins.at] = (op.code << 4) | (ra << 2) | rb;
      bytes[ins.at + 1] = operand;
      source[ins.at] = ins.op + (ins.args.length ? ' ' + ins.args.map(function (a) { return /^r\d$/i.test(a) ? a.toUpperCase() : a; }).join(', ') : '');
    });
    return { bytes: bytes, source: source, end: at };
  };

  var decode = function (b0, b1) {
    var name = NAMES[b0 >> 4] || '???', ra = (b0 >> 2) & 3, rb = b0 & 3, op = OPS[name];
    var text = name;
    if (op && op.args.length) text += ' ' + op.args.map(function (k, i) { return k === 'r' ? 'R' + (i === 0 ? ra : rb) : k === 'imm' ? String(b1) : '[0x' + M.hex(b1, 2) + ']'; }).join(', ');
    return { name: name, ra: ra, rb: rb, operand: b1, text: text, op: op };
  };

  /**
   * opts: asm (assembly text) or bytes, data ({address: value}), size (16 or 32 bytes),
   * maxSteps (60). Returns { el, captions, states, draw(i) } for visual.steps(cpu.captions, cpu.draw).
   */
  M.cpu = function (into, opts) {
    opts = opts || {};
    var size = opts.size === 32 ? 32 : 16;
    var prog = opts.asm ? M.assemble(opts.asm, size) : { bytes: (opts.bytes || []).slice(0, size).concat(new Array(size).fill(0)).slice(0, size), source: {}, end: 0 };
    var mem = prog.bytes.slice();
    var data = opts.data || {};
    Object.keys(data).forEach(function (a) { mem[+a] = data[a] & 255; });
    var isCode = function (a) { return prog.source[a - (a % 2)] != null; };

    // ---- Run it, keeping every micro-step ----
    var s = { pc: 0, ir: [0, 0], regs: [0, 0, 0, 0], z: 0, mem: mem.slice() };
    var states = [], captions = [];
    var snap = function (extra, say) { states.push(Object.assign({ pc: s.pc, ir: s.ir.slice(), regs: s.regs.slice(), z: s.z, mem: s.mem.slice() }, extra)); captions.push(say); };
    snap({ phase: 'ready' }, 'The program is in memory as bytes, from address 0x00. The PC (program counter) holds 0x00: the address of the next instruction.');
    var max = opts.maxSteps || 60, ran = 0;
    while (ran++ < max) {
      var pc = s.pc, b0 = s.mem[pc] || 0, b1 = s.mem[pc + 1] || 0;
      s.ir = [b0, b1];
      s.pc = (pc + 2) & 255;
      snap({ phase: 'fetch', bus: { addr: pc, data: [b0, b1], dir: 'in' }, focusMem: [pc, pc + 1], hot: ['pc', 'ir'] },
        'Fetch: the PC sends 0x' + M.hex(pc, 2) + ' out on the address bus. Memory answers on the data bus with the bytes at 0x' + M.hex(pc, 2) + ' and 0x' + M.hex(pc + 1, 2) + ', ' + M.hex(b0, 2) + ' ' + M.hex(b1, 2) + ', and they land in the IR (instruction register). The PC moves on to 0x' + M.hex(s.pc, 2) + '.');
      var d = decode(b0, b1);
      snap({ phase: 'decode', decoded: d, hot: ['ir', 'cu'] },
        'Decode: the control unit splits the IR. Opcode ' + M.bin(b0 >> 4, 4) + ' means ' + d.name + (d.op && d.op.args.indexOf('r') >= 0 ? ', register bits ' + M.bin(d.ra, 2) + ' pick R' + d.ra + (d.op.args[1] === 'r' ? ' and ' + M.bin(d.rb, 2) + ' pick R' + d.rb : '') : '') + (d.op && /addr|imm/.test(d.op.args.join()) ? ', and the second byte is ' + (d.op.args.indexOf('imm') >= 0 ? 'the number ' + b1 : 'the address 0x' + M.hex(b1, 2)) : '') + '. So: ' + (d.op ? d.op.does.replace(/Ra/g, 'R' + d.ra).replace(/Rb/g, 'R' + d.rb).replace('addr', '0x' + M.hex(b1, 2)).replace('number', String(b1)) : 'an unknown instruction') + '.');
      var ex = { phase: 'execute', decoded: d }, say = '';
      if (!d.op || d.name === 'HALT') {
        snap(Object.assign(ex, { halted: true, hot: ['cu'] }), 'Execute: HALT. The CPU stops. ' + (Object.keys(prog.source).length ? 'Look at the registers and memory: that is everything the program did.' : ''));
        break;
      }
      if (d.name === 'LOADI') { s.regs[d.ra] = b1; say = 'Execute: the number ' + b1 + ' is copied into R' + d.ra + '. No memory access: the number was inside the instruction.'; ex.hot = ['r' + d.ra]; }
      else if (d.name === 'LOAD') { s.regs[d.ra] = s.mem[b1]; ex.bus = { addr: b1, data: [s.mem[b1]], dir: 'in' }; ex.focusMem = [b1]; ex.hot = ['r' + d.ra]; say = 'Execute: 0x' + M.hex(b1, 2) + ' goes out on the address bus, memory sends back ' + s.mem[b1] + ', and R' + d.ra + ' holds it now.'; }
      else if (d.name === 'STORE') { s.mem[b1] = s.regs[d.ra]; ex.bus = { addr: b1, data: [s.regs[d.ra]], dir: 'out' }; ex.focusMem = [b1]; ex.hot = ['r' + d.ra]; say = 'Execute: 0x' + M.hex(b1, 2) + ' goes out on the address bus and R' + d.ra + '’s value, ' + s.regs[d.ra] + ', on the data bus: memory at 0x' + M.hex(b1, 2) + ' now holds ' + s.regs[d.ra] + '.'; }
      else if (/^(ADD|SUB|AND|OR)$/.test(d.name)) {
        var a = s.regs[d.ra], b = s.regs[d.rb], out = d.name === 'ADD' ? (a + b) & 255 : d.name === 'SUB' ? (a - b + 256) & 255 : d.name === 'AND' ? a & b : a | b;
        var sym = { ADD: '+', SUB: '−', AND: 'AND', OR: 'OR' }[d.name];
        s.regs[d.ra] = out; s.z = out === 0 ? 1 : 0;
        ex.alu = { a: a, b: b, op: sym, out: out }; ex.hot = ['r' + d.ra, 'r' + d.rb, 'alu', 'z'];
        say = 'Execute: R' + d.ra + ' (' + a + ') and R' + d.rb + ' (' + b + ') go into the ALU, which works out ' + a + ' ' + sym + ' ' + b + ' = ' + out + (d.name === 'ADD' && a + b > 255 ? ' (it wrapped past 255)' : d.name === 'SUB' && a < b ? ' (it wrapped below 0)' : '') + '. The result goes back into R' + d.ra + '; Z is ' + s.z + ' because the result ' + (s.z ? 'is' : 'is not') + ' zero.';
      }
      else if (d.name === 'JMP') { s.pc = b1; ex.hot = ['pc']; say = 'Execute: the PC is set to 0x' + M.hex(b1, 2) + ', so the next fetch comes from there.'; }
      else if (d.name === 'JZ') { if (s.z) s.pc = b1; ex.hot = ['pc', 'z']; say = 'Execute: Z is ' + s.z + ', so ' + (s.z ? 'the PC jumps to 0x' + M.hex(b1, 2) : 'nothing changes and the PC stays at 0x' + M.hex(s.pc, 2)) + '.'; }
      snap(ex, say);
    }
    if (ran > max) { captions[captions.length - 1] += ' (Stopped here: it ran ' + max + ' instructions.)'; }

    // ---- Drawing ----
    var W = 680, rowH = size === 32 ? 19 : 34, memTop = 48, H = Math.max(420, memTop + (size / 2) * rowH + 30);
    var svg = M.svg(into, W, H, 'A tiny CPU running a program: fetch, decode, execute');
    var hotStroke = function (on) { return on ? 'var(--accent)' : 'var(--line-strong)'; };
    var box = function (x, y, w, h, on, title) {
      var g = el('g');
      g.append(el('rect', { x: x, y: y, width: w, height: h, rx: 7, fill: on ? 'var(--accent-soft)' : 'var(--bg)', stroke: hotStroke(on), 'stroke-width': on ? 2 : 1.2, style: 'transition: fill .2s ease, stroke .2s ease' }));
      if (title) g.append(el('text', { x: x + 10, y: y + 16, 'font-size': 11, 'font-weight': 600, fill: on ? 'var(--accent)' : 'var(--muted)' }, title));
      return g;
    };
    var mono = function (x, y, text, o) { o = o || {}; return el('text', { x: x, y: y, 'font-size': o.size || 13, 'font-family': 'var(--mono)', 'font-weight': o.weight || 400, fill: o.fill || 'var(--ink)', 'text-anchor': o.anchor || 'start' }, text); };

    function draw(i) {
      var st = states[Math.max(0, Math.min(states.length - 1, i))], hot = st.hot || [], prev = states[Math.max(0, i - 1)];
      var isHot = function (k) { return hot.indexOf(k) >= 0; };
      svg.replaceChildren();
      // The CPU
      svg.append(el('rect', { x: 8, y: 24, width: 384, height: H - 32, rx: 12, fill: 'var(--surface)', stroke: 'var(--line-strong)' }));
      svg.append(el('text', { x: 20, y: 42, 'font-size': 12, 'font-weight': 700, fill: 'var(--ink-soft)' }, 'CPU'));
      // PC
      var pcBox = box(24, 52, 112, 48, isHot('pc'), 'PC');
      pcBox.append(mono(34, 90, '0x' + M.hex(st.pc, 2), { size: 15, weight: 600 }));
      M.pickable(pcBox, 'the program counter (PC)', function () { return { value: '0x' + M.hex(st.pc, 2) }; });
      svg.append(pcBox);
      // IR, with its fields
      var irBox = box(150, 52, 228, 48, isHot('ir'), 'IR');
      var bitsTxt = M.bin(st.ir[0], 8), fx = 196;
      [[bitsTxt.slice(0, 4), 'op'], [bitsTxt.slice(4, 6), 'a'], [bitsTxt.slice(6, 8), 'b'], [M.bin(st.ir[1], 8), 'operand']].forEach(function (f, k) {
        irBox.append(mono(fx, 90, f[0], { size: 13, weight: 600, fill: k === 0 && st.phase === 'decode' ? 'var(--accent)' : 'var(--ink)' }));
        irBox.append(el('text', { x: fx + f[0].length * 3.9, y: 66, 'text-anchor': 'middle', 'font-size': 10, fill: 'var(--muted)' }, f[1]));
        fx += f[0].length * 7.9 + 10;
      });
      M.pickable(irBox, 'the instruction register (IR)', function () { return { bytes: M.hex(st.ir[0], 2) + ' ' + M.hex(st.ir[1], 2) }; });
      svg.append(irBox);
      // Control unit
      var cu = box(24, 114, 354, 48, isHot('cu'), 'Control unit');
      cu.append(el('text', { x: 34, y: 152, 'font-size': 13, 'font-family': 'var(--mono)', 'font-weight': 600, fill: st.decoded ? 'var(--ink)' : 'var(--muted)' }, st.decoded ? st.decoded.text : st.halted ? 'halted' : '—'));
      if (st.decoded && st.decoded.op) cu.append(el('text', { x: 368, y: 152, 'text-anchor': 'end', 'font-size': 12, fill: 'var(--muted)' }, st.decoded.op.does.replace(/Ra/g, 'R' + st.decoded.ra).replace(/Rb/g, 'R' + st.decoded.rb).replace('number', String(st.decoded.operand)).replace('addr', '0x' + M.hex(st.decoded.operand, 2))));
      svg.append(cu);
      // Registers
      svg.append(el('text', { x: 24, y: 190, 'font-size': 11, 'font-weight': 600, fill: 'var(--muted)' }, 'Registers'));
      st.regs.forEach(function (v, r) {
        var changed = prev.regs[r] !== v && i > 0;
        var g = box(24, 198 + r * 38, 166, 32, isHot('r' + r));
        g.append(mono(36, 219 + r * 38, 'R' + r, { weight: 600, fill: 'var(--ink-soft)' }));
        g.append(mono(80, 219 + r * 38, '0x' + M.hex(v, 2), { weight: changed ? 700 : 400, fill: changed ? 'var(--accent)' : 'var(--ink)' }));
        g.append(mono(178, 219 + r * 38, String(v), { anchor: 'end', fill: 'var(--muted)' }));
        M.pickable(g, 'register R' + r, { value: v, hex: '0x' + M.hex(v, 2) });
        svg.append(g);
      });
      // ALU: the V shape
      var ax = 214, ay = 198, aluOn = isHot('alu');
      var aluP = 'M' + ax + ' ' + ay + ' H' + (ax + 66) + ' L' + (ax + 82) + ' ' + (ay + 22) + ' L' + (ax + 98) + ' ' + ay + ' H' + (ax + 164) + ' L' + (ax + 124) + ' ' + (ay + 96) + ' H' + (ax + 40) + ' Z';
      var alu = el('g');
      alu.append(el('path', { d: aluP, fill: aluOn ? 'var(--accent-soft)' : 'var(--bg)', stroke: hotStroke(aluOn), 'stroke-width': aluOn ? 2 : 1.2 }));
      alu.append(el('text', { x: ax + 82, y: ay + 62, 'text-anchor': 'middle', 'font-size': 12, 'font-weight': 700, fill: aluOn ? 'var(--accent)' : 'var(--muted)' }, 'ALU'));
      if (st.alu) {
        alu.append(mono(ax + 33, ay + 18, String(st.alu.a), { anchor: 'middle', weight: 600 }));
        alu.append(mono(ax + 131, ay + 18, String(st.alu.b), { anchor: 'middle', weight: 600 }));
        alu.append(mono(ax + 82, ay + 82, st.alu.op, { anchor: 'middle', size: 12, fill: 'var(--ink-soft)' }));
        alu.append(mono(ax + 82, ay + 118, '= ' + st.alu.out, { anchor: 'middle', weight: 700, fill: 'var(--accent)' }));
      }
      M.pickable(alu, 'the ALU (arithmetic logic unit)', function () { return st.alu ? { a: st.alu.a, b: st.alu.b, op: st.alu.op, result: st.alu.out } : { idle: true }; });
      svg.append(alu);
      // Z flag
      var zb = box(254, 330, 84, 32, isHot('z'));
      zb.append(mono(266, 351, 'Z', { weight: 600, fill: 'var(--ink-soft)' }));
      zb.append(mono(326, 351, String(st.z), { anchor: 'end', weight: 600 }));
      M.pickable(zb, 'the zero flag Z', { value: st.z });
      svg.append(zb);
      // The cycle
      ['fetch', 'decode', 'execute'].forEach(function (p, k) {
        var on = st.phase === p, x = 24 + k * 118;
        svg.append(el('rect', { x: x, y: H - 46, width: 108, height: 26, rx: 13, fill: on ? 'var(--accent)' : 'var(--bg)', stroke: on ? 'var(--accent)' : 'var(--line-strong)' }));
        svg.append(el('text', { x: x + 54, y: H - 29, 'text-anchor': 'middle', 'font-size': 12, 'font-weight': 600, fill: on ? 'var(--bg)' : 'var(--muted)' }, p.charAt(0).toUpperCase() + p.slice(1)));
      });
      // Memory
      var mx = 470;
      svg.append(el('text', { x: mx, y: 40, 'font-size': 12, 'font-weight': 700, fill: 'var(--ink-soft)' }, 'Memory'));
      var focus = st.focusMem || [];
      for (var row = 0; row < size / 2; row++) {
        var a0 = row * 2, y = memTop + row * rowH, small = rowH < 24;
        svg.append(mono(mx, y + rowH / 2 + 4, '0x' + M.hex(a0, 2), { size: small ? 11 : 12, fill: 'var(--muted)' }));
        for (var k = 0; k < 2; k++) {
          var a = a0 + k, on = focus.indexOf(a) >= 0, changedM = i > 0 && prev.mem[a] !== st.mem[a];
          var c = el('g');
          c.append(el('rect', { x: mx + 38 + k * 36, y: y + 2, width: 34, height: rowH - 4, rx: 4, fill: on ? 'var(--accent-soft)' : 'var(--bg)', stroke: on ? 'var(--accent)' : 'var(--line)', 'stroke-width': on ? 2 : 1 }));
          c.append(mono(mx + 55 + k * 36, y + rowH / 2 + 4, M.hex(st.mem[a], 2), { anchor: 'middle', size: small ? 11 : 13, weight: changedM ? 700 : 400, fill: changedM ? 'var(--accent)' : st.mem[a] || isCode(a) ? 'var(--ink)' : 'var(--muted)' }));
          M.pickable(c, 'memory at 0x' + M.hex(a, 2), (function (a) { return function () { return { value: st.mem[a], hex: '0x' + M.hex(st.mem[a], 2), binary: M.bin(st.mem[a], 8) }; }; })(a));
          svg.append(c);
        }
        var note = prog.source[a0] != null ? prog.source[a0] : (st.mem[a0] || st.mem[a0 + 1] || data[a0] != null || data[a0 + 1] != null ? 'data' : '');
        if (note) svg.append(el('text', { x: mx + 116, y: y + rowH / 2 + 4, 'font-size': small ? 10 : 11, 'font-family': 'var(--mono)', fill: prog.source[a0] != null && st.pc === a0 ? 'var(--accent)' : 'var(--muted)' }, note));
        if (prog.source[a0] != null && st.pc === a0 && !st.halted) svg.append(el('path', { d: 'M' + (mx - 12) + ' ' + (y + rowH / 2 - 5) + ' l7 5 l-7 5 z', fill: 'var(--accent)' }));
      }
      // Buses
      [['address bus', 70, 'addr'], ['data bus', 118, 'data']].forEach(function (b) {
        var on = !!st.bus, y = b[1];
        svg.append(el('text', { x: 431, y: y - 9, 'text-anchor': 'middle', 'font-size': 10, fill: on ? 'var(--ink-soft)' : 'var(--muted)' }, b[0]));
        svg.append(el('line', { x1: 392, y1: y, x2: 466, y2: y, stroke: on ? 'var(--accent)' : 'var(--line-strong)', 'stroke-width': on ? 3 : 2, 'marker-end': on ? M.arrowHead(svg, 'var(--accent)') : null, 'marker-start': null }));
        if (on && b[2] === 'data' && st.bus.dir === 'in') { svg.lastChild.setAttribute('x1', 466); svg.lastChild.setAttribute('x2', 396); }
        if (on) {
          var val = b[2] === 'addr' ? '0x' + M.hex(st.bus.addr, 2) : st.bus.data.map(function (x) { return M.hex(x, 2); }).join(' ');
          var w = val.length * 7.6 + 12;
          svg.append(el('rect', { x: 431 - w / 2, y: y + 5, width: w, height: 18, rx: 9, fill: 'var(--bg)', stroke: 'var(--accent)' }));
          svg.append(mono(431, y + 18, val, { anchor: 'middle', size: 11, weight: 600, fill: 'var(--accent)' }));
        }
      });
    }
    draw(0);
    return { el: svg, captions: captions, states: states, draw: draw, assembled: prog };
  };
  M.cpu.ops = OPS;
})(window.__TideMachine);
