// M0 test harness. Runs once at browser startup: reloads the target add-on by
// toggling userDisabled, rewrites its BUILD constant on disk in between, and
// checks that the new code runs. Writes a PASS/FAIL log and quits the browser.

const { classes: Cc, interfaces: Ci, utils: Cu } = Components;
const { Services } = Cu.import("resource://gre/modules/Services.jsm", {});
const { OS } = Cu.import("resource://gre/modules/osfile.jsm", {});
const { AddonManager } = Cu.import("resource://gre/modules/AddonManager.jsm", {});

const TARGET_ID = "pm-ext-m0-target@example.com";
const TARGET_CHROME_URL = "chrome://pm-m0-target/content/marker.txt";
const PROFILE = Services.dirsvc.get("ProfD", Ci.nsIFile).path;
const DRIVER_LOG = PROFILE + "/m0-driver.log";
const TARGET_LOG = PROFILE + "/m0-target-last.log";

const lines = [];

function log() {
  lines.push(Array.prototype.join.call(arguments, " "));
}

function sleep(ms) {
  return new Promise(resolve => {
    Cc["@mozilla.org/timer;1"]
      .createInstance(Ci.nsITimer)
      .initWithCallback(resolve, ms, Ci.nsITimer.TYPE_ONE_SHOT);
  });
}

async function readText(path) {
  try {
    return await OS.File.read(path, { encoding: "utf-8" });
  } catch (e) {
    return null;
  }
}

function writeText(path, text) {
  return OS.File.writeAtomic(path, text, { encoding: "utf-8" });
}

// UXP's AddonManager still uses the callback signature (no promises).
function getAddon(id) {
  return new Promise((resolve, reject) => {
    try {
      AddonManager.getAddonByID(id, resolve);
    } catch (e) {
      reject(e);
    }
  });
}

async function waitForTarget() {
  // On a fresh profile the target is installed (not loaded) during this same
  // session, so it may still be inactive when the driver starts.
  for (let attempt = 0; attempt < 20; attempt++) {
    const addon = await getAddon(TARGET_ID);
    if (addon && addon.isActive) {
      return addon;
    }
    await sleep(500);
  }
  throw new Error("target add-on not active: " + TARGET_ID);
}

function resolveChrome(url) {
  try {
    const registry = Cc["@mozilla.org/chrome/chrome-registry;1"]
      .getService(Ci.nsIXULChromeRegistry);
    return registry.convertChromeURL(Services.io.newURI(url, null, null)).spec;
  } catch (e) {
    return "ERROR: " + e;
  }
}

async function targetSourceDir() {
  const path = PROFILE + "/extensions/" + TARGET_ID;
  const text = await readText(path);
  if (!text) {
    throw new Error("proxy file not readable: " + path);
  }
  return text.trim();
}

async function setBuildConstant(dir, value) {
  const path = dir + "/bootstrap.js";
  const source = await readText(path);
  if (!source) {
    throw new Error("cannot read " + path);
  }
  const patched = source.replace(/const BUILD = "[^"]*";/, 'const BUILD = "' + value + '";');
  if (patched === source) {
    throw new Error('BUILD marker not found in ' + path);
  }
  await writeText(path, patched);
}

async function runTest() {
  log("driver pid=" + Services.appinfo.processID);
  log("profile=" + PROFILE);

  const addon = await waitForTarget();
  log("target loaded: " + addon.name + " " + addon.version +
      " userDisabled=" + addon.userDisabled + " isActive=" + addon.isActive);
  log("target log @startup: " + String(await readText(TARGET_LOG)).trim());
  log("chrome @startup: " + resolveChrome(TARGET_CHROME_URL));

  addon.userDisabled = true;
  await sleep(1000);
  log("after disable: userDisabled=" + addon.userDisabled + " isActive=" + addon.isActive);
  log("target log @disable: " + String(await readText(TARGET_LOG)).trim());

  const dir = await targetSourceDir();
  log("proxy file -> " + dir);
  const nonce = "v-" + Date.now();
  await setBuildConstant(dir, nonce);
  log("rewrote bootstrap.js BUILD to " + nonce);

  addon.userDisabled = false;
  await sleep(1500);
  log("after enable: userDisabled=" + addon.userDisabled + " isActive=" + addon.isActive);

  const finalLog = String(await readText(TARGET_LOG));
  log("target log @enable: " + finalLog.trim());
  log("chrome @reload: " + resolveChrome(TARGET_CHROME_URL));
  log("RESULT: " + (finalLog.indexOf("build=" + nonce) !== -1 ? "PASS" : "FAIL") +
      " (new code ran without restarting)");
}

function startup(data, reason) {
  // 1 = APP_STARTUP, 5 = ADDON_INSTALL (fresh profile).
  if (reason !== 1 && reason !== 5) {
    return;
  }
  runTest()
    .catch(error => log("RESULT: FAIL (" + error + ")"))
    .then(() => writeText(DRIVER_LOG, lines.join("\n") + "\n"))
    .then(() => Services.startup.quit(Ci.nsIAppStartup.eForceQuit));
}

function shutdown(data, reason) {}
function install(data, reason) {}
function uninstall(data, reason) {}
