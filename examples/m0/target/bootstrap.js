// Throwaway bootstrapped add-on for the pm-ext M0 proof of concept.
// Proves: proxy-file install, chrome.manifest registration, and re-execution
// of this file from disk on disable/enable (no browser restart).

const { interfaces: Ci, utils: Cu } = Components;
const { Services } = Cu.import("resource://gre/modules/Services.jsm", {});
const { OS } = Cu.import("resource://gre/modules/osfile.jsm", {});

// The driver rewrites this value between disable and enable.
const BUILD = "v1";

const REASONS = {
  1: "APP_STARTUP",
  2: "APP_SHUTDOWN",
  3: "ADDON_ENABLE",
  4: "ADDON_DISABLE",
  5: "ADDON_INSTALL",
  6: "ADDON_UNINSTALL",
  7: "ADDON_UPGRADE",
  8: "ADDON_DOWNGRADE"
};

function writeLastEvent(event, reason) {
  const path = Services.dirsvc.get("ProfD", Ci.nsIFile).path + "/m0-target-last.log";
  const line = event + " build=" + BUILD + " reason=" + (REASONS[reason] || "?") + "\n";
  return OS.File.writeAtomic(path, line, { encoding: "utf-8" });
}

function startup(data, reason) {
  writeLastEvent("startup", reason);
}

function shutdown(data, reason) {
  writeLastEvent("shutdown", reason);
}

function install(data, reason) {}
function uninstall(data, reason) {}
