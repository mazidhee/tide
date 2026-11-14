/* TideMachine: frozen and put on window */
(function (M) {
  'use strict';
  delete window.__TideMachine;
  Object.defineProperty(window, 'TideMachine', { value: Object.freeze(M), writable: false, configurable: false });
})(window.__TideMachine);
