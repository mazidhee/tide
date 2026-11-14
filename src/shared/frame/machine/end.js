/* TideMachine: frozen and put on window */
(function (M) {
  'use strict';
  delete window.__TideMachine;
  // An error inside a library script reaches the frame only as "Script error." (the frame's origin
  // is opaque): say which helper failed and why, so the check (and a repair) can see it
  Object.keys(M).forEach(function (k) {
    var fn = M[k];
    if (typeof fn !== 'function' || /^[A-Z]/.test(k)) return;
    var wrapped = function () {
      try { return fn.apply(this, arguments); } catch (e) { console.error('TideMachine.' + k + ' failed: ' + (e && e.message || e)); throw e; }
    };
    Object.keys(fn).forEach(function (p) { wrapped[p] = fn[p]; });
    M[k] = wrapped;
  });
  Object.defineProperty(window, 'TideMachine', { value: Object.freeze(M), writable: false, configurable: false });
})(window.__TideMachine);
