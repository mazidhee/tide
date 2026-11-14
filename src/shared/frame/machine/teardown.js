/* TideMachine.teardown: an exploded view. The whole assembly, then it comes apart, then each part on its own with the rest ghosted */
(function (M) {
  'use strict';

  /**
   * opts: { label, height, parts: [{ id, label, note, box, at (assembled), explode: [dx, dy, dz]
   * (how far it moves out, added to its parent's), parent, material, color, shape, glow, info,
   * say (its caption on its own) }], order: [ids] (the tour, default every labelled part),
   * intro, exploded, outro (captions), from }.
   * Steps: the whole, assembled; exploded; each part in turn, isolated; then together again.
   * Clicking a part isolates it (and Tide offers "Ask about this"); Assemble and Explode buttons.
   * Returns the scene ({ el, captions, draw, ready, … }) plus isolate(id) and explode(on).
   */
  M.teardown = function (into, opts) {
    opts = opts || {};
    var defs = opts.parts || [];
    var byId = {};
    defs.forEach(function (p) { byId[p.id] = p; });
    var offset = function (p) {
      var o = [0, 0, 0], q = p;
      while (q) { var e = q.explode || [0, 0, 0]; o = [o[0] + e[0], o[1] + e[1], o[2] + e[2]]; q = byId[q.parent]; }
      return o;
    };
    var home = {}, out = {};
    defs.forEach(function (p) {
      home[p.id] = p.at.slice();
      var o = offset(p);
      out[p.id] = [p.at[0] + o[0], p.at[1] + o[1], p.at[2] + o[2]];
    });
    var under = function (id) {
      var all = [id];
      defs.forEach(function (p) { var q = p; while (q && q.parent) { if (q.parent === id) { all.push(p.id); break; } q = byId[q.parent]; } });
      return all;
    };
    var order = opts.order || defs.filter(function (p) { return p.label; }).map(function (p) { return p.id; });
    var all = defs.map(function (p) { return p.id; });
    var plan = [{ say: opts.intro || ((opts.label || 'The whole thing') + ', assembled. Drag to turn it; click any part to take it out.'), exploded: false, focus: null, fit: all }];
    plan.push({ say: opts.exploded || 'Taken apart: each part moves out along the way it fits in.', exploded: true, focus: null, fit: all });
    order.forEach(function (id) {
      var p = byId[id];
      if (!p) return;
      plan.push({ say: p.say || (p.label + (p.note ? ': ' + p.note : '') + '.'), exploded: true, focus: under(id), fit: under(id), labels: [id] });
    });
    plan.push({ say: opts.outro || 'Back together: every part you saw has its place in the whole.', exploded: false, focus: null, fit: all });

    var exploded = false;
    var place = function (on, ms) {
      exploded = on;
      var t = {};
      defs.forEach(function (p) { t[p.id] = (on ? out : home)[p.id]; });
      s.move(t, ms == null ? 900 : ms);
    };
    // Parts start assembled; the scene frames each step from where its parts are going
    var s = M.scene(into, {
      label: opts.label || 'An exploded view',
      height: opts.height,
      ghost: opts.ghost != null ? opts.ghost : 0.1,
      parts: defs.map(function (p) { return Object.assign({ labelled: 'focus' }, p, { at: home[p.id].slice() }); }),
      lines: opts.lines,
      steps: plan.map(function (st) { return { say: st.say, focus: st.focus, fit: st.fit, labels: st.labels, from: opts.from } }),
      onPick: function (p) { if (byId[p.id]) api.isolate(p.id); },
      chips: opts.chips
    });
    var draw = s.draw;
    var api = Object.assign({}, s, {
      draw: function (i) {
        var st = plan[Math.max(0, Math.min(plan.length - 1, i))];
        // Move first, so the camera frames the parts where they end up
        place(st.exploded);
        return draw(i);
      },
      isolate: function (id) {
        if (!exploded) place(true);
        s.look({ focus: under(id), fit: under(id), labels: [id], from: opts.from });
        M.report('took out ' + (byId[id].label || id), { part: byId[id].label || id });
      },
      explode: function (on) { place(!!on); s.look({ focus: null, fit: all, from: opts.from }); }
    });
    M.buttons(s.el.parentNode, [
      { label: 'Assemble', run: function () { api.explode(false); M.report('put it back together'); } },
      { label: 'Explode', run: function () { api.explode(true); M.report('took it apart'); } }
    ]);
    api.captions = plan.map(function (st) { return st.say; });
    return api;
  };
})(window.__TideMachine);
