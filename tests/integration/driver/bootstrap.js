// Drives the toolbox through its panel in a real Pale Moon session: checks the
// project list, unregisters a project and verifies a file change reloads another.
"use strict";

const { classes: Cc, interfaces: Ci, utils: Cu } = Components;
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/osfile.jsm");
const { AddonManager } = Cu.import("resource://gre/modules/AddonManager.jsm", {});

const TOOLBOX_ID = "pm-ext-toolbox@jalkhov";
const TARGET_ID = "pm-ext-m0-target@example.com";
const SECOND_ID = "pm-ext-second@example.com";
const PROFILE = Services.dirsvc.get("ProfD", Ci.nsIFile).path;
const LOG_PATH = PROFILE + "/integration.log";
const TARGET_LOG = PROFILE + "/m0-target-last.log";
const POLL_MS = 200;
const TIMEOUT_MS = 20000;

const lines = [];

function log(message) {
  lines.push(message);
  dump("[integration] " + message + "\n");
}

function readText(path) {
  return OS.File.read(path, { encoding: "utf-8" }).catch(function () { return ""; });
}

function sleep(ms) {
  return new Promise(function (resolve) {
    const timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
    timer.initWithCallback(resolve, ms, Ci.nsITimer.TYPE_ONE_SHOT);
  });
}

function getAddon(id) {
  // UXP's AddonManager is callback-only.
  return new Promise(function (resolve) {
    AddonManager.getAddonByID(id, resolve);
  });
}

function waitFor(label, predicate) {
  const deadline = Date.now() + TIMEOUT_MS;
  function poll() {
    return Promise.resolve().then(predicate).then(function (value) {
      if (value) return value;
      if (Date.now() > deadline) throw new Error("timeout waiting for " + label);
      return sleep(POLL_MS).then(poll);
    });
  }
  return poll();
}

function panelWindow() {
  const windows = Services.wm.getEnumerator(null);
  while (windows.hasMoreElements()) {
    const win = windows.getNext();
    try {
      const root = win.document && win.document.documentElement;
      if (root && root.id === "pmext-panel") return win;
    } catch (error) {
      // Window closed while enumerated: ignore.
    }
  }
  return null;
}

function projectItem(id) {
  const win = panelWindow();
  if (!win) return null;
  const list = win.document.getElementById("pmext-projects");
  if (!list) return null;
  for (let item = list.firstChild; item; item = item.nextSibling) {
    if (item.getAttribute("value") === id) return item;
  }
  return null;
}

function toolboxLogHas(text) {
  return readText(PROFILE + "/pmext.log").then(function (log) {
    return log.indexOf(text) !== -1;
  });
}

function waitForLog(text) {
  return waitFor("log: " + text, function () { return toolboxLogHas(text); });
}

function countReloads() {
  return readText(PROFILE + "/pmext.log").then(function (log) {
    return log.split("change(s) in " + TARGET_ID + " -> reload").length - 1;
  });
}

function proxyTarget(id) {
  return readText(PROFILE + "/extensions/" + id).then(function (path) {
    return path.trim();
  });
}

function fileExists(path) {
  return OS.File.stat(path).then(function () { return true; }, function () { return false; });
}

function run() {
  return waitFor("toolbox add-on", function () { return getAddon(TOOLBOX_ID); })
    .then(function (addon) {
      if (!addon.isActive) throw new Error("toolbox is not active");
      log("toolbox loaded");
      return waitForLog("core started build=v4");
    })
    .then(function () {
      log("core v4 loaded");
      return waitFor("panel", panelWindow);
    })
    .then(function () {
      log("panel open");
      return waitFor("target in the project list", function () { return projectItem(TARGET_ID); });
    })
    .then(function (item) {
      log("target listed: " + item.getAttribute("label"));
      if (item.getAttribute("label").indexOf("watching") === -1) {
        throw new Error("target is not watched");
      }
      return waitFor("second project in the list", function () { return projectItem(SECOND_ID); });
    })
    .then(function () {
      log("second project listed");
      return waitForLog("watch: 2 project(s) watched");
    })
    .then(function () {
      const win = panelWindow();
      win.document.getElementById("pmext-projects").selectedItem = projectItem(SECOND_ID);
      win.document.getElementById("pmext-unregister").oncommand();
      log("unregister clicked");
      return waitForLog("unregister: " + SECOND_ID);
    })
    .then(function () {
      return waitFor("second proxy removed", function () {
        return fileExists(PROFILE + "/extensions/" + SECOND_ID).then(function (exists) {
          return !exists;
        });
      });
    })
    .then(function () {
      log("proxy file removed");
      return waitFor("second gone from the list", function () { return projectItem(SECOND_ID) === null; });
    })
    .then(function () {
      log("second removed from the list");
      // refreshProjects restarts the watcher; let its baseline scan happen first.
      return sleep(1200);
    })
    .then(function () {
      return proxyTarget(TARGET_ID);
    })
    .then(function (directory) {
      log("target source: " + directory);
      return readText(directory + "/bootstrap.js").then(function (source) {
        return OS.File.writeAtomic(directory + "/bootstrap.js",
          source + "\n// integration " + Date.now() + "\n", { encoding: "utf-8" });
      });
    })
    .then(function () {
      return waitForLog("change(s) in " + TARGET_ID + " -> reload");
    })
    .then(function () {
      return waitFor("target restarted", function () {
        return readText(TARGET_LOG).then(function (log) {
          return log.indexOf("reason=ADDON_ENABLE") !== -1;
        });
      });
    })
    .then(function () {
      log("target reloaded");
      // Let the watcher settle, then save two files at once.
      return sleep(1200);
    })
    .then(countReloads)
    .then(function (before) {
      return proxyTarget(TARGET_ID).then(function (directory) {
        const stamp = Date.now();
        return readText(directory + "/bootstrap.js").then(function (source) {
          return OS.File.writeAtomic(directory + "/bootstrap.js",
            source + "\n// two files " + stamp + "\n", { encoding: "utf-8" });
        }).then(function () {
          return readText(directory + "/chrome.manifest");
        }).then(function (manifest) {
          return OS.File.writeAtomic(directory + "/chrome.manifest",
            manifest + "\n# two files " + stamp + "\n", { encoding: "utf-8" });
        }).then(function () {
          return waitForLog("2 change(s) in " + TARGET_ID + " -> reload");
        }).then(function () {
          // Both files belong to one save, so only one reload may follow.
          return sleep(2500).then(countReloads).then(function (after) {
            if (after !== before + 1) {
              throw new Error("expected one reload for two files, saw " + (after - before));
            }
          });
        });
      });
    })
    .then(function () {
      log("two files saved at once -> one reload");
      log("RESULT: PASS");
    })
    .catch(function (error) {
      log("RESULT: FAIL (" + error + ")");
    });
}

function startup(data, reason) {
  if (reason !== 1 && reason !== 5) return;
  run().then(function () {
    return OS.File.writeAtomic(LOG_PATH, lines.join("\n") + "\n", { encoding: "utf-8" });
  }).catch(function () {}).then(function () {
    Services.startup.quit(Ci.nsIAppStartup.eForceQuit);
  });
}

function shutdown(data, reason) {}
function install(data, reason) {}
function uninstall(data, reason) {}
