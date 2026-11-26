// Stable core: never hot-reloaded. Everything under core/ is reloaded with a
// cache-busting query, so it must live in its own scope and be re-entrant.
"use strict";

const { classes: Cc, interfaces: Ci, utils: Cu } = Components;
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/osfile.jsm");

const ADDON_ID = "pm-ext-toolbox@jalkhov";
// Keep in sync with install.rdf; the gate reports the mismatch instead of failing.
const MIN_APP_VERSION = "35.0.2";
const PANEL_URL = "chrome://pm-ext/content/panel.xul";
const PANEL_OPEN_DELAY_MS = 1500;

let core = null;
let coreScope = null;
let panelWindow = null;
let openTimer = null;
let logQueue = Promise.resolve();
const logMessages = [];

function logPath() {
  const file = Services.dirsvc.get("ProfD", Ci.nsIFile);
  file.append("pmext.log");
  return file.path;
}

function log(message) {
  const line = "[" + new Date().toISOString() + "] " + message;
  logMessages.push(line);
  dump(line + "\n");
  logQueue = logQueue
    .then(function () {
      return OS.File.read(logPath(), { encoding: "utf-8" }).catch(function () {
        return "";
      });
    })
    .then(function (current) {
      return OS.File.writeAtomic(logPath(), current + line + "\n", { encoding: "utf-8" });
    })
    .catch(function () {});
}

// The add-on is installed through a proxy file during development, so the
// source directory is whatever that file points at.
// shortcut: proxy file only, resolve __SCRIPT_URI_SPEC__ when XPI installs land (M4).
function sourceDir() {
  const file = Services.dirsvc.get("ProfD", Ci.nsIFile);
  file.append("extensions");
  file.append(ADDON_ID);
  const path = OS.File.read(file.path, { encoding: "utf-8" });
  return path; // promise
}

// appinfo.version is the Pale Moon release (35.0.2); platformVersion is the UXP
// engine (6.9.0). Compatibility is gated on the release, the engine is only reported.
function isCompatible() {
  return Services.vc.compare(Services.appinfo.version, MIN_APP_VERSION) >= 0;
}

function openPanel() {
  if (panelWindow && !panelWindow.closed) {
    panelWindow.focus();
    return panelWindow;
  }
  panelWindow = Services.ww.openWindow(
    null,
    PANEL_URL,
    "pmext-panel",
    "chrome,dialog=no,resizable,centering,width=620,height=520",
    null
  );
  if (core && typeof core.onPanelOpened === "function") {
    core.onPanelOpened();
  }
  return panelWindow;
}

function makeHost(dir) {
  return {
    addonID: ADDON_ID,
    sourceDir: dir,
    appVersion: Services.appinfo.version,
    platformVersion: Services.appinfo.platformVersion,
    minVersion: MIN_APP_VERSION,
    compatible: isCompatible(),
    logMessages: logMessages,
    log: log,
    reload: loadCore,
    openPanel: openPanel,
    getPanel: function () {
      return panelWindow && !panelWindow.closed ? panelWindow : null;
    }
  };
}

function loadCore() {
  return sourceDir()
    .then(function (dir) {
      if (core && typeof core.shutdown === "function") {
        try {
          core.shutdown();
        } catch (error) {
          log("core shutdown failed: " + error);
        }
      }
      core = null;
      coreScope = { PM_EXT_HOST: makeHost(dir) };
      const file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
      file.initWithPath(dir);
      file.append("core");
      file.append("main.js");
      const url = Services.io.newFileURI(file).spec + "?v=" + Date.now();
      Services.scriptloader.loadSubScript(url, coreScope);
      core = coreScope.PM_EXT_CORE;
      if (!core) throw new Error("core/main.js did not define PM_EXT_CORE");
      core.startup(coreScope.PM_EXT_HOST);
      log("core loaded from " + url);
    })
    .catch(function (error) {
      log("core load failed: " + error);
    });
}

function startup(data, reason) {
  log("toolbox startup reason=" + reason + " version=" + Services.appinfo.version +
      " platform=" + Services.appinfo.platformVersion);
  loadCore();
  const timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
  timer.initWithCallback(function () {
    openTimer = null;
    try {
      openPanel();
    } catch (error) {
      log("panel open failed: " + error);
    }
  }, PANEL_OPEN_DELAY_MS, Ci.nsITimer.TYPE_ONE_SHOT);
  openTimer = timer;
}

function shutdown(data, reason) {
  if (openTimer) {
    openTimer.cancel();
    openTimer = null;
  }
  if (core && typeof core.shutdown === "function") {
    try {
      core.shutdown();
    } catch (error) {
      log("core shutdown failed: " + error);
    }
  }
  core = null;
  coreScope = null;
  if (panelWindow && !panelWindow.closed) {
    panelWindow.close();
  }
  panelWindow = null;
  log("toolbox shutdown reason=" + reason);
}

function install() {}
function uninstall() {}
