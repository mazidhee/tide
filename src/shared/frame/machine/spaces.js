/* TideMachine.surface and TideMachine.space: manipulable 3D spaces for maths and ML */
(function (M) {
  'use strict';

  var fnOf = function (f, vars) {
    if (typeof f === 'function') return f;
    if (window.TideMath) {
      var p = window.TideMath.parse(String(f), vars);
      if (!p.ok) throw new Error('TideMachine: ' + p.error + ' in ' + f);
      return function (x, y, z) { return p.f({ x: x, y: y, z: z }); };
    }
    throw new Error('TideMachine: give f as a function');
  };
  var fmt = function (v, d) { return window.TideMath ? window.TideMath.fmt(v, d == null ? 2 : d) : v.toFixed(d == null ? 2 : d); };

  /**
   * A surface z = f(x, y) to turn and probe: a point (sliders move it) with its tangent plane and
   * gradient, and, for a loss landscape, an optimiser's path down it.
   * opts: { f: 'x^2 - y^2' | (x, y) => …, x: [lo, hi], y: [lo, hi], label, point: [x, y],
   * tangent (true), gradient (true), descent: { start: [x, y], rate, steps } (gradient descent,
   * computed here) or path: [[x, y], …], steps: [{ say, point: [x, y] }], names: { x, y, z } }.
   * Returns the scene plus setPoint([x, y]).
   */
  M.surface = function (into, opts) {
    opts = opts || {};
    var f = fnOf(opts.f || 'x^2 + y^2', ['x', 'y']);
    var xr = opts.x || [-2, 2], yr = opts.y || [-2, 2], N = 90, SIZE = 12;
    var names = opts.names || { x: 'x', y: 'y', z: 'f(x, y)' };
    // Heights over the domain, to scale z into the view
    var lo = Infinity, hi = -Infinity;
    for (var i = 0; i <= 40; i++) for (var j = 0; j <= 40; j++) {
      var v = f(xr[0] + (xr[1] - xr[0]) * i / 40, yr[0] + (yr[1] - yr[0]) * j / 40);
      if (isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    }
    if (!(hi > lo)) hi = lo + 1;
    var H = 5.5;
    var X = function (x) { return ((x - xr[0]) / (xr[1] - xr[0]) - 0.5) * SIZE; };
    var Z = function (y) { return -((y - yr[0]) / (yr[1] - yr[0]) - 0.5) * SIZE; };
    var Y = function (v) { return 0.15 + ((v - lo) / (hi - lo)) * H; };
    var grad = function (x, y) {
      var hx = (xr[1] - xr[0]) * 1e-4, hy = (yr[1] - yr[0]) * 1e-4;
      return [(f(x + hx, y) - f(x - hx, y)) / (2 * hx), (f(x, y + hy) - f(x, y - hy)) / (2 * hy)];
    };
    var path = opts.path || null;
    if (!path && opts.descent) {
      var d = opts.descent, p = (d.start || [xr[1] * 0.8, yr[1] * 0.7]).slice();
      path = [p.slice()];
      for (var k = 0; k < (d.steps || 12); k++) {
        var g = grad(p[0], p[1]);
        p = [p[0] - (d.rate || 0.1) * g[0], p[1] - (d.rate || 0.1) * g[1]];
        path.push(p.slice());
      }
    }
    var point = (opts.point || (path ? path[0] : [xr[0] + (xr[1] - xr[0]) * 0.7, yr[0] + (yr[1] - yr[0]) * 0.65])).slice();
    var describe = function (q) {
      var g = grad(q[0], q[1]), v = f(q[0], q[1]);
      return names.z + ' at (' + fmt(q[0]) + ', ' + fmt(q[1]) + ') is ' + fmt(v) + '; the gradient is (' + fmt(g[0]) + ', ' + fmt(g[1]) + '), length ' + fmt(Math.hypot(g[0], g[1]));
    };
    var steps = opts.steps || (path ? path.map(function (q, k) {
      return { say: k === 0 ? 'The optimiser starts at (' + fmt(q[0]) + ', ' + fmt(q[1]) + '), where ' + names.z + ' = ' + fmt(f(q[0], q[1])) + '. Each step moves against the gradient, by the learning rate times its length.' : 'Step ' + k + ': ' + describe(q) + '.', point: q };
    }) : [{ say: 'The surface ' + names.z + '. Drag to turn it; move the point with the sliders and watch its tangent plane and gradient.', point: point }]);
    var s = M.scene(into, { label: opts.label || 'A surface', height: opts.height, chips: false, steps: steps.map(function (st) { return { say: st.say, fit: ['surface'], from: opts.from || [0.9, 0.85, 1.1] }; }) });
    var probe = null;
    var drawPoint = function () {};
    s.ready.then(function (k) {
      var T = k.THREE;
      var geo = new T.PlaneGeometry(SIZE, SIZE, N, N);
      geo.rotateX(-Math.PI / 2);
      var pos = geo.attributes.position, colors = [], c0 = new T.Color(M.tcolor('line-strong')), c1 = new T.Color(M.tcolor('accent'));
      for (var n = 0; n < pos.count; n++) {
        var wx = pos.getX(n), wz = pos.getZ(n);
        var x = xr[0] + (wx / SIZE + 0.5) * (xr[1] - xr[0]), y = yr[0] + (-wz / SIZE + 0.5) * (yr[1] - yr[0]);
        var v = f(x, y);
        pos.setY(n, Y(isFinite(v) ? v : lo));
        var t = (Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo);
        var c = c0.clone().lerp(c1, 0.1 + 0.85 * t * t);
        colors.push(c.r, c.g, c.b);
      }
      geo.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
      geo.computeVertexNormals();
      var surf = new T.Mesh(geo, new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.05, side: T.DoubleSide }));
      surf.castShadow = surf.receiveShadow = true;
      // Contour-like grid lines on the surface
      var lines = new T.Group();
      var lineMat = new T.LineBasicMaterial({ color: M.tcolor('ink-soft'), transparent: true, opacity: 0.35 });
      for (var g = 0; g <= 10; g++) {
        var a = [], b = [];
        for (var m = 0; m <= 60; m++) {
          var u = xr[0] + (xr[1] - xr[0]) * m / 60, w = yr[0] + (yr[1] - yr[0]) * g / 10;
          a.push(new T.Vector3(X(u), Y(f(u, w)) + 0.01, Z(w)));
          var u2 = xr[0] + (xr[1] - xr[0]) * g / 10, w2 = yr[0] + (yr[1] - yr[0]) * m / 60;
          b.push(new T.Vector3(X(u2), Y(f(u2, w2)) + 0.01, Z(w2)));
        }
        lines.add(new T.Line(new T.BufferGeometry().setFromPoints(a), lineMat), new T.Line(new T.BufferGeometry().setFromPoints(b), lineMat));
      }
      var group = new T.Group();
      group.add(surf, lines);
      s.add('surface', group, { label: opts.label || names.z, labelled: 'never', info: { f: String(opts.f || '') } });
      // Axes with names
      var axes = new T.Group(), axisMat = M.materials(T).darkMetal;
      var tube = function (a, b) { return new T.Mesh(new T.TubeGeometry(new T.LineCurve3(a, b), 2, 0.04, 8), axisMat); };
      axes.add(tube(new T.Vector3(-SIZE / 2, 0.02, SIZE / 2), new T.Vector3(SIZE / 2 + 0.6, 0.02, SIZE / 2)));
      axes.add(tube(new T.Vector3(-SIZE / 2, 0.02, SIZE / 2), new T.Vector3(-SIZE / 2, 0.02, -SIZE / 2 - 0.6)));
      axes.add(tube(new T.Vector3(-SIZE / 2, 0.02, SIZE / 2), new T.Vector3(-SIZE / 2, H + 1, SIZE / 2)));
      var tx = M.text3d(T, names.x, { size: 0.7 }); tx.position.set(SIZE / 2 + 1.2, 0.3, SIZE / 2);
      var ty = M.text3d(T, names.y, { size: 0.7 }); ty.position.set(-SIZE / 2, 0.3, -SIZE / 2 - 1.2);
      var tz = M.text3d(T, names.z, { size: 0.7 }); tz.position.set(-SIZE / 2, H + 1.6, SIZE / 2);
      axes.add(tx, ty, tz);
      s.add('axes', axes, { labelled: 'never' });
      // The probe: a point, its tangent plane, its gradient
      var acc = M.tcolor('accent');
      var dot = new T.Mesh(new T.SphereGeometry(0.22, 24, 16), new T.MeshStandardMaterial({ color: acc, emissive: acc, emissiveIntensity: 0.5 }));
      var halo = M.halo(T, 'accent', 1.6);
      var plane = new T.Mesh(new T.PlaneGeometry(3.2, 3.2), new T.MeshStandardMaterial({ color: acc, transparent: true, opacity: 0.22, side: T.DoubleSide, depthWrite: false }));
      var arrow = M.arrow3d(T, 'c2', 0.05);
      probe = new T.Group();
      probe.add(dot, halo);
      if (opts.tangent !== false) probe.add(plane);
      if (opts.gradient !== false) probe.add(arrow);
      s.add('point', probe, { label: 'the point', labelled: 'never' });
      if (path) {
        var pts = path.map(function (q) { return new T.Vector3(X(q[0]), Y(f(q[0], q[1])) + 0.08, Z(q[1])); });
        var pathGroup = new T.Group();
        var curve = new T.CurvePath();
        for (var q = 1; q < pts.length; q++) curve.add(new T.LineCurve3(pts[q - 1], pts[q]));
        pathGroup.add(new T.Mesh(new T.TubeGeometry(curve, 30 * pts.length, 0.06, 8), new T.MeshStandardMaterial({ color: acc, emissive: acc, emissiveIntensity: 0.25 })));
        pts.forEach(function (pt) { var b = new T.Mesh(new T.SphereGeometry(0.1, 12, 8), new T.MeshStandardMaterial({ color: M.tcolor('ink') })); b.position.copy(pt); pathGroup.add(b); });
        s.add('path', pathGroup, { label: 'the optimiser’s path', labelled: 'never' });
      }
      drawPoint = function () {
        var x = point[0], y = point[1], v = f(x, y), g = grad(x, y);
        var at = new T.Vector3(X(x), Y(v), Z(y));
        dot.position.copy(at);
        halo.position.copy(at);
        // Slopes in world units: rise per unit of world x and z
        var sx = (g[0] * H / (hi - lo)) / (SIZE / (xr[1] - xr[0])), sz = -(g[1] * H / (hi - lo)) / (SIZE / (yr[1] - yr[0]));
        var normal = new T.Vector3(-sx, 1, -sz).normalize();
        plane.position.copy(at);
        plane.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), normal);
        var up = new T.Vector3(sx, sx * sx + sz * sz, sz);
        if (up.lengthSq() > 1e-9) arrow.set(at, at.clone().addScaledVector(up.normalize(), Math.min(3, 0.8 + Math.hypot(g[0], g[1]) * 0.6)));
        else arrow.visible = false;
        if (opts.gradient === false) arrow.visible = false;
        k.render();
      };
      drawPoint();
    });
    var draw = s.draw;
    var sliders = M.h('div', { style: 'display:flex;flex-wrap:wrap;gap:4px 16px;align-items:center;margin-top:8px' });
    var readout = M.h('div', { class: 'mono', style: 'margin-top:4px;color:var(--ink-soft)' });
    var mk = function (name, r, k) {
      var lab = M.h('label', { style: 'display:inline-flex;gap:8px;align-items:center' }, name + ' ');
      var input = M.h('input', { type: 'range', min: r[0], max: r[1], step: (r[1] - r[0]) / 200, value: point[k], 'aria-label': name });
      input.addEventListener('input', function () { point[k] = +input.value; drawPoint(); readout.textContent = describe(point); });
      input.addEventListener('change', function () { var g = grad(point[0], point[1]); M.report(describe(point), { x: point[0], y: point[1], f: f(point[0], point[1]), gx: g[0], gy: g[1] }); });
      lab.append(input);
      sliders.append(lab);
      return input;
    };
    var ix = mk(names.x, xr, 0), iy = mk(names.y, yr, 1);
    s.el.after(sliders, readout);
    readout.textContent = describe(point);
    return Object.assign({}, s, {
      draw: function (i) {
        var st = steps[Math.max(0, Math.min(steps.length - 1, i))];
        if (st.point) { point = st.point.slice(); ix.value = point[0]; iy.value = point[1]; drawPoint(); readout.textContent = describe(point); }
        return draw(i);
      },
      captions: steps.map(function (st) { return st.say; }),
      setPoint: function (q) { point = q.slice(); drawPoint(); readout.textContent = describe(point); },
      path: path
    });
  };

  // ---------- A linear map ----------

  var eig2 = function (A) {
    var a = A[0][0], b = A[0][1], c = A[1][0], d = A[1][1], tr = a + d, det = a * d - b * c, disc = tr * tr / 4 - det;
    if (disc < -1e-12) return [];
    var r = Math.sqrt(Math.max(0, disc)), out = [];
    [tr / 2 + r, tr / 2 - r].forEach(function (l, k) {
      if (k === 1 && r < 1e-9) return;
      var v = Math.abs(b) > 1e-9 ? [b, l - a] : Math.abs(c) > 1e-9 ? [l - d, c] : (k === 0 ? [1, 0] : [0, 1]);
      var n = Math.hypot(v[0], v[1]);
      out.push({ value: l, vector: [v[0] / n, v[1] / n] });
    });
    return out;
  };
  var det3 = function (A) { return A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) - A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0]) + A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]); };
  /** Real eigenvalues of a 3×3 matrix (roots of its characteristic cubic) and their eigenvectors */
  var eig3 = function (A) {
    var tr = A[0][0] + A[1][1] + A[2][2];
    var c2 = A[0][0] * A[1][1] - A[0][1] * A[1][0] + A[0][0] * A[2][2] - A[0][2] * A[2][0] + A[1][1] * A[2][2] - A[1][2] * A[2][1];
    var D = det3(A);
    // λ³ − tr λ² + c2 λ − D = 0, by bisection over a bound on the roots
    var p = function (l) { return ((l - tr) * l + c2) * l - D; };
    var bound = 1 + Math.max(Math.abs(tr), Math.abs(c2), Math.abs(D)), roots = [], n = 600, prev = p(-bound);
    for (var i = 1; i <= n; i++) {
      var x0 = -bound + 2 * bound * (i - 1) / n, x1 = -bound + 2 * bound * i / n, v1 = p(x1);
      if (prev === 0) roots.push(x0);
      else if (prev * v1 < 0) { var a = x0, b = x1; for (var k = 0; k < 60; k++) { var m = (a + b) / 2; if (p(a) * p(m) <= 0) b = m; else a = m; } roots.push((a + b) / 2); }
      prev = v1;
    }
    return roots.map(function (l) {
      var B = A.map(function (r, i) { return r.map(function (v, j) { return v - (i === j ? l : 0); }); });
      var cross = function (u, v) { return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; };
      var cands = [cross(B[0], B[1]), cross(B[0], B[2]), cross(B[1], B[2])].sort(function (u, v) { return Math.hypot.apply(null, v) - Math.hypot.apply(null, u); });
      var v = cands[0], nv = Math.hypot(v[0], v[1], v[2]);
      return { value: l, vector: nv > 1e-9 ? [v[0] / nv, v[1] / nv, v[2] / nv] : [1, 0, 0] };
    });
  };
  M.eigen = function (A) { return A.length === 2 ? eig2(A) : eig3(A); };

  /**
   * A linear map deforming space: the grid, the unit square (or cube) and the basis vectors move
   * from the identity to A as t goes 0 → 1; eigenvectors keep their line. opts: { matrix: [[a, b],
   * [c, d]] or 3×3, label, eigen (true), steps (default: identity, halfway, A, eigenvectors,
   * determinant) }. A slider moves t. Returns the scene plus setT(t).
   */
  M.space = function (into, opts) {
    opts = opts || {};
    var A = opts.matrix || [[2, 1], [1, 2]], n = A.length, three = n === 3;
    var D = three ? det3(A) : A[0][0] * A[1][1] - A[0][1] * A[1][0];
    var eig = opts.eigen === false ? [] : M.eigen(A);
    var t = 0;
    var mat = 'A = ' + JSON.stringify(A).replace(/\],\[/g, '; ').replace(/[\[\]]/g, '');
    var eigText = eig.length ? eig.map(function (e) { return 'λ = ' + fmt(e.value) + ' along (' + e.vector.map(function (v) { return fmt(v); }).join(', ') + ')'; }).join('; ') : 'no real eigenvectors: every line turns';
    var steps = opts.steps || [
      { say: 'The identity: the grid and the basis vectors i and j' + (three ? ' and k' : '') + ' as they are.', t: 0 },
      { say: 'Halfway to ' + mat + ': every point moves straight towards where A sends it, and grid lines stay straight, parallel and evenly spaced.', t: 0.5 },
      { say: 'Applied in full: the columns of A are where i' + (three ? ', j and k' : ' and j') + ' land. Everything else follows from them.', t: 1 },
      { say: 'Eigenvectors: ' + eigText + '. On these lines A only stretches.', t: 1, eig: true },
      { say: 'The determinant, ' + fmt(D) + ', is how A scales ' + (three ? 'volume' : 'area') + ': the unit ' + (three ? 'cube' : 'square') + ' became a ' + (three ? 'parallelepiped' : 'parallelogram') + ' of ' + (three ? 'volume ' : 'area ') + fmt(Math.abs(D)) + (D < 0 ? ', and its sign says orientation flipped' : '') + '.', t: 1, det: true }
    ];
    var s = M.scene(into, { label: opts.label || 'A linear map', height: opts.height, chips: false, ground: false, steps: steps.map(function (st) { return { say: st.say, fit: ['view'], from: opts.from || (three ? [1, 0.8, 1.2] : [0.2, 1.4, 0.8]) }; }) });
    var redraw = function () {};
    var showEig = false, showDet = false;
    s.ready.then(function (k) {
      var T = k.THREE;
      var S = 1.6;
      // World: x right, y up, z towards you; a 2D map lives on the plane y = 0 with (x, y) → (x, −z)
      var w = function (v) { return three ? new T.Vector3(v[0] * S, v[2] * S, -v[1] * S) : new T.Vector3(v[0] * S, 0.02, -v[1] * S); };
      var apply = function (v) {
        var out = [];
        for (var i = 0; i < n; i++) { var r = 0; for (var j = 0; j < n; j++) r += ((1 - t) * (i === j ? 1 : 0) + t * A[i][j]) * v[j]; out.push(r); }
        return out;
      };
      var grid = new T.Group(), R = 3;
      var lineMat = new T.LineBasicMaterial({ color: M.tcolor('ink-soft'), transparent: true, opacity: 0.75 }), ghostMat = new T.LineBasicMaterial({ color: M.tcolor('muted'), transparent: true, opacity: 0.35 });
      var gridLines = [], ghost = new T.Group();
      var seg = function (a, b) { return [a, b]; };
      var segs = [];
      for (var i = -R; i <= R; i++) {
        if (three) {
          for (var j = -R; j <= R; j += R) { segs.push(seg([i, j, -R], [i, j, R]), seg([j, i, -R], [j, i, R]), seg([-R, i, j], [R, i, j]), seg([i, -R, j], [i, R, j])); }
        } else segs.push(seg([i, -R], [i, R]), seg([-R, i], [R, i]));
      }
      segs.forEach(function (sg) {
        var g0 = new T.BufferGeometry().setFromPoints([w(sg[0]), w(sg[1])]);
        ghost.add(new T.Line(g0, ghostMat));
        var g = new T.BufferGeometry().setFromPoints([w(sg[0]), w(sg[1])]);
        var l = new T.Line(g, lineMat);
        grid.add(l);
        gridLines.push({ line: l, a: sg[0], b: sg[1] });
      });
      // The unit square or cube, filled
      var acc = M.tcolor('accent');
      var cubeMat = new T.MeshStandardMaterial({ color: acc, transparent: true, opacity: 0.28, side: T.DoubleSide, depthWrite: false });
      var unit = new T.Mesh(three ? new T.BoxGeometry(1, 1, 1) : new T.PlaneGeometry(1, 1), cubeMat);
      var unitBase = unit.geometry.attributes.position.array.slice();
      grid.add(unit);
      var arrows = [], cols = ['c2', 'c3', 'c4'], names = ['i', 'j', 'k'];
      for (var b = 0; b < n; b++) {
        var ah = M.arrow3d(T, cols[b], 0.045);
        var lab = M.text3d(T, names[b], { size: 0.55, color: cols[b] });
        grid.add(ah, lab);
        arrows.push({ arrow: ah, label: lab, e: b });
      }
      var eigLines = new T.Group();
      eig.forEach(function (e) {
        var v = e.vector;
        var g = new T.BufferGeometry().setFromPoints([w(v.map(function (x) { return -x * 4; })), w(v.map(function (x) { return x * 4; }))]);
        eigLines.add(new T.Line(g, new T.LineBasicMaterial({ color: acc })));
        var tag = M.text3d(T, 'λ = ' + fmt(e.value), { size: 0.5, color: 'accent' });
        tag.position.copy(w(v.map(function (x) { return x * 3.4; }))).add(new T.Vector3(0, 0.4, 0));
        eigLines.add(tag);
      });
      grid.add(ghost, eigLines);
      s.add('grid', grid, { label: 'space', labelled: 'never' });
      var view = new T.Mesh(new T.BoxGeometry(three ? 7 : 7, three ? 7 : 0.1, 7), new T.MeshBasicMaterial({ visible: false }));
      s.add('view', view, { labelled: 'never' });
      redraw = function () {
        gridLines.forEach(function (gl) {
          var p = gl.line.geometry.attributes.position, a = w(apply(gl.a)), b2 = w(apply(gl.b));
          p.setXYZ(0, a.x, a.y, a.z); p.setXYZ(1, b2.x, b2.y, b2.z); p.needsUpdate = true;
        });
        var up = unit.geometry.attributes.position;
        for (var q = 0; q < up.count; q++) {
          // The unit square or cube's corners, from [0, 1]
          var cx = unitBase[q * 3] + 0.5, cy = unitBase[q * 3 + 1] + 0.5, cz = unitBase[q * 3 + 2] + 0.5;
          var v = three ? [cx, -cz + 1, cy] : [cx, cy];
          var m = w(apply(v));
          up.setXYZ(q, m.x, m.y + (three ? 0 : 0.01), m.z);
        }
        up.needsUpdate = true;
        unit.geometry.computeVertexNormals();
        unit.geometry.computeBoundingSphere();
        unit.material.opacity = showDet ? 0.45 : 0.25;
        arrows.forEach(function (ar) {
          var e = [0, 0, 0].slice(0, n); e[ar.e] = 1;
          var tip = w(apply(e));
          ar.arrow.set(new T.Vector3(0, 0.05, 0), tip.clone().add(new T.Vector3(0, 0.05, 0)));
          ar.label.position.copy(tip).add(new T.Vector3(0, 0.35, 0));
        });
        eigLines.visible = showEig;
        k.render();
      };
      redraw();
    });
    var row = M.h('div', { style: 'display:flex;gap:12px;align-items:center;margin-top:8px' });
    var input = M.h('input', { type: 'range', min: 0, max: 1, step: 0.01, value: 0, 'aria-label': 'How much of A is applied' });
    var out = M.h('output', { class: 'mono' });
    var say = function () { out.textContent = 't = ' + fmt(t) + ' · ' + mat + ' · det ' + fmt(D); };
    input.addEventListener('input', function () { t = +input.value; redraw(); say(); });
    input.addEventListener('change', function () { M.report('applied ' + Math.round(t * 100) + '% of ' + mat, { t: t, det: D }); });
    row.append(M.h('label', { style: 'display:inline-flex;gap:8px;align-items:center' }, 'Apply A'), input, out);
    s.el.after(row);
    say();
    var draw = s.draw;
    return Object.assign({}, s, {
      captions: steps.map(function (st) { return st.say; }),
      draw: function (i) {
        var st = steps[Math.max(0, Math.min(steps.length - 1, i))];
        t = st.t != null ? st.t : t; input.value = t; showEig = !!st.eig; showDet = !!st.det;
        redraw(); say();
        return draw(i);
      },
      setT: function (v) { t = v; input.value = v; redraw(); say(); },
      eigen: eig,
      det: D
    });
  };
})(window.__TideMachine);
