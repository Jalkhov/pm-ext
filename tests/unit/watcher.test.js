// Unit tests for the reloadable watcher. The real extension/core/watcher.js is
// loaded into a vm context; nsIFile/nsITimer are faked so ticks are deterministic.
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ROOT = "/project";
const WATCHER_SOURCE = fs.readFileSync(
  path.join(__dirname, "..", "..", "extension", "core", "watcher.js"),
  "utf-8"
);

function enumerator(items) {
  let index = 0;
  return {
    hasMoreElements: function () { return index < items.length; },
    getNext: function () { return items[index++]; }
  };
}

function createFixture(files) {
  const nodes = new Map();
  const fixture = { nodes: nodes, failScan: false };

  function ensureDirectory(directory) {
    if (directory === "/" || directory === "") return null;
    if (nodes.has(directory)) return nodes.get(directory);
    const node = {
      path: directory,
      leafName: directory.slice(directory.lastIndexOf("/") + 1),
      children: [],
      isDirectory: function () { return true; },
      QueryInterface: function () { return this; }
    };
    Object.defineProperty(node, "directoryEntries", {
      get: function () {
        if (fixture.failScan) throw new Error("unreadable directory");
        return enumerator(node.children);
      }
    });
    nodes.set(directory, node);
    const parent = ensureDirectory(path.posix.dirname(directory));
    if (parent) parent.children.push(node);
    return node;
  }

  ensureDirectory(ROOT);
  for (const relative in files) {
    const full = ROOT + "/" + relative;
    const node = {
      path: full,
      leafName: relative.slice(relative.lastIndexOf("/") + 1),
      lastModifiedTime: files[relative],
      isDirectory: function () { return false; },
      QueryInterface: function () { return this; }
    };
    nodes.set(full, node);
    ensureDirectory(path.posix.dirname(full)).children.push(node);
  }
  return fixture;
}

function createClock() {
  const clock = { now: 1000 };
  class FakeDate extends Date {
    static now() { return clock.now; }
  }
  clock.Date = FakeDate;
  return clock;
}

function createHarness(files) {
  const fixture = createFixture(files);
  const clock = createClock();
  const timers = [];

  const context = {
    Date: clock.Date,
    Components: {
      classes: {
        "@mozilla.org/file/local;1": {
          createInstance: function () {
            const handle = {};
            handle.initWithPath = function (directory) {
              const node = fixture.nodes.get(directory);
              if (!node) throw new Error("missing fixture path " + directory);
              handle.path = node.path;
              handle.leafName = node.leafName;
              handle.isDirectory = node.isDirectory;
              Object.defineProperty(handle, "directoryEntries", {
                get: function () { return node.directoryEntries; }
              });
            };
            return handle;
          }
        },
        "@mozilla.org/timer;1": {
          createInstance: function () {
            return {
              cancelled: false,
              callback: null,
              initWithCallback: function (callback) {
                this.callback = callback;
                timers.push(this);
              },
              cancel: function () {
                this.cancelled = true;
                this.callback = null;
              }
            };
          }
        }
      },
      interfaces: {
        nsIFile: {},
        nsITimer: { TYPE_REPEATING_SLACK: 1, TYPE_ONE_SHOT: 2 }
      }
    }
  };

  vm.createContext(context);
  vm.runInContext(WATCHER_SOURCE, context, { filename: "watcher.js" });

  return {
    fixture: fixture,
    clock: clock,
    timers: timers,
    watcher: context.PM_EXT_WATCHER,
    poll: function () {
      for (const timer of timers) {
        if (timer.callback) timer.callback();
      }
    }
  };
}

// Arrays cross the vm realm boundary, so they never share Array.prototype.
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function quietProject() {
  return {
    "main.js": 100,
    "LEGACY.JS": 100,
    "chrome.manifest": 100,
    "sub/style.css": 100,
    ".git/ignored.js": 100,
    "node_modules/pkg.js": 100,
    "notes.md": 100
  };
}

test("the first poll is a baseline and reports nothing", function () {
  const harness = createHarness(quietProject());
  const changes = [];
  harness.watcher.start(ROOT, function (files) { changes.push(files); }, function () {});

  assert.equal(harness.timers.length, 1);
  harness.poll();
  harness.clock.now += 5000;
  harness.poll();

  assert.deepEqual(plain(changes), []);
});

test("reports a changed file once, after the debounce", function () {
  const harness = createHarness(quietProject());
  const changes = [];
  harness.watcher.start(ROOT, function (files) { changes.push(files); }, function () {});
  harness.poll();

  harness.fixture.nodes.get(ROOT + "/main.js").lastModifiedTime = 200;
  harness.poll();
  assert.deepEqual(plain(changes), [], "must wait for a quiet poll");

  harness.poll();
  assert.deepEqual(plain(changes), [], "must wait out the debounce window");

  harness.clock.now += 500;
  harness.poll();
  assert.deepEqual(plain(changes), [[ROOT + "/main.js"]]);

  harness.clock.now += 5000;
  harness.poll();
  assert.equal(changes.length, 1, "reported only once");
});

test("ignores .git, node_modules and unwatched file types", function () {
  const harness = createHarness(quietProject());
  const changes = [];
  harness.watcher.start(ROOT, function (files) { changes.push(files); }, function () {});
  harness.poll();

  harness.fixture.nodes.get(ROOT + "/.git/ignored.js").lastModifiedTime = 200;
  harness.fixture.nodes.get(ROOT + "/node_modules/pkg.js").lastModifiedTime = 200;
  harness.fixture.nodes.get(ROOT + "/notes.md").lastModifiedTime = 200;
  harness.poll();
  harness.clock.now += 500;
  harness.poll();

  assert.deepEqual(plain(changes), []);
});

test("watches chrome.manifest, nested files and uppercase extensions", function () {
  const harness = createHarness(quietProject());
  const changes = [];
  harness.watcher.start(ROOT, function (files) { changes.push(files); }, function () {});
  harness.poll();

  harness.fixture.nodes.get(ROOT + "/chrome.manifest").lastModifiedTime = 200;
  harness.fixture.nodes.get(ROOT + "/sub/style.css").lastModifiedTime = 200;
  harness.fixture.nodes.get(ROOT + "/LEGACY.JS").lastModifiedTime = 200;
  harness.poll();
  harness.clock.now += 500;
  harness.poll();

  assert.deepEqual(
    plain(changes[0]).sort(),
    [ROOT + "/LEGACY.JS", ROOT + "/chrome.manifest", ROOT + "/sub/style.css"]
  );
});

test("reports deleted files", function () {
  const harness = createHarness(quietProject());
  const changes = [];
  harness.watcher.start(ROOT, function (files) { changes.push(files); }, function () {});
  harness.poll();

  const root = harness.fixture.nodes.get(ROOT);
  root.children = root.children.filter(function (node) {
    return node.path !== ROOT + "/main.js";
  });
  harness.fixture.nodes.delete(ROOT + "/main.js");
  harness.poll();
  harness.clock.now += 500;
  harness.poll();

  assert.deepEqual(plain(changes), [[ROOT + "/main.js"]]);
});

test("reports a scan failure and stops polling", function () {
  const harness = createHarness(quietProject());
  const errors = [];
  harness.watcher.start(ROOT, function () {}, function (message) { errors.push(message); });

  harness.fixture.failScan = true;
  harness.poll();

  assert.equal(errors.length, 1);
  assert.match(errors[0], /^scan failed: /);
  assert.equal(harness.timers[0].cancelled, true);
});

test("stop cancels the timer and drops the callbacks", function () {
  const harness = createHarness(quietProject());
  const changes = [];
  harness.watcher.start(ROOT, function (files) { changes.push(files); }, function () {});
  harness.poll();

  harness.watcher.stop();
  harness.fixture.nodes.get(ROOT + "/main.js").lastModifiedTime = 200;
  harness.clock.now += 5000;
  harness.poll();

  assert.equal(harness.timers[0].cancelled, true);
  assert.deepEqual(changes, []);
});
