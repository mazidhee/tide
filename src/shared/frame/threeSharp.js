/*
 * Keeps three.js canvases sharp when Tide enlarges a visual (full screen zooms its frame, which
 * raises the frame's devicePixelRatio). A visual sets its renderer's pixel ratio once, at the ratio
 * of the moment (usually capped at 2); when the ratio changes, each renderer's is scaled by the same
 * amount (up to 5) and its last picture drawn again, so the canvas is redrawn at the new density
 * instead of stretched. Appended to /lib/three.js (main/visualLibs).
 */
(function () {
  'use strict';
  var T = self.THREE, R = T && T.WebGLRenderer;
  if (!R || R.tideSharp) return;
  var live = [];
  var MAX = 5;
  function Sharp(opts) {
    var r = new R(opts);
    var set = r.setPixelRatio, draw = r.render;
    // What the visual asked for, and the device ratio it asked at
    r.tideAsked = { ratio: r.getPixelRatio(), dpr: self.devicePixelRatio || 1 };
    r.setPixelRatio = function (v) {
      r.tideAsked = { ratio: v, dpr: self.devicePixelRatio || 1 };
      return set.call(r, v);
    };
    r.render = function (scene, camera) {
      r.tideLast = [scene, camera];
      return draw.call(r, scene, camera);
    };
    r.tideRescale = function () {
      var a = r.tideAsked, now = self.devicePixelRatio || 1;
      var want = Math.min(MAX, Math.max(a.ratio, a.ratio * (now / a.dpr)));
      if (Math.abs(want - r.getPixelRatio()) < 0.01) return;
      set.call(r, want);
      if (r.tideLast) try { draw.call(r, r.tideLast[0], r.tideLast[1]); } catch (e) {}
    };
    live.push(r);
    return r;
  }
  Sharp.prototype = R.prototype;
  Object.getOwnPropertyNames(R).forEach(function (k) { if (!(k in Sharp)) try { Sharp[k] = R[k]; } catch (e) {} });
  Sharp.tideSharp = true;
  T.WebGLRenderer = Sharp;

  // A change of device pixel ratio: one media query per ratio, armed again after each change
  var watch = function () {
    var q = matchMedia('(resolution: ' + (self.devicePixelRatio || 1) + 'dppx)');
    var on = function () {
      q.removeEventListener('change', on);
      live = live.filter(function (r) { return r.domElement && r.domElement.isConnected; });
      live.forEach(function (r) { r.tideRescale(); });
      watch();
    };
    q.addEventListener('change', on);
  };
  watch();
})();
