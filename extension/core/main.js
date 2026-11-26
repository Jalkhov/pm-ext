// Reloadable module: this file is re-evaluated on every reload, with a fresh
// scope. It must not assume any previous state survived.
"use strict";

var PM_EXT_BUILD = "v3";

var PM_EXT_CORE = (function () {
  const { classes: Cc, interfaces: Ci, utils: Cu } = Components;
  const { OS } = Cu.import("resource://gre/modules/osfile.jsm", {});
  const { AddonManager } = Cu.import("resource://gre/modules/AddonManager.jsm", {});

  // A proxy add-on opts into watching by having this file at its source root.
  const PROJECT_FILE = "pm-ext.json";
  const XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
  // Disabling is async: wait at least a beat for the old scope to unload, then
  // poll until the target reports itself inactive before enabling it again.
  const REENABLE_MIN_MS = 1000;
  const SETTLE_MS = 200;
  const SETTLE_TRIES = 15;

  let host = null;
  let alive = false;
  let refreshTimer = null;
  let watcherModule = null;
  let projects = [];
  let projectsSignature = "";
  let reloadTimers = {};

  function text(id) {
    const win = host.getPanel();
    if (!win) return null;
    return win.document.getElementById(id);
  }

  function statusLine() {
    const version = "Pale Moon " + host.appVersion + " (UXP " + host.platformVersion + ")";
    if (!host.compatible) {
      return "\u26a0 " + version + " is below the supported minimum " + host.minVersion +
        ". Reload is disabled.";
    }
    return version + " \u00b7 core " + PM_EXT_BUILD + " \u00b7 watching " + projects.length;
  }

  function setText(id, value) {
    const node = text(id);
    if (node) node.value = value;
  }

  function render() {
    if (!host || !host.getPanel()) return;
    setText("pmext-status", statusLine());
    setText("pmext-build", "build " + PM_EXT_BUILD);
    setText("pmext-log", host.logMessages.join("\n"));
    renderProjects();
    bind("pmext-reload", function () {
      host.log("reload requested from the panel");
      host.reload();
    });
    bind("pmext-register", registerProject);
    bind("pmext-unregister", unregisterProject);
  }

  // Assigning oncommand (instead of addEventListener) keeps one handler per
  // render and survives the element being reused across panel openings.
  function bind(id, handler) {
    const button = text(id);
    if (!button) return;
    button.disabled = !host.compatible;
    button.oncommand = handler;
  }

  function projectState(project) {
    return project.active ? "watching" : "restart to load";
  }

  function renderProjects() {
    const list = text("pmext-projects");
    if (!list) return;
    const signature = projects.map(function (project) {
      return project.id + ":" + project.active + ":" + project.dir;
    }).join("|");
    // The panel re-renders every 800 ms; rebuilding the list would drop the
    // selection under the user and reset the scroll position.
    if (signature === projectsSignature) return;
    projectsSignature = signature;
    const doc = list.ownerDocument;
    while (list.firstChild) list.removeChild(list.firstChild);
    projects.forEach(function (project) {
      const item = doc.createElementNS(XUL_NS, "listitem");
      item.setAttribute("label", project.id + " \u00b7 " + projectState(project) +
        " \u00b7 " + project.dir);
      item.setAttribute("value", project.id);
      list.appendChild(item);
    });
  }

  function localFile(path) {
    const file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    file.initWithPath(path);
    return file;
  }

  function loadWatcher() {
    const file = localFile(host.sourceDir);
    file.append("core");
    file.append("watcher.js");
    if (!file.exists()) return null;
    const uri = Cc["@mozilla.org/network/io-service;1"]
      .getService(Ci.nsIIOService).newFileURI(file).spec + "?v=" + Date.now();
    const scope = {};
    Cc["@mozilla.org/moz/jssubscript-loader;1"]
      .getService(Ci.mozIJSSubScriptLoader).loadSubScript(uri, scope);
    return scope.PM_EXT_WATCHER || null;
  }

  function extensionsDir() {
    const dir = Cc["@mozilla.org/file/directory_service;1"]
      .getService(Ci.nsIProperties).get("ProfD", Ci.nsIFile);
    dir.append("extensions");
    return dir;
  }

  function addonState(id) {
    // UXP's AddonManager is callback-only (no promise API).
    return new Promise(function (resolve) {
      AddonManager.getAddonByID(id, function (addon) {
        resolve(addon ? addon.isActive : false);
      });
    });
  }

  function readProjects() {
    const dir = extensionsDir();
    if (!dir.exists() || !dir.isDirectory()) return Promise.resolve([]);
    const proxies = [];
    const entries = dir.directoryEntries;
    while (entries.hasMoreElements()) {
      const entry = entries.getNext().QueryInterface(Ci.nsIFile);
      if (entry.isDirectory() || entry.leafName === host.addonID ||
          entry.leafName.charAt(0) === ".") {
        continue;
      }
      proxies.push(entry);
    }
    return Promise.all(proxies.map(function (entry) {
      return OS.File.read(entry.path, { encoding: "utf-8" }).then(function (path) {
        path = path.trim();
        if (!path) return null;
        const marker = localFile(path);
        marker.append(PROJECT_FILE);
        if (!marker.exists()) return null;
        return addonState(entry.leafName).then(function (active) {
          return { id: entry.leafName, dir: path, active: active, watcher: null };
        });
      }, function () {
        return null;
      });
    })).then(function (found) {
      return found.filter(Boolean);
    });
  }

  function addonIDFrom(directory) {
    const file = localFile(directory);
    file.append("install.rdf");
    if (!file.exists()) return Promise.resolve(null);
    return OS.File.read(file.path, { encoding: "utf-8" }).then(function (text) {
      // The first <em:id> is the add-on's; targetApplication declares its own.
      const match = /<em:id>\s*([^<\s]+)\s*<\/em:id>/.exec(text);
      return match ? match[1] : null;
    });
  }

  function registerProject() {
    host.log("register: choose a project folder");
    let picker;
    try {
      picker = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
      picker.init(host.getPanel(), "Select a pm-ext project folder",
        Ci.nsIFilePicker.modeGetFolder);
      if (picker.show() !== Ci.nsIFilePicker.returnOK || !picker.file) return;
    } catch (error) {
      host.log("register failed: " + error);
      return;
    }
    addProject(picker.file.path);
  }

  function addProject(directory) {
    const marker = localFile(directory);
    marker.append(PROJECT_FILE);
    if (!marker.exists()) {
      host.log("register: " + directory + " has no " + PROJECT_FILE);
      return;
    }
    addonIDFrom(directory).then(function (id) {
      if (!alive) return;
      if (!id || /[\/\\]/.test(id) || id.charAt(0) === ".") {
        host.log("register: cannot read the add-on id from install.rdf");
        return;
      }
      const proxy = extensionsDir();
      proxy.append(id);
      if (proxy.exists()) {
        host.log("register: " + id + " is already registered");
        return;
      }
      return OS.File.writeAtomic(proxy.path, directory, { encoding: "utf-8" })
        .then(function () {
          host.log("register: " + id + "; restart Pale Moon to load it");
          return refreshProjects();
        });
    }).catch(function (error) {
      host.log("register failed: " + error);
    });
  }

  function selectedProject() {
    const list = text("pmext-projects");
    if (!list || !list.selectedItem) return null;
    const id = list.selectedItem.value;
    for (let i = 0; i < projects.length; i++) {
      if (projects[i].id === id) return projects[i];
    }
    return null;
  }

  function unregisterProject() {
    const project = selectedProject();
    if (!project) {
      host.log("unregister: select a project first");
      return;
    }
    const proxy = extensionsDir();
    proxy.append(project.id);
    OS.File.remove(proxy.path).then(function () {
      if (!alive) return;
      host.log("unregister: " + project.id + "; restart Pale Moon to unload it");
      return refreshProjects();
    }).catch(function (error) {
      host.log("unregister failed: " + error);
    });
  }

  function startWatcher(project) {
    project.watcher = watcherModule.start(
      project.dir,
      function (files) {
        reloadProject(project, files);
      },
      function (message) {
        host.log("watch: " + project.id + ": " + message);
      }
    );
  }

  function reloadProject(project, files) {
    AddonManager.getAddonByID(project.id, function (addon) {
      if (!alive) return;
      if (!addon) return host.log("watch: " + project.id + " is not installed");
      if (!addon.isActive) return host.log("watch: " + project.id + " is inactive; change ignored");
      if (reloadTimers[project.id]) return; // one toggle at a time
      host.log("watch: " + files.length + " change(s) in " + project.id + " -> reload");
      addon.userDisabled = true;
      settleThenEnable(addon, project.id, 0);
    });
  }

  // shortcut: fixed poll instead of AddonManager events; revisit if targets
  // take longer than ~4 s to shut down.
  function settleThenEnable(addon, id, attempt) {
    if (!alive) return;
    const timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
    reloadTimers[id] = timer;
    timer.initWithCallback(function () {
      if (!alive) return;
      if (addon.isActive && attempt < SETTLE_TRIES) {
        settleThenEnable(addon, id, attempt + 1);
        return;
      }
      delete reloadTimers[id];
      addon.userDisabled = false;
      host.log("watch: " + id + " enabled");
      render();
    }, attempt === 0 ? REENABLE_MIN_MS : SETTLE_MS, Ci.nsITimer.TYPE_ONE_SHOT);
  }

  function stopWatchers() {
    projects.forEach(function (project) {
      if (project.watcher) project.watcher.stop();
    });
    projects = [];
  }

  function refreshProjects() {
    stopWatchers();
    render();
    return readProjects().then(function (found) {
      if (!alive) return;
      found.forEach(function (project) {
        if (project.active) startWatcher(project);
      });
      projects = found;
      const ids = found.filter(function (project) { return project.active; })
        .map(function (project) { return project.id; });
      host.log("watch: " + ids.length + " project(s) watched" +
        (ids.length ? ": " + ids.join(", ") : ""));
      render();
    }).catch(function (error) {
      host.log("watch: project discovery failed: " + error);
    });
  }

  function startWatching() {
    watcherModule = loadWatcher();
    if (!watcherModule) {
      host.log("watch: core/watcher.js not found; nothing is watched");
      return;
    }
    refreshProjects();
  }

  function startup(nextHost) {
    host = nextHost;
    alive = true;
    host.log("core started build=" + PM_EXT_BUILD + " compatible=" + host.compatible);
    render();
    const timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
    timer.initWithCallback(render, 800, Ci.nsITimer.TYPE_REPEATING_SLACK);
    refreshTimer = timer;
    if (host.compatible) startWatching();
  }

  function onPanelOpened() {
    if (!host) return;
    host.log("panel rendered build=" + PM_EXT_BUILD);
    render();
  }

  function shutdown() {
    alive = false;
    if (refreshTimer) {
      refreshTimer.cancel();
      refreshTimer = null;
    }
    stopWatchers();
    for (const id in reloadTimers) reloadTimers[id].cancel();
    reloadTimers = {};
    watcherModule = null;
    host = null;
  }

  return { startup: startup, shutdown: shutdown, onPanelOpened: onPanelOpened };
})();
