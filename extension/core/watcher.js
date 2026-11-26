// Reloadable module: polled with a cache-busting query by core/main.js.
// UXP has no native file watcher, so this is a recursive mtime scan.
"use strict";

var PM_EXT_WATCHER = (function () {
  const { classes: Cc, interfaces: Ci } = Components;

  const POLL_MS = 800;
  // Wait for a quiet poll before reloading, so a multi-file save reloads once.
  const DEBOUNCE_MS = 400;
  const IGNORED_DIRS = { ".git": true, "node_modules": true };
  const WATCHED_EXTENSIONS = {
    js: true, xul: true, xml: true, rdf: true, css: true,
    manifest: true, html: true, dtd: true, properties: true, json: true
  };

  let timer = null;
  let dir = null;
  let onChange = null;
  let onError = null;
  let snapshot = null;
  let pending = [];
  let pendingSince = 0;
  let ignoreRules = [];

  function escapeRegex(character) {
    return character.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }

  // Rooted globs match the path; bare globs match the file name at any depth.
  function globSource(pattern) {
    let source = "";
    for (let index = 0; index < pattern.length; index++) {
      const character = pattern.charAt(index);
      if (character === "*") {
        if (pattern.charAt(index + 1) === "*") {
          source += ".*";
          index++;
        } else {
          source += "[^/]*";
        }
      } else if (character === "?") {
        source += "[^/]";
      } else {
        source += escapeRegex(character);
      }
    }
    return source;
  }

  function compileRule(value) {
    if (typeof value !== "string") return null;
    const pattern = value.trim();
    if (!pattern) return null;
    if (pattern.slice(-3) === "/**") return { prefix: pattern.slice(0, -3) };
    if (pattern.charAt(pattern.length - 1) === "/") {
      return { prefix: pattern.slice(0, -1) };
    }
    return {
      regex: new RegExp("^" + globSource(pattern) + "$"),
      rooted: pattern.indexOf("/") !== -1
    };
  }

  function matchesRule(rule, relative) {
    if (rule.prefix) {
      return relative === rule.prefix || relative.indexOf(rule.prefix + "/") === 0;
    }
    const subject = rule.rooted ? relative : relative.slice(relative.lastIndexOf("/") + 1);
    return rule.regex.test(subject);
  }

  function isIgnored(relative) {
    for (let index = 0; index < ignoreRules.length; index++) {
      if (matchesRule(ignoreRules[index], relative)) return true;
    }
    return false;
  }

  function isWatched(file) {
    const name = file.leafName;
    const dot = name.lastIndexOf(".");
    if (dot === -1) return WATCHED_EXTENSIONS[name] === true; // chrome.manifest
    return WATCHED_EXTENSIONS[name.slice(dot + 1).toLowerCase()] === true;
  }

  function scan(current, found, prefix) {
    const entries = current.directoryEntries;
    while (entries.hasMoreElements()) {
      const entry = entries.getNext().QueryInterface(Ci.nsIFile);
      const relative = prefix ? prefix + "/" + entry.leafName : entry.leafName;
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS[entry.leafName] && !isIgnored(relative)) {
          scan(entry, found, relative);
        }
      } else if (!isIgnored(relative) && isWatched(entry)) {
        found[entry.path] = entry.lastModifiedTime;
      }
    }
  }

  function differences(before, after) {
    const changed = [];
    for (const path in after) {
      if (before[path] !== after[path]) changed.push(path);
    }
    for (const path in before) {
      if (!(path in after)) changed.push(path);
    }
    return changed;
  }

  function tick() {
    const next = {};
    try {
      scan(dir, next, "");
    } catch (error) {
      // stop() clears the callbacks, so report before tearing down.
      const report = onError;
      stop();
      report("scan failed: " + error);
      return;
    }
    // The first scan is the baseline; changes that happened before it are not events.
    if (!snapshot) {
      snapshot = next;
      return;
    }
    const changed = differences(snapshot, next);
    snapshot = next;
    if (changed.length) {
      pending = changed;
      pendingSince = Date.now();
      return;
    }
    if (pendingSince && Date.now() - pendingSince >= DEBOUNCE_MS) {
      const files = pending;
      pending = [];
      pendingSince = 0;
      onChange(files);
    }
  }

  function start(directory, changeCallback, errorCallback, options) {
    stop();
    dir = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    dir.initWithPath(directory);
    onChange = changeCallback;
    onError = errorCallback || function () {};
    const ignored = options && options.ignore;
    if (Array.isArray(ignored)) {
      for (let index = 0; index < ignored.length; index++) {
        const rule = compileRule(ignored[index]);
        if (rule) ignoreRules.push(rule);
      }
    }
    snapshot = null;
    pending = [];
    pendingSince = 0;
    timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
    timer.initWithCallback(tick, POLL_MS, Ci.nsITimer.TYPE_REPEATING_SLACK);
    return { stop: stop };
  }

  function stop() {
    if (timer) {
      timer.cancel();
      timer = null;
    }
    dir = null;
    onChange = null;
    onError = null;
    snapshot = null;
    pending = [];
    pendingSince = 0;
    ignoreRules = [];
  }

  return { start: start, stop: stop };
})();
