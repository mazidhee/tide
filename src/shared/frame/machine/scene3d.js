/* TideMachine.scene: three.js scenes with orbit, labels, focus and steps; die and gpu are built on it */
(function (M) {
  'use strict';

  // A CSS colour as three.js reads it (canvas normalises rgb(), color(srgb …), names)
  var probe = null;
  var css = function (name, fallback) {
    var v = /^#|^rgb/.test(name) ? name : M.color(name.replace(/^--/, '')) || fallback || '#888';
    probe = probe || document.createElement('canvas').getContext('2d');
    probe.fillStyle = '#888';
    probe.fillStyle = v;
    return probe.fillStyle;
  };
  var three = function () {
    if (window.THREE && window.THREE.OrbitControls) return Promise.resolve(window.THREE);
    if (window.TideMath) return window.TideMath.three();
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = '/lib/three.js';
      s.onload = function () { resolve(window.THREE); };
      s.onerror = function () { reject(new Error('Tide could not load three.js')); };
      document.head.appendChild(s);
    });
  };
  M.three = three;

  /**
   * A 3D scene in its own box. opts: height (380), label, camera ([x, y, z]), target ([x, y, z]),
   * parts ([{ id, label, box: [w, h, d], at: [x, y, z], color: 'c1' | 'surface' | …, info: {…},
   * hidden, labelled: 'focus' | 'always' | 'never', opacity }]), lines ([{ id, points: [[x,y,z]…],
   * color, hidden }]), steps ([{ say, focus: [ids], labels: [ids], show: [ids], lit: [ids],
   * fit: [ids] (the camera frames these parts), from: [x, y, z] (the direction it looks from),
   * view: { camera, target } (or exactly this) }]), chips (true: a button per labelled part, below).
   * Returns at once { el, captions, draw(i), set(id, {lit, color, label, note, hidden, at, box}),
   * add(id, object3D, {label, note, info, group}), ready (a promise of { THREE, scene, camera,
   * render, part(id) }) }: use visual.steps(s.captions, s.draw) straight away; drawing waits for
   * three.js. A step is drawn at once (no glide) while Tide checks the visual (visual.auditing).
   */
  M.scene = function (into, opts) {
    opts = opts || {};
    var H = opts.height || 380;
    var wrap = M.h('div', { style: 'position:relative;width:100%;height:' + H + 'px;border-radius:10px;overflow:hidden;background:var(--bg);box-shadow:inset 0 0 0 1px var(--line)' });
    wrap.setAttribute('role', 'img');
    wrap.setAttribute('aria-label', (opts.label || 'A 3D scene') + '. Drag to turn it, scroll to zoom; with the keyboard, Q and E turn it, W and S tilt it, + and − zoom.');
    var labelsLayer = M.h('div', { style: 'position:absolute;inset:0;pointer-events:none' });
    var hint = M.h('div', { style: 'position:absolute;right:10px;bottom:8px;font-size:11px;color:var(--muted);pointer-events:none' }, 'Drag to turn · scroll to zoom');
    wrap.append(labelsLayer, hint);
    var host = M.host(into);
    host.append(wrap);
    var steps = opts.steps || [{ say: opts.label || '', focus: null }];
    var parts = opts.parts || [], lines = opts.lines || [];
    var want = 0, T = null, scene, camera, renderer, controls, byId = {}, labels = {}, focusSet = null, shown = {}, raf = 0, tween = null;
    var chipsBar = null;
    var selected = null, curLabels = null, stepLit = null;

    var info = function (p) { return Object.assign({ part: p.label || p.id }, p.info || {}); };
    /** Objects added with add(): faded with the rest, labelled and picked like parts */
    var custom = [];
    var pending = [];
    var pick = function (p) {
      if (!p) return;
      selected = p.id;
      if (window.visual) window.visual.select(p.label || p.id, p.info || {});
      paint();
    };

    var paint = function () {
      if (!T) return;
      var acc = css('accent');
      parts.forEach(function (p) {
        var o = byId[p.id];
        if (!o) return;
        var vis = !p.hidden || shown[p.id];
        o.mesh.visible = o.edges.visible = vis;
        var on = !focusSet || focusSet.indexOf(p.id) >= 0 || (p.group && focusSet.indexOf(p.group) >= 0);
        var base = css(p.color || 'surface');
        var isLit = p.lit || (stepLit && stepLit.indexOf(p.id) >= 0);
        o.mesh.material.color.set(isLit && on ? acc : base);
        o.mesh.material.opacity = on ? (p.opacity != null ? p.opacity : 1) : 0.16;
        o.mesh.material.transparent = o.mesh.material.opacity < 1;
        o.mesh.material.depthWrite = o.mesh.material.opacity >= 0.5;
        o.edges.material.color.set(selected === p.id || (on && focusSet) ? acc : css('line-strong'));
        o.edges.material.opacity = on ? 0.9 : 0.2;
        var lab = labels[p.id];
        var named = curLabels ? curLabels.indexOf(p.id) >= 0 : p.labelled !== 'never' && on && !!focusSet;
        if (lab) lab.style.display = vis && (p.labelled === 'always' || named) ? 'block' : 'none';
      });
      lines.forEach(function (l) {
        var o = byId[l.id];
        if (!o) return;
        o.visible = !l.hidden || !!shown[l.id];
        o.material.color.set(css(l.color || 'accent'));
      });
      custom.forEach(function (c) {
        var on = !focusSet || focusSet.indexOf(c.id) >= 0 || (c.group && focusSet.indexOf(c.group) >= 0);
        c.obj.visible = !c.hidden || !!shown[c.id];
        c.obj.traverse(function (o) {
          if (!o.material) return;
          (Array.isArray(o.material) ? o.material : [o.material]).forEach(function (m) {
            if (m.userData.base == null) m.userData.base = m.opacity;
            m.transparent = true;
            m.opacity = on ? m.userData.base : Math.min(m.userData.base, 0.16);
            m.depthWrite = m.opacity >= 0.5;
          });
        });
        var lab = labels[c.id];
        var named = curLabels ? curLabels.indexOf(c.id) >= 0 : c.labelled !== 'never' && on && focusSet && focusSet.indexOf(c.id) >= 0;
        if (lab) lab.style.display = c.obj.visible && (c.labelled === 'always' || named) ? 'block' : 'none';
      });
      render();
    };
    /** Where a part's or an object's label hangs: above its top centre */
    var anchorOf = function (id) {
      var p = parts.filter(function (q) { return q.id === id; })[0];
      if (p) return new T.Vector3(p.at[0], p.at[1] + p.box[1] / 2 + (p.labelLift || 0.25), p.at[2]);
      var c = custom.filter(function (q) { return q.id === id; })[0];
      if (!c) return null;
      var b = new T.Box3().setFromObject(c.obj), mid = b.getCenter(new T.Vector3());
      return new T.Vector3(mid.x, b.max.y + 0.25, mid.z);
    };
    var place = function () {
      var W = wrap.clientWidth, Hh = wrap.clientHeight, boxes = [];
      Object.keys(labels).forEach(function (id) {
        var lab = labels[id];
        if (lab.style.display === 'none') return;
        var a = anchorOf(id);
        if (!a) return;
        var v = a.project(camera);
        var x = (v.x + 1) / 2 * W, y = (1 - v.y) / 2 * Hh;
        // Behind the camera or off the canvas: not shown, rather than half shown
        if (v.z > 1 || x < 0 || x > W || y < 8 || y > Hh) { lab.style.visibility = 'hidden'; return; }
        lab.style.visibility = 'visible';
        var w = lab.offsetWidth, h = lab.offsetHeight;
        var left = Math.max(4, Math.min(W - w - 4, x - w / 2)), top = y - h - 4;
        // Labels that would overlap: the later one moves up, or below its part when there's no room above
        for (var tries = 0; tries < 8; tries++) {
          var hit = boxes.some(function (o) { return left < o.right + 3 && left + w > o.left - 3 && top < o.bottom + 2 && top + h > o.top - 2; });
          if (!hit) break;
          top -= h + 4;
        }
        if (top < 4) { lab.style.visibility = 'hidden'; return; }
        lab.style.transform = 'translate(' + Math.round(left) + 'px,' + Math.round(top) + 'px)';
        boxes.push({ left: left, right: left + w, top: top, bottom: top + h });
      });
    };
    var render = function () { if (renderer) { renderer.render(scene, camera); place(); } };

    var moveTo = function (view, instant) {
      if (!view || !camera) return;
      var fromC = camera.position.clone(), fromT = controls.target.clone();
      var toC = new T.Vector3().fromArray(view.camera || camera.position.toArray()), toT = new T.Vector3().fromArray(view.target || controls.target.toArray());
      cancelAnimationFrame(tween);
      if (instant || M.reduced()) { camera.position.copy(toC); controls.target.copy(toT); controls.update(); return render(); }
      var t0 = performance.now();
      var tick = function (now) {
        var k = Math.min(1, (now - t0) / 650), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        camera.position.lerpVectors(fromC, toC, e);
        controls.target.lerpVectors(fromT, toT, e);
        controls.update();
        render();
        if (k < 1) tween = requestAnimationFrame(tick);
      };
      tween = requestAnimationFrame(tick);
    };

    /** A view that frames these parts (or objects), looking from a direction */
    var fitView = function (ids, from) {
      var box = new T.Box3(), any = false;
      // A group's name stands for its members
      ids = [].concat.apply([], ids.map(function (id) {
        var members = parts.concat(custom).filter(function (p) { return p.group === id; }).map(function (p) { return p.id; });
        return members.length ? members : [id];
      }));
      ids.forEach(function (id) {
        var o = byId[id] && byId[id].mesh || (custom.filter(function (c) { return c.id === id; })[0] || {}).obj;
        if (!o) return;
        box.expandByObject(o);
        any = true;
      });
      if (!any) return null;
      var center = box.getCenter(new T.Vector3());
      var dir = new T.Vector3().fromArray(from || [0.55, 0.85, 1]).normalize();
      // Move the camera along its direction until the box's corners fill about 85% of the view
      var cam = camera.clone(), corners = [], d = box.getSize(new T.Vector3()).length() || 4;
      for (var c = 0; c < 8; c++) corners.push(new T.Vector3(c & 1 ? box.max.x : box.min.x, c & 2 ? box.max.y : box.min.y, c & 4 ? box.max.z : box.min.z));
      for (var k = 0; k < 6; k++) {
        cam.position.copy(center).addScaledVector(dir, d);
        cam.lookAt(center);
        cam.updateMatrixWorld();
        var most = 0;
        corners.forEach(function (q) { var v = q.clone().project(cam); most = Math.max(most, Math.abs(v.x), Math.abs(v.y)); });
        if (!isFinite(most) || most <= 0) break;
        d *= most / 0.85;
      }
      return { camera: center.clone().addScaledVector(dir, Math.max(d, 3)).toArray(), target: center.toArray() };
    };
    var auditing = function () { return !!(window.visual && window.visual.auditing); };

    var apply = function (i, quiet) {
      var st = steps[i] || {};
      focusSet = st.focus || null;
      curLabels = st.labels || null;
      shown = {};
      (st.show || []).forEach(function (id) { shown[id] = 1; });
      stepLit = st.lit || null;
      paint();
      var view = st.fit ? fitView(st.fit, st.from) : st.view;
      if (view && !quiet) moveTo(view, auditing());
    };

    var makeLabel = function (p) {
      var lab = labels[p.id] || M.h('div', { style: 'position:absolute;left:0;top:0;width:max-content;max-width:260px;white-space:normal;font-size:12px;line-height:1.3;padding:3px 7px;border-radius:6px;background:var(--bg);color:var(--ink);box-shadow:0 0 0 1px var(--line-strong);display:none' });
      lab.textContent = p.label;
      if (p.note) lab.append(M.h('span', { style: 'color:var(--muted);margin-left:6px' }, p.note));
      if (!labels[p.id]) labelsLayer.append(lab);
      labels[p.id] = lab;
    };
    var addNow = function (c) {
      c.obj.userData.part = c;
      scene.add(c.obj);
      if (c.label && c.labelled !== 'never') makeLabel(c);
    };

    var ready = three().then(function (THREE) {
      T = THREE;
      scene = new T.Scene();
      camera = new T.PerspectiveCamera(opts.fov || 35, 1, 0.1, 400);
      camera.position.fromArray(opts.camera || [14, 14, 18]);
      renderer = new T.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      var canvas = renderer.domElement;
      canvas.style.cssText = 'display:block;width:100%;height:100%;outline:none';
      canvas.tabIndex = 0;
      wrap.insertBefore(canvas, labelsLayer);
      var size = function () { var w = wrap.clientWidth || 640; renderer.setSize(w, H, false); camera.aspect = w / H; camera.updateProjectionMatrix(); render(); };
      scene.add(new T.HemisphereLight(0xffffff, 0x8a8a8a, 1.6));
      var sun = new T.DirectionalLight(0xffffff, 1.5);
      sun.position.set(-8, 18, 10);
      scene.add(sun);
      controls = new T.OrbitControls(camera, canvas);
      controls.target.fromArray(opts.target || [0, 0, 0]);
      controls.maxPolarAngle = Math.PI * 0.47;
      controls.minDistance = 3;
      controls.maxDistance = 80;
      controls.addEventListener('change', render);
      controls.update();
      parts.forEach(function (p) {
        // box [w, h, d]; cylinder [radius, height]; sphere [radius]: p.box is the size either way
        var g = p.shape === 'cylinder' ? new T.CylinderGeometry(p.box[0], p.box[0], p.box[1], 32) : p.shape === 'sphere' ? new T.SphereGeometry(p.box[0], 32, 16) : new T.BoxGeometry(p.box[0], p.box[1], p.box[2]);
        if (p.shape === 'sphere') p.box = [p.box[0] * 2, p.box[0] * 2, p.box[0] * 2];
        if (p.shape === 'cylinder') p.box = [p.box[0] * 2, p.box[1], p.box[0] * 2];
        var mesh = new T.Mesh(g, new T.MeshStandardMaterial({ color: css(p.color || 'surface'), roughness: 0.62, metalness: 0.08, transparent: true }));
        mesh.position.fromArray(p.at);
        if (p.rot) mesh.rotation.set(p.rot[0] || 0, p.rot[1] || 0, p.rot[2] || 0);
        mesh.userData.part = p;
        var edges = new T.LineSegments(new T.EdgesGeometry(g), new T.LineBasicMaterial({ color: css('line-strong'), transparent: true }));
        edges.position.copy(mesh.position);
        edges.rotation.copy(mesh.rotation);
        scene.add(mesh, edges);
        byId[p.id] = { mesh: mesh, edges: edges };
        if (p.label && p.labelled !== 'never') makeLabel(p);
      });
      lines.forEach(function (l) {
        var pts = l.points.map(function (q) { return new T.Vector3().fromArray(q); });
        // A tube, not a line: WebGL draws lines one pixel wide whatever is asked
        var path = new T.CurvePath();
        for (var k = 1; k < pts.length; k++) path.add(new T.LineCurve3(pts[k - 1], pts[k]));
        var line = new T.Mesh(new T.TubeGeometry(path, 24 * pts.length, l.radius || 0.09, 8, false), new T.MeshBasicMaterial({ color: css(l.color || 'accent') }));
        scene.add(line);
        byId[l.id] = line;
      });
      // Picking a part (or an added object)
      var ray = new T.Raycaster(), down = null;
      canvas.addEventListener('pointerdown', function (e) { down = [e.clientX, e.clientY]; });
      canvas.addEventListener('pointerup', function (e) {
        if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
        var r = canvas.getBoundingClientRect();
        ray.setFromCamera(new T.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
        var hits = ray.intersectObjects(parts.map(function (p) { return byId[p.id].mesh; }).filter(function (m) { return m.visible && m.material.opacity > 0.3; }).concat(custom.filter(function (c) { return c.obj.visible; }).map(function (c) { return c.obj; })), true);
        for (var h = 0; h < hits.length; h++) {
          var o = hits[h].object;
          while (o && !o.userData.part) o = o.parent;
          if (o && o.userData.part) return pick(o.userData.part);
        }
      });
      // Keys: turn, tilt and zoom about the target
      canvas.addEventListener('keydown', function (e) {
        var k = e.key.toLowerCase(), off = camera.position.clone().sub(controls.target), sph = new T.Spherical().setFromVector3(off);
        if (k === 'q') sph.theta -= 0.15; else if (k === 'e') sph.theta += 0.15;
        else if (k === 'w') sph.phi = Math.max(0.15, sph.phi - 0.1); else if (k === 's') sph.phi = Math.min(Math.PI * 0.47, sph.phi + 0.1);
        else if (k === '+' || k === '=') sph.radius = Math.max(3, sph.radius * 0.88); else if (k === '-' || k === '_') sph.radius = Math.min(80, sph.radius * 1.12);
        else return;
        e.preventDefault();
        camera.position.copy(controls.target).add(new T.Vector3().setFromSpherical(sph));
        controls.update();
        render();
      });
      if (opts.chips !== false) {
        chipsBar = M.h('div', { style: 'display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 0' });
        var seenLabel = {};
        // A button per part to pick it from the keyboard; past ten, only the ones marked chip: true
        var chipped = parts.filter(function (p) { return p.label && p.chip !== false; });
        if (chipped.length > 10) chipped = chipped.filter(function (p) { return p.chip === true; });
        chipped.forEach(function (p) {
          if (seenLabel[p.label]) return;
          seenLabel[p.label] = 1;
          var b = M.h('button', { type: 'button', 'aria-label': 'Select ' + p.label }, p.label);
          b.addEventListener('click', function () { pick(p); });
          chipsBar.append(b);
        });
        wrap.after(chipsBar);
      }
      new ResizeObserver(size).observe(wrap);
      size();
      apply(want, true);
      custom.forEach(function (c) { addNow(c); });
      pending.forEach(function (f) { f(); });
      pending = [];
      var s = steps[want] || {};
      var first = s.fit ? fitView(s.fit, s.from) : s.view;
      if (!first) render();
      else moveTo(first, true);
      if (window.visual) window.visual.onTheme(function () { paint(); });
      return { THREE: T, scene: scene, camera: camera, controls: controls, renderer: renderer, part: function (id) { return byId[id] || (custom.filter(function (c) { return c.id === id; })[0] || {}).obj; }, render: render, fitView: fitView };
    });
    ready.catch(function (e) { wrap.append(M.h('p', { style: 'position:absolute;inset:auto 12px 12px;color:var(--bad)' }, String(e && e.message || e))); });

    return {
      el: wrap,
      captions: steps.map(function (s) { return s.say || ''; }),
      ready: ready,
      draw: function (i) { want = Math.max(0, Math.min(steps.length - 1, i)); if (T) apply(want); return steps[want] && steps[want].say; },
      /** Changes a part (lit, color, label, note, hidden, at, box) and redraws: what a control the learner moves calls */
      set: function (id, props) {
        var run = function () {
          var p = parts.filter(function (q) { return q.id === id; })[0] || custom.filter(function (q) { return q.id === id; })[0];
          if (!p) return;
          Object.assign(p, props);
          var o = byId[id];
          if (o && props.at) { o.mesh.position.fromArray(p.at); o.edges.position.copy(o.mesh.position); }
          if (o && props.box && !p.shape) { o.mesh.scale.set(p.box[0] / o.mesh.geometry.parameters.width, p.box[1] / o.mesh.geometry.parameters.height, p.box[2] / o.mesh.geometry.parameters.depth); o.edges.scale.copy(o.mesh.scale); }
          if (props.label != null || props.note != null) makeLabel(p);
          paint();
        };
        if (T) run(); else pending.push(run);
      },
      /** Adds a three.js object of your own (made with the THREE from ready): labelled, faded, framed and picked like a part */
      add: function (id, obj, o) {
        var c = Object.assign({ id: id, obj: obj }, o || {});
        custom.push(c);
        if (scene) { addNow(c); paint(); }
        return obj;
      }
    };
  };

  // ---------- A CPU die ----------

  /**
   * A CPU package from above: cores, each with its L1 and L2, a shared L3, the memory
   * controller, and DRAM beside it; steps walk down the memory hierarchy. opts: cores (4: 2, 4 or
   * 8), height. Sizes and latencies are typical of a recent desktop CPU and said as ranges.
   */
  M.die = function (into, opts) {
    opts = opts || {};
    var n = [2, 4, 8].indexOf(opts.cores) >= 0 ? opts.cores : 4;
    var perRow = n / 2, span = 9.2, cw = span / perRow - 0.3;
    var parts = [
      { id: 'package', label: 'Package', box: [16, 0.5, 14], at: [0, 0, 0], color: 'ink-soft', chip: false, labelled: 'never', info: { what: 'the substrate the die sits on, wired to the motherboard' } },
      { id: 'die', label: 'Silicon die', box: [11, 0.3, 11], at: [-1.5, 0.4, 0], color: 'surface', labelled: 'focus', info: { size: 'about 1 to 2 cm across', transistors: 'billions' } },
      { id: 'l3', label: 'L3 cache', note: 'shared · tens of MB · ~40–70 cycles', box: [span, 0.38, 1.4], at: [-1.6, 0.74, 0], color: 'c4', group: 'cache', info: { size: '8 to 64 MB, shared by all cores', latency: 'about 40 to 70 cycles', holds: '64-byte lines' } },
      { id: 'mc', label: 'Memory controller', box: [0.9, 0.42, 9.4], at: [3.55, 0.76, 0], color: 'muted', info: { does: 'turns a cache miss into DRAM row and column commands' } },
      { id: 'dram0', label: 'DRAM', note: 'GBs · ~80–100 ns ≈ 300 cycles', box: [0.5, 3.2, 11], at: [8.6, 1.85, -1.1], color: 'muted', info: { size: '8 to 64 GB', latency: 'about 80 to 100 ns, some 300 cycles at 3.5 GHz', where: 'off the die, on DIMMs' } },
      { id: 'dram1', label: 'DRAM stick 2', box: [0.5, 3.2, 11], at: [9.6, 1.85, -1.1], color: 'muted', labelled: 'never', chip: false, info: { size: 'a second channel' } }
    ];
    for (var i = 0; i < n; i++) {
      var row = i < perRow ? -1 : 1, col = i % perRow;
      var x0 = -1.6 - span / 2 + 0.15 + col * (span / perRow) + cw / 2;
      var zCore = row * 3.55, zL2 = row * 1.45, zL1 = row * 2.5;
      var first = i === 0;
      parts.push(
        { id: 'core' + i, label: 'Core ' + i, box: [cw, 0.62, 2.0], at: [x0, 0.86, zCore], color: 'c1', group: 'cores', info: { does: 'fetches, decodes and executes instructions', registers: 'its own' } },
        { id: 'l1_' + i, label: first ? 'L1 cache' : 'L1 of core ' + i, note: first ? 'per core · 32–64 KB · ~4 cycles' : '', box: [cw, 0.5, 0.55], at: [x0, 0.8, zL1], color: 'c2', group: 'l1', labelled: first ? 'focus' : 'never', chip: first, info: { size: '32 to 64 KB of data (and as much for instructions)', latency: 'about 4 cycles, about 1 ns' } },
        { id: 'l2_' + i, label: first ? 'L2 cache' : 'L2 of core ' + i, note: first ? 'per core · 1–2 MB · ~12–16 cycles' : '', box: [cw, 0.46, 0.9], at: [x0, 0.78, zL2], color: 'c3', group: 'l2', labelled: first ? 'focus' : 'never', chip: first, info: { size: '1 to 2 MB per core', latency: 'about 12 to 16 cycles' } }
      );
    }
    var ids = function (g) { return parts.filter(function (p) { return p.group === g; }).map(function (p) { return p.id; }); };
    var all = parts.map(function (p) { return p.id; });
    var c0 = parts.filter(function (p) { return p.id === 'core0'; })[0].at[0];
    var lines = [{ id: 'miss', hidden: true, color: 'accent', points: [[c0, 1.4, -3.55], [c0, 1.3, -2.5], [c0, 1.25, -1.45], [c0, 1.2, 0], [3.55, 1.2, 0], [8.6, 3.6, 0]] }];
    var top = { camera: [0, 26, 9], target: [0, 0, 0] };
    var steps = [
      { say: 'A CPU package. The silicon die on top holds ' + n + ' cores and their caches; DRAM, the main memory, sits outside it. Drag to turn it; pick a part to ask about it.', focus: null, labels: ['core0', 'l3', 'dram0', 'mc'], view: { camera: [12, 15, 17], target: [0, 0, 0] } },
      { say: 'The cores: each fetches, decodes and executes its own stream of instructions, with its own registers. A register is read in under a cycle.', focus: ids('cores').concat(['die']), view: top },
      { say: 'L1 cache, beside each core: 32 to 64 KB of data, read in about 4 cycles (about 1 ns). Most loads are served here.', focus: ids('l1'), view: { camera: [-2, 12, 8], target: [-1.6, 0, -2.5] } },
      { say: 'L2 cache, one per core: 1 to 2 MB, about 12 to 16 cycles. Bigger means slower: the signal has further to go, and there are more entries to search.', focus: ids('l2'), view: { camera: [-2, 13, 9], target: [-1.6, 0, -1] } },
      { say: 'L3 cache, shared by every core: tens of MB, about 40 to 70 cycles. Data moves between levels in 64-byte lines, never single bytes.', focus: ['l3'], view: top },
      { say: 'DRAM, through the memory controller: gigabytes, but some 80 to 100 ns away, about 300 cycles. A miss in every cache waits that long.', focus: ['mc', 'dram0', 'dram1'], view: { camera: [16, 12, 14], target: [5, 1, 0] } },
      { say: 'One load that misses everywhere: core 0 asks L1, then L2, then L3, then the memory controller fetches the line from DRAM. Each level is about 3 to 10 times slower than the one before.', focus: ['core0', 'l1_0', 'l2_0', 'l3', 'mc', 'dram0'], labels: ['core0', 'l3', 'dram0'], show: ['miss'], view: { camera: [2, 20, 15], target: [1.5, 0, -0.5] } }
    ];
    void all;
    return M.scene(into, { label: 'A CPU die with ' + n + ' cores, its caches and DRAM', parts: parts, lines: lines, steps: steps, height: opts.height || 400, camera: [12, 15, 17] });
  };

  // ---------- A GPU ----------

  /**
   * A GPU: streaming multiprocessors (SMs) around a shared L2, HBM stacks beside the die, and one SM
   * opened up: four partitions, each issuing a warp of 32 threads. opts: sms (8 drawn), height.
   * Figures are an NVIDIA H100's (SXM) and are said as such.
   */
  M.gpu = function (into, opts) {
    opts = opts || {};
    var sms = Math.max(4, Math.min(16, opts.sms || 8)), perRow = sms / 2;
    var parts = [
      { id: 'interposer', label: 'Interposer', box: [22, 0.4, 14], at: [0, 0, 0], color: 'line-strong', labelled: 'never', chip: false },
      { id: 'die', label: 'GPU die', box: [13, 0.3, 11], at: [0, 0.35, 0], color: 'surface', labelled: 'never', chip: false },
      { id: 'l2', label: 'L2 cache', note: '50 MB on an H100, shared by every SM', box: [12, 0.4, 1.4], at: [0, 0.7, 0], color: 'c4', info: { size: '50 MB on an H100', shared: 'by all SMs' } }
    ];
    for (var h = 0; h < 4; h++) parts.push({ id: 'hbm' + h, label: h === 0 ? 'HBM' : 'HBM stack ' + (h + 1), note: h === 0 ? '80 GB · ~3.35 TB/s on an H100' : '', box: [2.4, 1.4, 4.6], at: [h < 2 ? -8.6 : 8.6, 0.9, h % 2 ? 2.6 : -2.6], color: 'muted', group: 'hbm', labelled: h === 0 ? 'focus' : 'never', chip: h === 0, info: { what: 'stacked DRAM beside the die', total: '80 GB, about 3.35 TB/s on an H100 SXM' } });
    var smW = 12 / perRow - 0.35;
    for (var i = 0; i < sms; i++) {
      var row = i < perRow ? -1 : 1, col = i % perRow, x = -6 + 0.17 + col * (12 / perRow) + smW / 2;
      parts.push({ id: 'sm' + i, label: i === 0 ? 'SM 0' : 'SM ' + i, box: [smW, 0.6, 3.6], at: [x, 0.8, row * 3.2], color: 'c1', group: 'sms', labelled: i === 0 ? 'focus' : 'never', chip: i === 0, info: { what: 'a streaming multiprocessor', has: '4 partitions, 64K 32-bit registers, up to 256 KB of L1 and shared memory' } });
    }
    // SM 0, opened: four partitions with a warp scheduler and 32 lanes each, above the die
    var sx = parts.filter(function (p) { return p.id === 'sm0'; })[0].at[0], base = 4.2;
    var lanes = [];
    for (var q = 0; q < 4; q++) {
      var px = sx - 3 + q * 2.0;
      parts.push({ id: 'part' + q, label: q === 0 ? 'Partition' : 'Partition ' + q, note: q === 0 ? 'a warp scheduler + 32 lanes' : '', box: [1.8, 0.2, 3.4], at: [px, base, -3.2], color: 'surface', hidden: true, group: 'parts', labelled: q === 0 ? 'focus' : 'never', chip: false, info: { has: 'one warp scheduler, which issues one warp instruction per clock' } });
      parts.push({ id: 'sched' + q, label: q === 0 ? 'Warp scheduler' : 'Scheduler ' + q, box: [1.6, 0.3, 0.5], at: [px, base + 0.25, -4.55], color: 'c3', hidden: true, group: 'parts', labelled: q === 0 ? 'focus' : 'never', chip: false, info: { does: 'picks a warp that is ready and issues its next instruction' } });
      for (var t = 0; t < 32; t++) {
        var id = 'lane' + q + '_' + t;
        parts.push({ id: id, label: q === 0 && t === 0 ? 'Thread (lane)' : '', box: [0.3, 0.3, 0.3], at: [px - 0.6 + (t % 4) * 0.4, base + 0.27, -3.9 + Math.floor(t / 4) * 0.36], color: 'line-strong', hidden: true, group: 'lanes' + q, labelled: q === 0 && t === 0 ? 'focus' : 'never', chip: false, info: { lane: t, warp: 'partition ' + q } });
        lanes.push(id);
      }
    }
    var ids = function (g) { return parts.filter(function (p) { return p.group === g; }).map(function (p) { return p.id; }); };
    var opened = ids('parts').concat(lanes);
    var warp0 = ids('lanes0');
    var half = warp0.filter(function (_, k) { return k % 2 === 0; });
    var close = { camera: [sx + 2.5, 13, 6.5], target: [sx + 0.6, base - 0.5, -3.2] };
    var steps = [
      { say: 'A GPU: many small processors, the streaming multiprocessors (SMs), around a shared L2 cache, with HBM memory stacked beside the die. An H100 has 132 SMs; ' + sms + ' are drawn.', focus: null, view: { camera: [14, 16, 18], target: [0, 0, 0] } },
      { say: 'The SMs. A kernel launch splits the work into blocks of threads; each block runs on one SM, and an SM holds several blocks at once.', focus: ids('sms'), view: { camera: [0, 22, 10], target: [0, 0, 0] } },
      { say: 'SM 0, opened. It has 4 partitions; each has a warp scheduler and 32 lanes. A warp is 32 threads that run the same instruction together.', focus: ['sm0'].concat(opened), show: opened, view: close },
      { say: 'One warp issues one instruction: all 32 lanes of partition 0 add their own pair of numbers in the same clock. The other partitions run other warps at the same time.', focus: ['sm0'].concat(opened), show: opened, lit: warp0.concat(ids('lanes1').slice(0, 32), ids('lanes2'), ids('lanes3')), view: close },
      { say: 'Divergence: if half the threads take an if and half the else, the warp runs both paths in turn, with half its lanes idle each time. Branches that split a warp cost time.', focus: ['sm0'].concat(opened), show: opened, lit: half, view: close },
      { say: 'Waiting on memory: when a warp loads from HBM it waits hundreds of cycles, so the scheduler switches to another ready warp at no cost. Many warps per SM hide the wait.', focus: ['sm0', 'l2'].concat(ids('hbm')), show: [], view: { camera: [-10, 16, 14], target: [-3, 0, 0] } },
      { say: 'The L2 (50 MB on an H100) is shared by every SM; HBM beside the die holds 80 GB and moves about 3.35 TB/s. Even so, keeping data in registers and shared memory is what makes kernels fast.', focus: ['l2'].concat(ids('hbm')), view: { camera: [0, 18, 16], target: [0, 0, 0] } }
    ];
    return M.scene(into, { label: 'A GPU with ' + sms + ' SMs, its L2 and HBM', parts: parts, steps: steps, height: opts.height || 400, camera: [14, 16, 18] });
  };
})(window.__TideMachine);
