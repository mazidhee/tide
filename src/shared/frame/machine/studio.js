/*
 * TideMachine's studio: how a 3D scene in Tide looks. Soft key light with shadows, a cool fill,
 * filmic tone mapping, a ground that catches shadows and fades into the page through fog, all in
 * the theme's colours and switched with it; believable materials (metal, silicon with a die's
 * floorplan, a PCB's green-black with traces, bulb glass, plastic); a glow for what is on; crisp
 * text sprites. Used by TideMachine.scene, and open to a scene written freehand on three.js.
 */
(function (M) {
  'use strict';

  var dark = function () {
    var bg = M.color('bg') || '#ffffff', p = document.createElement('canvas').getContext('2d');
    p.fillStyle = bg;
    var hex = p.fillStyle;
    if (!/^#/.test(hex)) return false;
    var r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b < 110;
  };
  M.isDark = dark;

  /** A colour name ('accent', 'bg', 'c3' …) or CSS colour as three.js reads it */
  M.tcolor = function (name) {
    var v = /^#|^rgb|^hsl/.test(name) ? name : M.color(String(name).replace(/^--/, '')) || '#888888';
    var p = document.createElement('canvas').getContext('2d');
    p.fillStyle = '#888888';
    p.fillStyle = v;
    return p.fillStyle;
  };

  /**
   * Sets up the look of a scene: M.studio(THREE, scene, renderer, { ground: true, fog: [near, far] }).
   * Returns { key, fill, hemi, ground, frame(center, radius) (aims the key light's shadows at what
   * the camera looks at), apply() (the theme again) }. Follows visual.onTheme on its own.
   */
  M.studio = function (T, scene, renderer, o) {
    o = o || {};
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.outputColorSpace = T.SRGBColorSpace;
    var hemi = new T.HemisphereLight(0xdfe6f0, 0x20242c, 0.8);
    var key = new T.DirectionalLight(0xffffff, 2.4);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    key.shadow.radius = 4;
    var fill = new T.DirectionalLight(0xa9bddc, 0.55);
    fill.position.set(-12, 8, -8);
    scene.add(hemi, key, key.target, fill);
    var ground = null;
    if (o.ground !== false) {
      // Only its shadows show: the page's own colour runs under the scene, without a seam
      ground = new T.Mesh(new T.PlaneGeometry(800, 800), new T.ShadowMaterial({ opacity: 0.3 }));
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = o.groundY || 0;
      ground.receiveShadow = true;
      scene.add(ground);
    }
    var fog = o.fog || [90, 320];
    scene.fog = new T.Fog(0xffffff, fog[0], fog[1]);
    var frame = function (center, radius) {
      var c = center || new T.Vector3(), r = Math.max(4, radius || 12), sc = key.shadow.camera;
      sc.left = sc.bottom = -r * 1.2;
      sc.right = sc.top = r * 1.2;
      sc.near = 0.5;
      sc.far = r * 14;
      sc.updateProjectionMatrix();
      key.target.position.copy(c);
      key.position.copy(c).add(new T.Vector3(0.7, 1.6, 0.9).multiplyScalar(r * 1.7));
    };
    var apply = function () {
      var d = dark(), bg = M.tcolor('bg');
      scene.background = new T.Color(bg);
      scene.fog.color.set(bg);
      if (ground) ground.material.opacity = d ? 0.45 : 0.18;
      hemi.intensity = d ? 0.7 : 1.1;
      hemi.groundColor.set(d ? 0x161a22 : 0xb8c0cc);
      key.intensity = d ? 2.4 : 2.0;
      renderer.toneMappingExposure = d ? 1.05 : 0.95;
      halos.forEach(function (h) { h.blending = d ? T.AdditiveBlending : T.NormalBlending; h.needsUpdate = true; });
      sprites.forEach(function (s) { s.draw(); });
    };
    frame();
    apply();
    if (window.visual) window.visual.onTheme(function () { apply(); if (o.onTheme) o.onTheme(); });
    return { key: key, fill: fill, hemi: hemi, ground: ground, frame: frame, apply: apply };
  };

  var halos = [], sprites = [];
  var cache = {};
  var canvasTex = function (T, w, h, paint) {
    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    paint(cv.getContext('2d'), w, h);
    var t = new T.CanvasTexture(cv);
    t.colorSpace = T.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  };
  var rng = function (seed) { return function () { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }; };

  /**
   * Materials that read as the real thing: M.materials(THREE).metal, .darkMetal, .silicon (a die's
   * floorplan texture), .pcb (green-black board with copper traces), .glass (a bulb, lit with
   * emissive), .plastic(colourName), .matte(colourName), .wire. Made once per frame.
   */
  M.materials = function (T) {
    if (cache.mats) return cache.mats;
    var silicon = canvasTex(T, 1024, 1024, function (c, w, h) {
      var r = rng(11);
      c.fillStyle = '#2a3140'; c.fillRect(0, 0, w, h);
      c.strokeStyle = 'rgba(150,170,210,.10)';
      for (var i = 0; i <= w; i += 16) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i, h); c.moveTo(0, i); c.lineTo(w, i); c.stroke(); }
      for (var k = 0; k < 520; k++) { c.fillStyle = 'rgba(160,180,220,' + (0.04 + r() * 0.1) + ')'; c.fillRect(Math.floor(r() * 64) * 16, Math.floor(r() * 64) * 16, (1 + Math.floor(r() * 4)) * 16, (1 + Math.floor(r() * 3)) * 16); }
    });
    var pcb = canvasTex(T, 1024, 1024, function (c, w, h) {
      var r = rng(5);
      c.fillStyle = '#0f2a1f'; c.fillRect(0, 0, w, h);
      c.lineWidth = 3; c.lineCap = 'round';
      for (var k = 0; k < 140; k++) {
        c.strokeStyle = 'rgba(196,150,72,' + (0.25 + r() * 0.3) + ')';
        var x = r() * w, y = r() * h; c.beginPath(); c.moveTo(x, y);
        for (var s = 0; s < 3; s++) { if (r() < 0.5) x += (r() - 0.5) * 300; else y += (r() - 0.5) * 300; c.lineTo(x, y); }
        c.stroke();
        c.fillStyle = 'rgba(214,170,90,.7)'; c.beginPath(); c.arc(x, y, 5, 0, 7); c.fill();
      }
    });
    silicon.wrapS = silicon.wrapT = pcb.wrapS = pcb.wrapT = T.RepeatWrapping;
    var mat = function (o) { return new T.MeshStandardMaterial(o); };
    cache.mats = {
      metal: mat({ color: 0xc3c9d3, roughness: 0.32, metalness: 0.9 }),
      darkMetal: mat({ color: 0x4a5160, roughness: 0.4, metalness: 0.75 }),
      silicon: mat({ map: silicon, roughness: 0.45, metalness: 0.45 }),
      pcb: mat({ map: pcb, roughness: 0.7, metalness: 0.15 }),
      glass: mat({ color: 0xc4ccd8, roughness: 0.12, metalness: 0, emissive: 0xffc27a, emissiveIntensity: 0 }),
      wire: mat({ color: 0x7c8494, roughness: 0.38, metalness: 0.7, emissive: 0x000000 }),
      plastic: function (name) { return mat({ color: M.tcolor(name || 'surface'), roughness: 0.55, metalness: 0.05 }); },
      matte: function (name) { return mat({ color: M.tcolor(name || 'surface'), roughness: 0.9, metalness: 0 }); }
    };
    return cache.mats;
  };

  /**
   * Frames an object, a list of objects or a THREE.Box3 from a direction, so all of it is in view
   * with a margin: M.fitView(THREE, camera, target, { from: [x, y, z], fill: 0.85, controls,
   * move }) puts the camera there (and the controls' target, when given; move: false leaves them)
   * and returns { camera: [x, y, z], target: [x, y, z] }, for a glide or a jump.
   */
  M.fitView = function (T, camera, target, o) {
    o = o || {};
    if (Array.isArray(target)) { var grp = target; target = { isList: true, list: grp }; }
    var box = new T.Box3();
    if (target && target.isBox3) box.copy(target);
    else if (target && target.isList) target.list.forEach(function (x) { if (x && x.isBox3) box.union(x); else if (x) box.expandByObject(x); });
    else box.setFromObject(target);
    var seen = function (obj) { for (var q = obj; q; q = q.parent) if (q.visible === false) return false; return true; };
    var objects = target && target.isList ? target.list.filter(function (x) { return x && !x.isBox3; }) : target && target.traverse ? [target] : [];
    var center = box.getCenter(new T.Vector3()), dir = new T.Vector3().fromArray(o.from || [0.2, 0.6, 1]).normalize();
    var cam = camera.clone(), d = box.getSize(new T.Vector3()).length() || 4, corners = [];
    // The subject's own vertices (a sample), so a flat board seen at an angle fills the view, not its box
    var meshes = [];
    objects.forEach(function (obj) {
      obj.updateMatrixWorld(true);
      obj.traverse(function (m) { if (m.isMesh && m.geometry && m.geometry.attributes.position && seen(m)) meshes.push(m); });
    });
    if (meshes.length) {
      var total = meshes.reduce(function (n, m) { return n + m.geometry.attributes.position.count; }, 0);
      var stride = Math.max(1, Math.floor(total / 3000));
      meshes.forEach(function (m) {
        var pos = m.geometry.attributes.position;
        for (var i = 0; i < pos.count; i += stride) corners.push(new T.Vector3().fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld));
      });
      box = new T.Box3().setFromPoints(corners);
      center = box.getCenter(new T.Vector3());
    }
    if (!corners.length) for (var c = 0; c < 8; c++) corners.push(new T.Vector3(c & 1 ? box.max.x : box.min.x, c & 2 ? box.max.y : box.min.y, c & 4 ? box.max.z : box.min.z));
    // Aim at the middle of what is seen, not of the box
    var mid = new T.Vector3();
    corners.forEach(function (q) { mid.add(q); });
    if (corners.length > 8) { mid.multiplyScalar(1 / corners.length); center.lerp(mid, 0.5); }
    for (var k = 0; k < 6; k++) {
      cam.position.copy(center).addScaledVector(dir, d);
      cam.lookAt(center);
      cam.updateMatrixWorld();
      var most = 0;
      corners.forEach(function (q) { var v = q.clone().project(cam); most = Math.max(most, Math.abs(v.x), Math.abs(v.y)); });
      if (!isFinite(most) || most <= 0) break;
      d *= Math.pow(most / (o.fill || 0.85), 0.9);
    }
    var at = center.clone().addScaledVector(dir, d);
    if (o.move !== false) {
      camera.position.copy(at);
      camera.lookAt(center);
      if (o.controls) { o.controls.target.copy(center); o.controls.update(); }
    }
    return { camera: at.toArray(), target: center.toArray() };
  };

  /** A solid arrow (shaft and head) in a colour name: .set(from, to) as THREE.Vector3s */
  M.arrow3d = function (T, color, radius) {
    radius = radius || 0.05;
    var m = new T.MeshStandardMaterial({ color: M.tcolor(color || 'accent'), roughness: 0.4, metalness: 0.1 });
    var g = new T.Group(), shaft = new T.Mesh(new T.CylinderGeometry(radius, radius, 1, 16), m), head = new T.Mesh(new T.ConeGeometry(radius * 3, radius * 7, 20), m);
    shaft.castShadow = head.castShadow = true;
    g.add(shaft, head);
    g.set = function (from, to) {
      var dir = to.clone().sub(from), len = dir.length(), hl = Math.min(radius * 7, len * 0.4);
      g.visible = len > 1e-6;
      if (!g.visible) return g;
      var q = new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), dir.clone().normalize());
      shaft.scale.set(1, Math.max(1e-3, len - hl), 1);
      shaft.position.copy(from).addScaledVector(dir, (len - hl) / 2 / len);
      shaft.quaternion.copy(q);
      head.scale.set(1, hl / (radius * 7), 1);
      head.position.copy(from).addScaledVector(dir, (len - hl / 2) / len);
      head.quaternion.copy(q);
      return g;
    };
    return g;
  };

  /** A soft glow around something lit: a sprite to add beside it; set .material.opacity to fade it */
  M.halo = function (T, color, size) {
    var tex = canvasTex(T, 128, 128, function (c) {
      var g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0, 'rgba(255,255,255,.95)'); g.addColorStop(0.35, 'rgba(255,255,255,.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.fillRect(0, 0, 128, 128);
    });
    var m = new T.SpriteMaterial({ map: tex, color: M.tcolor(color || 'accent'), transparent: true, depthWrite: false, blending: dark() ? T.AdditiveBlending : T.NormalBlending, opacity: 0.8 });
    halos.push(m);
    var s = new T.Sprite(m);
    s.scale.setScalar(size || 2);
    return s;
  };

  /** Text in the scene, as a crisp sprite that faces the camera: M.text3d(THREE, 'Core 0', { size: 1, color: 'ink', weight: 600 }); .set(text) */
  M.text3d = function (T, text, o) {
    o = o || {};
    var cv = document.createElement('canvas'), tex = new T.CanvasTexture(cv);
    tex.colorSpace = T.SRGBColorSpace;
    tex.anisotropy = 8;
    var sp = new T.Sprite(new T.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    sp.renderOrder = 10;
    var s = { sprite: sp, text: String(text) };
    s.draw = function () {
      var c = cv.getContext('2d'), px = 96, font = (o.weight || 600) + ' ' + px + 'px -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif';
      c.font = font;
      var w = Math.ceil(c.measureText(s.text || ' ').width) + 28, h = Math.ceil(px * 1.35);
      cv.width = w; cv.height = h;
      c.font = font; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillStyle = M.tcolor(o.color || 'ink');
      c.fillText(s.text, w / 2, h / 2 + 4);
      tex.needsUpdate = true;
      var size = o.size || 1;
      sp.scale.set(size * w / h, size, 1);
    };
    s.set = function (t) { s.text = String(t); s.draw(); };
    s.draw();
    sprites.push(s);
    sp.userData.text = s;
    return sp;
  };
})(window.__TideMachine);
