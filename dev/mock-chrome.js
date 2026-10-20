'use strict';

// Заглушка chrome.* API для стенда dev/serve.py: дерево закладок берётся
// из window.HNTP_FIXTURE, раскладка колонок и настройки кладутся в
// localStorage при первом запуске (или с ?reset в адресе).
(function() {
	var fixture = window.HNTP_FIXTURE;
	var nextId = 0;
	var byId = {};
	var byTitle = {};

	function build(node, parentId, index) {
		var id = String(nextId++);
		var out = { id: id, title: node.title || '', index: index, dateAdded: Date.now() - nextId * 3600000 };
		if (parentId != null) out.parentId = parentId;
		if (node.url) out.url = node.url;
		byId[id] = out;
		if (node.children) {
			byTitle[node.title] = id;
			out.children = node.children.map(function(child, i) {
				return build(child, id, i);
			});
		}
		return out;
	}

	var root = build({ title: '', children: fixture.tree }, null, 0);

	function clone(node) {
		return node && JSON.parse(JSON.stringify(node));
	}

	function later(callback, value) {
		if (callback) setTimeout(function() { callback(value); }, 0);
	}

	function event() {
		var listeners = [];
		return {
			addListener: function(fn) { listeners.push(fn); },
			fire: function() {
				var args = arguments;
				listeners.forEach(function(fn) { setTimeout(function() { fn.apply(null, args); }, 0); });
			}
		};
	}

	function reindex(parent) {
		parent.children.forEach(function(child, i) { child.index = i; });
	}

	function detach(node) {
		var parent = byId[node.parentId];
		parent.children.splice(parent.children.indexOf(node), 1);
		reindex(parent);
	}

	function forget(node) {
		delete byId[node.id];
		(node.children || []).forEach(forget);
	}

	var bookmarks = {
		onCreated: event(), onRemoved: event(), onChanged: event(), onMoved: event(),
		onChildrenReordered: event(), onImportEnded: event(),
		getTree: function(callback) { later(callback, [clone(root)]); },
		getSubTree: function(id, callback) {
			later(callback, byId[id] ? [clone(byId[id])] : undefined);
		},
		getRecent: function(count, callback) {
			var items = Object.keys(byId).map(function(id) { return byId[id]; })
				.filter(function(node) { return node.url; })
				.sort(function(a, b) { return b.dateAdded - a.dateAdded; })
				.slice(0, count);
			later(callback, items.map(clone));
		},
		update: function(id, changes, callback) {
			var node = byId[id];
			if (changes.title != null) node.title = changes.title;
			if (changes.url != null && node.url) node.url = changes.url;
			bookmarks.onChanged.fire(id, changes);
			later(callback, clone(node));
		},
		move: function(id, destination, callback) {
			var node = byId[id];
			var parent = byId[destination.parentId];
			var index = destination.index == null ? parent.children.length : destination.index;
			if (node.parentId === parent.id && node.index < index) index--;
			detach(node);
			node.parentId = parent.id;
			parent.children.splice(index, 0, node);
			reindex(parent);
			bookmarks.onMoved.fire(id, {});
			later(callback, clone(node));
		},
		remove: function(id, callback) {
			detach(byId[id]);
			forget(byId[id]);
			bookmarks.onRemoved.fire(id, {});
			later(callback);
		},
		removeTree: function(id, callback) { bookmarks.remove(id, callback); }
	};

	var chrome = window.chrome || {};
	window.chrome = chrome;
	chrome.bookmarks = bookmarks;
	chrome.runtime = { lastError: undefined };
	chrome.topSites = { get: function(callback) { later(callback, fixture.topSites || []); } };
	chrome.sessions = {
		onChanged: event(),
		getRecentlyClosed: function(options, callback) { later(callback, []); },
		getDevices: function(options, callback) { later(callback, []); },
		restore: function(id, callback) { later(callback); }
	};
	chrome.tabs = {
		getCurrent: function(callback) { later(callback, { id: 1 }); },
		create: function(props) { console.info('tabs.create', props); },
		update: function(id, props) { console.info('tabs.update', props); }
	};
	chrome.windows = { create: function(props) { console.info('windows.create', props); } };
	chrome.fontSettings = {
		getFontList: function(callback) {
			later(callback, ['Helvetica Neue', 'Inter', 'Menlo', 'PT Serif'].map(function(name) {
				return { fontId: name, displayName: name };
			}));
		}
	};

	// раскладка колонок, открытые папки и настройки — один раз на версию стенда
	var seed = 'fixture.' + fixture.version;
	if (location.search.indexOf('reset') > -1 || localStorage.getItem('dev.seed') !== seed) {
		localStorage.clear();
		fixture.columns.forEach(function(column, x) {
			column.forEach(function(title, y) {
				localStorage.setItem('column.' + x + '.' + y, byTitle[title]);
			});
		});
		(fixture.open || []).forEach(function(title) {
			localStorage.setItem('open.' + byTitle[title], true);
		});
		root.children.forEach(function(node) {
			localStorage.setItem('options.show_' + node.id, 0);
		});
		Object.keys(fixture.options || {}).forEach(function(key) {
			localStorage.setItem('options.' + key, fixture.options[key]);
		});
		localStorage.setItem('dev.seed', seed);
	}
})();
