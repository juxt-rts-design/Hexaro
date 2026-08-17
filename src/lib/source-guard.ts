/** Script inline (head) : s’exécute avant React, production uniquement. */
export const SOURCE_GUARD_INLINE = `(function(){
  if (typeof window === "undefined") return;
  try {
    var hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    if (hook) {
      hook.inject = function(){};
      hook.on = function(){};
      hook.supportsFiber = false;
      hook.isDisabled = true;
    } else {
      Object.defineProperty(window, "__REACT_DEVTOOLS_GLOBAL_HOOK__", {
        value: { isDisabled: true, inject: function(){}, on: function(){}, supportsFiber: false },
        configurable: false
      });
    }
  } catch (e) {}
  try {
    var noop = function(){};
    console.log = noop;
    console.debug = noop;
    console.info = noop;
    console.dir = noop;
    console.table = noop;
    console.warn = noop;
  } catch (e) {}
  function blockKeys(e) {
    var k = e.key || "";
    var code = e.code || "";
    if (e.keyCode === 123 || k === "F12" || code === "F12") { e.preventDefault(); e.stopPropagation(); return false; }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && /^(I|J|C)$/i.test(k)) { e.preventDefault(); e.stopPropagation(); return false; }
    if (e.metaKey && e.altKey && /^(I|J|C)$/i.test(k)) { e.preventDefault(); e.stopPropagation(); return false; }
    if ((e.ctrlKey || e.metaKey) && /^(U)$/i.test(k)) { e.preventDefault(); e.stopPropagation(); return false; }
  }
  document.addEventListener("contextmenu", function(e){ e.preventDefault(); }, true);
  document.addEventListener("keydown", blockKeys, true);
})();`;

export function installSourceGuard() {
  if (!import.meta.env.PROD || typeof window === "undefined") return;
  try {
    const hook = (window as Window & { __REACT_DEVTOOLS_GLOBAL_HOOK__?: { isDisabled?: boolean } })
      .__REACT_DEVTOOLS_GLOBAL_HOOK__;
    if (hook) hook.isDisabled = true;
  } catch {
    /* ignore */
  }
}
