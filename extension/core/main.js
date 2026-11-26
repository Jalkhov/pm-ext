// Reloadable module: this file is re-evaluated on every reload, with a fresh
// scope. It must not assume any previous state survived.
"use strict";

var PM_EXT_BUILD = "v1";

var PM_EXT_CORE = (function () {
  let host = null;
  let refreshTimer = null;

  function text(id) {
    const win = host.getPanel();
    if (!win) return null;
    const node = win.document.getElementById(id);
    return node;
  }

  function statusLine() {
    const version = "Pale Moon " + host.appVersion + " (UXP " + host.platformVersion + ")";
    if (!host.compatible) {
      return "\u26a0 " + version + " is below the supported minimum " + host.minVersion +
        ". Reload is disabled.";
    }
    return version + " \u00b7 core " + PM_EXT_BUILD;
  }

  function setText(id, value) {
    const node = text(id);
    if (node) node.value = value;
  }

  function render() {
    if (!host.getPanel()) return;
    setText("pmext-status", statusLine());
    setText("pmext-build", "build " + PM_EXT_BUILD);
    setText("pmext-log", host.logMessages.join("\n"));
    const button = text("pmext-reload");
    if (button) {
      button.disabled = !host.compatible;
      // Assigning oncommand keeps a single handler across re-renders.
      button.oncommand = function () {
        host.log("reload requested from the panel");
        host.reload();
      };
    }
  }

  function startup(nextHost) {
    host = nextHost;
    host.log("core started build=" + PM_EXT_BUILD + " compatible=" + host.compatible);
    render();
    const timer = Components.classes["@mozilla.org/timer;1"].createInstance(Components.interfaces.nsITimer);
    timer.initWithCallback(render, 800, Components.interfaces.nsITimer.TYPE_REPEATING_SLACK);
    refreshTimer = timer;
  }

  function onPanelOpened() {
    host.log("panel rendered build=" + PM_EXT_BUILD);
    render();
  }

  function shutdown() {
    if (refreshTimer) {
      refreshTimer.cancel();
      refreshTimer = null;
    }
  }

  return { startup: startup, shutdown: shutdown, onPanelOpened: onPanelOpened };
})();
