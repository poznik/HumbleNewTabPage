'use strict';

// render a single bookmark node
function render(node, target) {
	if (node.description == 'separator') return;

	var li = document.createElement('li');
	var a = document.createElement('a');

	var url = node.url;
	if (url)
		a.href = url;
	else
		a.tabIndex = 0;

	var text = node.title || node.name || '';
	if (!text && node.title === null) text = node.url || '';
	// title in its own span: ellipsis works inside a flex row
	var title = document.createElement('span');
	title.className = 'title';
	title.innerText = text;
	a.appendChild(title);
	a.node = node;

	if (node.tooltip) a.title = node.tooltip;
	setClass(a, node);

	a.insertBefore(getIcon(node), a.firstChild);

	if (node.action) {
		a.onclick = function(event) {
			return node.action(event);
		};
	} else if (url) {
		var newtab = getConfig('newtab');
		if (newtab == 1) {
			// new foreground tab
			a.target = '_blank';
		} else if (newtab == 2) {
			// new background tab
			a.onclick = function(e) {
				openLink(node, newtab);
				return false;
			};
		}
		// fix opening chrome:// and file:/// urls
		var urlStart = url.substring(0, 6);
		if (urlStart === 'chrome' || urlStart === 'file:/'){
			a.onclick = function(e) {
				openLink(node, newtab || (e.ctrlKey ? 2 : 0));
				return false;
			};
			a.onauxclick = function(e) {
				if (e.button == 1) {
					openLink(node, 2);
					return false;
				}
			}
		}
	} else if (!node.children)
		a.style.pointerEvents = 'none';

	li.appendChild(a);

	// folder
	if (node.children) {
		// render children
		if (a.open || openFolders[node.id] || getConfig('remember_open') && localStorage.getItem('open.' + node.id)) {
			setClass(a, node, true);
			a.open = true;
			getChildrenFunction(node)(function(result) {
				renderAll(result, li);
			});
		}

		// click handlers
		addFolderHandlers(node, a);
		enableDragFolder(node, a);

	} else if (node.id == 'apps')
		enableDragFolder(node, a);
	else if (url && isEditable(node)) {
		addLinkHandlers(node, a);
		enableDragBookmark(node, a);
	}

	target.appendChild(li);
	return li;
}

// render an array of bookmark nodes
function renderAll(nodes, target, toplevel) {
	var ul = document.createElement('ul');
	for (var i = 0; i < nodes.length; i++) {
		var node = nodes[i];
		// skip extensions and duplicated child folders
		if (toplevel || !coords[node.id])
			render(node, ul);
	}
	// number of children next to the folder name
	if (!toplevel && target.tagName == 'LI')
		setCount(target.firstChild, ul.childNodes.length);
	if (ul.childNodes.length === 0)
		render({ id: 'empty', title: 'Пусто' }, ul);
	if (toplevel)
		target.appendChild(ul);
	else {
		// wrap child ul for animation
		var wrap = document.createElement('div');
		wrap.appendChild(ul);
		target.appendChild(wrap);
	}
	updateTooltips();
	return ul;
}

// render column with given index
function renderColumn(index, target) {
	var ids = columns[index];
	if (ids.length == 1 && !getConfig('show_root'))
		getChildrenFunction({id: ids[0]})(function(result) {
			renderAll(result, target);
			addColumnHandlers(index, target);
		});
	else if (ids.length > 0) {
		var i = 0;
		var nodes = [];
		// get all nodes for column
		var callback = function(result) {
			for (var j = 0; j < result.length; j++)
				nodes.push(result[j]);
			i++;
			if (i < ids.length)
				getSubTree(ids[i], callback);
			else {
				// render node list
				renderAll(nodes, target, true);
				addColumnHandlers(index, target);
			}
		};
		getSubTree(ids[i], callback);
	}
}

// render all columns to main div
function renderColumns() {
	// clear main div
	var target = document.getElementById('main');
	while (target.hasChildNodes())
		target.removeChild(target.lastChild);

	// render columns
	for (var i = 0; i < columns.length; i++) {
		var column = document.createElement('div');
		column.className = 'column';
		column.style.width = (1 / columns.length) * 100 + '%';

		// enable drag and drop
		enableDragColumn(i, column);

		target.appendChild(column);
		renderColumn(i, column);
	}

	enableDragDrop();
}

// enables click and context menu for given folder
function addFolderHandlers(node, a) {
	// click handler
	a.onclick = function() {
		toggle(node, a, getChildrenFunction(node));
		return false;
	};

	// context menu handler
	var items = getMenuItems(node);

	// column layout items
	if (!getConfig('lock')) {
		items.push(null);// spacer
		items.push({
			label: 'Новая колонка',
			action: function() {
				addColumn([node.id]);
			}
		});

		if (coords[node.id]) {
			var pos = coords[node.id];
			if (pos.y > 0)
				items.push({
					label: 'Переместить папку вверх',
					action: function() {
						addRow(node.id, pos.x, pos.y - 1);
					}
				});
			if (pos.y < columns[pos.x].length - 1)
				items.push({
					label: 'Переместить папку вниз',
					action: function() {
						addRow(node.id, pos.x, pos.y + 2);
					}
				});
			if (pos.x > 0)
				items.push({
					label: 'Переместить папку влево',
					action: function() {
						addRow(node.id, pos.x - 1);
					}
				});
			if (pos.x < columns.length - 1)
				items.push({
					label: 'Переместить папку вправо',
					action: function() {
						addRow(node.id, pos.x + 1);
					}
				});
			if (root.indexOf(node.id) < 0)
				items.push({
					label: 'Убрать папку со страницы',
					action: function() {
						removeRow(pos.x, pos.y);
					}
				});
		}
	}

	a.oncontextmenu = function(event) {
		renderMenu(items, event.pageX, event.pageY);
		return false;
	};
}

// enables context menu for given column
function addColumnHandlers(index, ul) {
	var items = [];
	var ids = columns[index];

	// single folder items
	if (ids.length == 1)
		items = getMenuItems({id: ids[0]});

	// column layout items
	if (!getConfig('lock') && columns.length > 1) {
		items.push(null);// spacer
		if (index > 0)
			items.push({
				label: 'Переместить колонку влево',
				action: function() {
					addColumn(ids, index - 1);
				}
			});
		if (index < columns.length - 1)
			items.push({
				label: 'Переместить колонку вправо',
				action: function() {
					addColumn(ids, index + 2);
				}
			});
		items.push({
			label: 'Убрать колонку',
			action: function() {
				removeColumn(index);
			}
		});
		if (ids.length == 1) {
			if (index > 0)
				items.push({
					label: 'Переместить папку влево',
					action: function() {
						addRow(ids[0], index - 1);
					}
				});
			if (index < columns.length - 1)
				items.push({
					label: 'Переместить папку вправо',
					action: function() {
						addRow(ids[0], index + 1);
					}
				});
		}
	}

	if (items.length > 0)
		ul.oncontextmenu = function(event) {
			if (event.target.tagName == 'A' || event.target.parentNode.tagName == 'A')
				return true;
			renderMenu(items, event.pageX, event.pageY);
			return false;
		};
}

// gets context menu items for given node
function getMenuItems(node) {
	var items = [];
		items.push({
			label: 'Открыть все ссылки из папки',
			action: function() {
				openLinks(node);
			}
		});
	if (node.id == 'closed')
		items.push({
			label: 'Очистить историю браузера',
			action: function() {
				openLink({ url: 'chrome://settings/clearBrowserData' }, 1);
			}
		});
	if (node.id == 'devices')
		items.push({
			label: 'История',
			action: function() {
				openLink({ url: 'chrome://history' }, 1);
			}
		});
	if (Number(node.id))
		items.push({
			label: 'Диспетчер закладок',
			action: function() {
				openLink({ url: 'chrome://bookmarks/?id=' + node.id }, 1);
			}
		});
	if (isEditable(node)) {
		items.push(null);// spacer
		items.push({
			label: 'Переименовать папку…',
			action: function() {
				editBookmark(node);
			}
		});
		items.push({
			label: 'Удалить папку…',
			action: function() {
				deleteBookmark(node);
			}
		});
	}
	return items;
}

// enables context menu for given bookmark link
function addLinkHandlers(node, a) {
	var items = [
		{
			label: 'Открыть в новой вкладке',
			action: function() {
				openLink(node, 1);
			}
		},
		{
			label: 'Открыть в фоновой вкладке',
			action: function() {
				openLink(node, 2);
			}
		},
		{
			label: 'Открыть в новом окне',
			action: function() {
				chrome.windows.create({ url: node.url });
			}
		},
		{
			label: 'Открыть в режиме инкогнито',
			action: function() {
				chrome.windows.create({ url: node.url, incognito: true });
			}
		},
		{
			label: 'Копировать адрес ссылки',
			action: function() {
				navigator.clipboard.writeText(node.url);
			}
		},
		null,// spacer
		{
			label: 'Изменить…',
			action: function() {
				editBookmark(node);
			}
		},
		{
			label: 'Удалить…',
			action: function() {
				deleteBookmark(node);
			}
		}
	];

	a.oncontextmenu = function(event) {
		renderMenu(items, event.pageX, event.pageY);
		return false;
	};
}

// returns true if id belongs to a real bookmark or folder
function isBookmarkId(id) {
	return Number(id) > 0;
}

// returns true if node can be renamed, moved and deleted
function isEditable(node) {
	return isBookmarkId(node.id) && node.parentId != null && node.parentId !== '0' && !node.unmodifiable;
}

// shows a dialog to rename a folder or edit a bookmark
function editBookmark(node) {
	var isFolder = !node.url;
	showDialog({
		heading: isFolder ? 'Переименовать папку' : 'Изменить закладку',
		name: node.title || '',
		url: isFolder ? null : node.url,
		ok: 'Сохранить'
	}, function(values) {
		var changes = { title: values.name };
		if (!isFolder)
			changes.url = values.url;
		chrome.bookmarks.update(node.id, changes, onBookmarkError);
	});
}

// asks for confirmation and deletes a bookmark or folder
function deleteBookmark(node) {
	if (node.url) {
		showDialog({
			heading: 'Удалить закладку',
			message: 'Удалить «' + (node.title || node.url) + '»?',
			ok: 'Удалить'
		}, function() {
			chrome.bookmarks.remove(node.id, onBookmarkError);
		});
		return;
	}
	chrome.bookmarks.getSubTree(node.id, function(result) {
		if (!result)
			return;
		var count = countBookmarks(result[0]);
		showDialog({
			heading: 'Удалить папку',
			message: 'Удалить папку «' + node.title + '»' +
				(count ? ' и всё, что в ней: ' + count + ' ' + plural(count, 'элемент', 'элемента', 'элементов') : '') + '?',
			ok: 'Удалить'
		}, function() {
			chrome.bookmarks.removeTree(node.id, onBookmarkError);
		});
	});
}

// русское склонение по числу: 1 вкладка, 3 вкладки, 5 вкладок
function plural(n, one, few, many) {
	var mod10 = n % 10, mod100 = n % 100;
	if (mod10 == 1 && mod100 != 11)
		return one;
	if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14))
		return few;
	return many;
}

// counts all bookmarks and folders inside given node
function countBookmarks(node) {
	var count = 0;
	if (node.children)
		for (var i = 0; i < node.children.length; i++)
			count += 1 + countBookmarks(node.children[i]);
	return count;
}

// reports failed bookmark operations
function onBookmarkError() {
	if (chrome.runtime.lastError)
		alert(chrome.runtime.lastError.message);
}

// shows a modal dialog and passes entered values to callback if confirmed
function showDialog(options, callback) {
	var dialog = document.getElementById('dialog');
	var message = document.getElementById('dialog_message');
	var name = document.getElementById('dialog_name');
	var url = document.getElementById('dialog_url');
	var ok = document.getElementById('dialog_ok');

	document.getElementById('dialog_heading').innerText = options.heading;
	message.innerText = options.message || '';
	message.hidden = !options.message;
	name.value = options.name || '';
	name.parentNode.hidden = options.name == null;
	url.value = options.url || '';
	url.required = options.url != null;
	url.parentNode.hidden = options.url == null;
	ok.innerText = options.ok || 'OK';

	document.getElementById('dialog_cancel').onclick = function() {
		dialog.close('cancel');
	};
	dialog.onclose = function() {
		if (dialog.returnValue == 'ok')
			callback({ name: name.value, url: url.value.trim() });
	};

	dialog.returnValue = '';
	dialog.showModal();
	if (options.name != null)
		name.select();
	else
		ok.focus();
}

// wraps click handler for menu items
function onMenuClick(item) {
	return function() {
		item.action();
		return false;
	};
}

// renders a popup menu at given coordinates
function renderMenu(items, x, y) {
	var ul = document.createElement('ul');
	ul.className = 'menu';
	for (var i = 0; i < items.length; i++) {
		var li = document.createElement('li');
		if (items[i]) {
			var a = document.createElement('a');
			a.innerText = items[i].label;
			a.tabIndex = 0;
			a.onclick = onMenuClick(items[i]);

			li.appendChild(a);
		} else if (i > 0 && i < items.length - 1)
			li.appendChild(document.createElement('hr'));
		else
			continue;

		ul.appendChild(li);
	}
	document.body.appendChild(ul);
	ul.style.left = Math.max(Math.min(x, window.innerWidth + window.scrollX - ul.clientWidth), 0) + 'px';
	ul.style.top = Math.max(Math.min(y, window.innerHeight + window.scrollY - ul.clientHeight), 0) + 'px';
	ul.onmousedown = function(event) {
		event.stopPropagation();
		return true;
	};

	setTimeout(function() {
		document.onclick = function() {
			closeMenu(ul);
			return true;
		};
		document.onmousedown = function() {
			closeMenu(ul);
			return true;
		};
		document.oncontextmenu = function() {
			closeMenu(ul);
			return true;
		};
		document.onkeydown = function(event) {
			if (event.keyCode == 27)
				closeMenu(ul);
			return true;
		};
	}, 20);
	return ul;
}

// removes the given popup menu
function closeMenu(ul) {
	document.body.removeChild(ul);
	document.onclick = null;
	document.onmousedown = null;
	document.oncontextmenu = null;
	document.onkeydown = null;
}

var dragIds;

// enable drag and drop of column
function enableDragColumn(id, column) {
	if (getConfig('lock'))
		return;

	column.draggable = true;

	column.ondragstart = function(event) {
		dragIds = columns[id];
		event.dataTransfer.effectAllowed = 'move';
		this.classList.add('dragstart');
	};
	column.ondragend = function(event) {
		dragIds = null;
		this.classList.remove('dragstart');
		clearDropTarget();
	};
}

var dropTarget;

// enable drag and drop of folder
function enableDragFolder(node, a) {
	if (getConfig('lock'))
		return;

	a.draggable = true;
	a.ondragstart = function(event) {
		dragIds = [node.id];
		// folders can also be moved into other folders
		if (isEditable(node)) {
			dragNode = node;
			dragElement = a;
		}
		event.stopPropagation();
		event.dataTransfer.effectAllowed = 'move copy';
		this.classList.add('dragstart');
	};
	a.ondragend = function(event) {
		dragIds = null;
		dragNode = null;
		dragElement = null;
		this.classList.remove('dragstart');
		clearDropTarget();
		cancelSpringOpen();
	};
}

var dragNode; // bookmark node being moved between folders
var dragElement;

// enable drag and drop of bookmark link
function enableDragBookmark(node, a) {
	if (getConfig('lock'))
		return;

	a.draggable = true;
	a.ondragstart = function(event) {
		dragNode = node;
		dragElement = a;
		event.stopPropagation();
		event.dataTransfer.effectAllowed = 'all';
		this.classList.add('dragstart');
	};
	a.ondragend = function(event) {
		dragNode = null;
		dragElement = null;
		this.classList.remove('dragstart');
		clearDropTarget();
		cancelSpringOpen();
	};
}

// gets where the dragged bookmark would be moved to, or null
function getBookmarkDrop(event) {
	if (!dragNode)
		return null;

	// find hovered link, whole row counts
	var a = event.target;
	if (a.tagName == 'LI')
		a = a.firstChild;
	while (a && a.tagName != 'A') {
		if (a.id == 'main')
			return null;
		a = a.parentNode;
	}
	if (!a || !a.node || a === dragElement)
		return null;
	// folder can't be moved into itself or its children
	if (dragElement && dragElement.parentNode.contains(a))
		return null;

	var node = a.node;
	var li = a.parentNode;
	var parent = getParentFolder(li);
	var inFolder = parent && isBookmarkId(parent.id);

	// drop into empty folder
	if (node.id == 'empty')
		return inFolder ? { a: a, li: li, node: node, mode: 'into', parentId: parent.id } : null;

	var rect = a.getBoundingClientRect();
	var pos = (event.clientY - rect.top) / rect.height;
	var isFolder = node.children && isBookmarkId(node.id) && !node.unmodifiable;
	var mode;
	if (isFolder)
		mode = pos < .25 ? 'before' : (pos > .75 && !a.open ? 'after' : 'into');
	else
		mode = pos < .5 ? 'before' : 'after';

	// can only reorder inside real folders (not column layout or recent lists)
	if (mode != 'into' && !(inFolder && node.index != null)) {
		// dragged folders fall back to column layout
		if (!isFolder || dragIds)
			return null;
		mode = 'into';
	}

	if (mode == 'into')
		return { a: a, li: li, node: node, mode: mode, parentId: node.id };
	return {
		a: a,
		li: li,
		node: node,
		mode: mode,
		parentId: node.parentId,
		index: node.index + (mode == 'after' ? 1 : 0)
	};
}

// gets bookmark folder that contains given list item
function getParentFolder(li) {
	var parent = li.parentNode.parentNode;
	if (!parent)
		return null;
	// skip animation wrapper
	if (parent.tagName == 'DIV' && !parent.classList.contains('column'))
		parent = parent.parentNode;
	if (parent.tagName == 'LI')
		return parent.firstChild.node;
	// single folder column shows folder contents only
	if (parent.classList.contains('column')) {
		var ids = columns[getDropX(parent)];
		if (ids && ids.length == 1 && !getConfig('show_root'))
			return { id: ids[0] };
	}
	return null;
}

// highlights bookmark drop position
function showBookmarkDrop(drop) {
	clearDropTarget();
	var color = getConfig('accent_color');
	if (drop.mode == 'into') {
		dropTarget = drop.a;
		drop.a.style.boxShadow = 'inset 0 0 0 2px ' + color;
		springOpen(drop.node, drop.a);
	} else {
		dropTarget = drop.li;
		if (drop.mode == 'before') {
			drop.li.style.borderTop = 'solid 2px ' + color;
			drop.li.style.margin = '-2px 0 0 0';
		} else {
			drop.li.style.borderBottom = 'solid 2px ' + color;
			drop.li.style.margin = '0 0 -2px 0';
		}
		cancelSpringOpen();
	}
}

// moves dragged bookmark to drop position
function moveBookmark(node, drop) {
	var destination = { parentId: drop.parentId };
	if (drop.index != null)
		destination.index = drop.index;
	chrome.bookmarks.move(node.id, destination, onBookmarkError);
}

var springTarget = null;
var springTimeout = null;

// opens closed folder after hovering over it while dragging
function springOpen(node, a) {
	if (springTarget === a)
		return;
	cancelSpringOpen();
	if (a.open || !node.children)
		return;
	springTarget = a;
	springTimeout = setTimeout(function() {
		springTimeout = null;
		if (!a.open)
			toggle(node, a);
	}, 700);
}

function cancelSpringOpen() {
	if (springTimeout)
		clearTimeout(springTimeout);
	springTimeout = null;
	springTarget = null;
}

// init drag and drop handlers
function enableDragDrop() {
	var main = document.getElementById('main');

	if (getConfig('lock')) {
		main.ondragover = null;
		main.ondragleave = null;
		main.ondrop = null;
		return;
	}

	main.ondragover = function(event) {
		event.preventDefault();
		event.dataTransfer.dropEffect = 'move';
		// move bookmark between folders
		var drop = getBookmarkDrop(event);
		if (drop) {
			showBookmarkDrop(drop);
			return false;
		}
		cancelSpringOpen();
		if (!dragIds) {
			clearDropTarget();
			event.dataTransfer.dropEffect = 'none';
			return false;
		}
		// change column layout
		// highlight drop target
		var target = getDropTarget(event);
		if (target) {
			clearDropTarget();
			dropTarget = target;
			var bordercss = 'solid 2px ' + getConfig('accent_color');
			if (target.tagName == 'LI' || target.tagName == 'UL') {
				if (isAbove(event.pageY, target)) {
					target.style.borderBottom = bordercss;
					target.style.margin = '0 0 -2px 0';
				} else {
					target.style.borderTop = bordercss;
					target.style.margin = '-2px 0 0 0';
				}
			} else if (target.className == 'column') {
				if (event.pageX - target.offsetLeft > target.clientWidth / 2) {
					target.style.borderRight = bordercss;
					target.style.margin = '0';
				} else {
					target.style.borderLeft = bordercss;
					target.style.margin = '0 2px 0 -2px';
				}
			}
		}
		return false;
	};

	main.ondragleave = function(event) {
		clearDropTarget();
	};

	main.ondrop = function(event) {
		event.stopPropagation();
		cancelSpringOpen();

		var drop = getBookmarkDrop(event);
		if (drop) {
			clearDropTarget();
			moveBookmark(dragNode, drop);
			return false;
		}

		var target = getDropTarget(event);
		if (!target)
			return false;

		// calculate drop coordinates
		var x = getDropX(target, event);
		var y = getDropY(target, event);

		if (dragIds.length == 1 && y != null)
			addRow(dragIds[0], x, y);
		else {
			if (event.pageX - target.offsetLeft > target.clientWidth / 2)
				x++;
			addColumn(dragIds, x);
		}

		return false;
	};
}

// gets proper drop target element
function getDropTarget(event) {
	if (!dragIds)
		return null;
	var target = event.target;
	if (target && (target.tagName == 'A' || target.parentNode.tagName == 'A') && dragIds.length == 1) {
		// get parent folder until toplevel
		while (target &&
			target.parentNode.parentNode &&
			target.parentNode.parentNode.className != 'column') {
			// target should be LI
			target = target.parentNode;
		}
		// if single-folder column, get the UL
		if (target && target.tagName == 'LI' &&
			columns[getDropX(target, event)].length == 1)
			target = target.parentNode;
		// target should be LI or UL by here...
	} else
		while (target && target.className != 'column')
			target = target.parentNode;// target column

	return target;
}

// gets x coordinate of drop target
function getDropX(target, event) {
	var x = null;
	while (target && target.className != 'column')
		target = target.parentNode;
	if (target) {
		x = 0;
		for (; target.previousSibling; x++)
			target = target.previousSibling;
	}
	return x;
}

// gets y coordinate of drop target
function getDropY(target, event) {
	var y = null;
	if (target.tagName == 'LI') {
		y = 0;
		if (isAbove(event.pageY, target))
			y++;
		for (; target.previousSibling; y++)
			target = target.previousSibling;
	} else if (target.tagName == 'UL') {
		y = 0;
		if (isAbove(event.pageY, target))
			y++;
	}
	return y;
}

// returns true if y position is above target element midpoint
function isAbove(pageY, target) {
	return pageY - window.scrollY - target.getBoundingClientRect().top > target.clientHeight / 2;
}

// clears droptarget styles
function clearDropTarget() {
	if (dropTarget) {
		dropTarget.style.border = null;
		dropTarget.style.margin = null;
		dropTarget.style.boxShadow = null;
	}
	dropTarget = null;
}

var tooltipTimeout = null;
// adds tootlips to truncated text
function updateTooltips() {
	if (tooltipTimeout) clearTimeout(tooltipTimeout);

	tooltipTimeout = setTimeout(function() {
		tooltipTimeout = null;
		var elements = document.querySelectorAll('#main li a > .title');
		for (var i = 0; i < elements.length; i++) {
			var element = elements[i];
			var a = element.parentNode;
			if (element.clientWidth + 1 < element.scrollWidth) {
				a.title = a.title || element.textContent;
			} else if (a.title === element.textContent) {
				a.title = '';
			}
		}
	}, 100);
}

// gets function that returns children of node
function getChildrenFunction(node) {
	switch(node.id) {
		case 'top':
			return function(callback) {
				if (chrome.topSites)
					chrome.topSites.get(function(result) {
						callback(result.slice(0, getConfig('number_top')));
					});
				else
					callback([]);
			};
		case 'recent':
			return function(callback) {
				chrome.bookmarks.getRecent(getConfig('number_recent'), function(result) {
					callback(result);
				});
			};
		case 'closed':
			return function(callback) {
				getClosed(function(result) {
					callback(result);
				});
			};
		case 'devices':
			return function(callback) {
				getDevices(function(result) {
					callback(result);
				});
			};
		default:
			if (node.children)
				return function(callback) {
					callback(node.children);
				};
			else
				return function(callback) {
					chrome.bookmarks.getSubTree(node.id, function(result) {
						if (result)
							callback(result[0].children);
						else {
							// remove missing bookmark locations
							if (coords[node.id])
								removeRow(coords[node.id].x, coords[node.id].y);
						}
					});
				};
	}
}

// gets the subtree for given id
function getSubTree(id, callback) {
	switch(id) {
		case 'top':
			callback([{ title: 'Часто посещаемые', id: 'top', children: true}]);
			break;
		case 'apps':
			callback([{ title: 'Приложения', id: 'apps', url: 'chrome://apps' }]);
			break;
		case 'recent':
			callback([{ title: 'Недавние закладки', id: 'recent', children: true }]);
			break;
		case 'closed':
			callback([{ title: 'Недавно закрытые', id: 'closed', children: true }]);
			break;
		case 'devices':
			callback([{ title: 'Другие устройства', id: 'devices', children: true }]);
			break;
		default:
			chrome.bookmarks.getSubTree(id, function(result) {
				if (result)
					callback(result);
				else {
					// remove missing bookmark locations
					if (coords[id])
						removeRow(coords[id].x, coords[id].y);
				}
			});
	}
}

// sets css classes for node
function setClass(target, node, isopen) {
	if (node.className)
		target.classList.add(node.className);
	if (node.children) {
		target.classList.add('folder');
		target.setAttribute('role', 'button');
		target.setAttribute('aria-expanded', isopen ? 'true' : 'false');
	}
	if (isopen)
		target.classList.add('open');
	else
		target.classList.remove('open');

	switch(node.id) {
		case 'top':
		case 'apps':
		case 'recent':
		case 'closed':
		case 'devices':
		case 'empty':
			target.classList.add(node.id);
	}
}

// shows number of children after folder title
function setCount(a, count) {
	var span = a.getElementsByClassName('count')[0];
	if (!count) {
		if (span) a.removeChild(span);
		return;
	}
	if (!span) {
		span = document.createElement('span');
		span.className = 'count';
		a.appendChild(span);
	}
	span.textContent = count;
}

// gets best icon for a node
function getIcon(node) {
	var url = null,
		url2x = null;
	if (node.icons) {
		var size;
		for (var i in node.icons) {
			var iconInfo = node.icons[i];
			if (iconInfo.url && (!size || (iconInfo.size < size && iconInfo.size > 15))) {
				url = iconInfo.url;
				if (iconInfo.size > 31) url2x = iconInfo.url;
				size = iconInfo.size;
			}
		}
	} else if (node.icon) {
		url = node.icon;
	} else if (node.url) {
		url = `/_favicon/?pageUrl=${encodeURIComponent(node.url)}&size=16`;
		url2x = `/_favicon/?pageUrl=${encodeURIComponent(node.url)}&size=32`;
	}

	var icon = document.createElement(url ? 'img' : 'div');
	icon.className = 'icon';
	icon.src = url;
	if (url2x) icon.srcset = url2x + ' 2x';
	icon.alt = ' ';
	return icon;
}

// folders opened on this page, kept open when bookmarks are refreshed
var openFolders = {};

// toggle folder open state
function toggle(node, a) {
	var isopen = a.open;
	setClass(a, node, !isopen);
	a.open = !isopen;
	if (isopen) {
		// close folder
		localStorage.removeItem('open.' + node.id);
		delete openFolders[node.id];
		if (a.nextSibling){
			// auto-close child folders
			if (getConfig('auto_close')) {
				var children = (a.nextSibling.tagName == 'DIV' ? a.nextSibling.firstChild : a.nextSibling).children;
				for (var i=0; i<children.length; i++) {
					var child = children[i].firstChild;
					if (child.open)
						child.onclick();
				}
			}
			// close folder
			animate(node, a, isopen);
		}
	} else {
		// open folder
		localStorage.setItem('open.' + node.id, true);
		openFolders[node.id] = true;
		// auto-close sibling folders
		if (getConfig('auto_close')) {
			var siblings = a.parentNode.parentNode.children;
			for (var i=0; i<siblings.length; i++) {
				var sibling = siblings[i].firstChild;
				if (sibling != a && sibling.open)
					sibling.onclick();
			}
		}
		// open folder
		if (a.nextSibling)
			animate(node, a, isopen);
		else
			getChildrenFunction(node)(function(result) {
				if (!a.nextSibling && a.open) {
					renderAll(result, a.parentNode);
					animate(node, a, isopen);
				}
			});
	}
}

// smoothly open or close folder
function animate(node, a, isopen) {
	// TODO: fix nested animations
	// wrapper needed for inner height value
	var wrap = a.nextSibling;
	if (a.animationHandle) {
		// clear last animation
		clearTimeout(a.animationHandle);
		a.animationHandle = null;
	} else {
		// start animation
		wrap.style.height = isopen ? wrap.firstChild.clientHeight + 'px' : 0;
		wrap.style.opacity = isopen ? 1 : 0;
	}
	// requestAnimationFrame twice to ensure at least one frame has passed
	requestAnimationFrame(function() {
		requestAnimationFrame(function() {
			if (wrap) {
				wrap.className = 'wrap';
				wrap.style.height = isopen ? 0 : wrap.firstChild.clientHeight + 'px';
				wrap.style.opacity = isopen ? 0 : 1;
				wrap.style.pointerEvents = isopen ? 'none' : null;
			}
		});
	});

	var duration = scale(getConfig('slide'), .2, 1) * 1000;
	a.animationHandle = setTimeout(function() {
		a.animationHandle = null;
		if (isopen)
			a.parentNode.removeChild(wrap);
		else {
			wrap.className = null;
			wrap.removeAttribute('style');
		}
		wrap = null;
	}, duration);
}

// opens immediate children of given node in new tabs
function openLinks(node) {
	chrome.tabs.getCurrent(function(tab) {
		getChildrenFunction(node)(function(result) {
			for (var i = 0; i < result.length; i++)
				openLink(result[i], 2);
		});
	});
}

// opens given node
function openLink(node, newtab) {
	var url = node.url;
	if (url) {
		chrome.tabs.getCurrent(function(tab) {
			if (newtab)
				chrome.tabs.create({url: url, active: (newtab == 1), openerTabId: tab.id});
			else
				chrome.tabs.update(tab.id, {url: url});
		});
	}
}

var columns; // columns[x][y] = id
var root; // root[] = id
var coords; // coords[id] = {x:x, y:y}
var special = ['apps', 'top', 'recent', 'closed', 'devices'];

// ensure root folders are included
function verifyColumns() {
	// default layout
	if (columns.length === 0) {
		columns.push([]);
		columns.push(special.filter(function(a) {
			return getConfig('show_' + a) != false;
		}));
	}

	// find missing root items
	var missing = root.slice(0);
	for (var x = 0; x < columns.length; x++) {
		for (var y = 0; y < columns[x].length; y++) {
			var i = missing.indexOf(columns[x][y]);
			if (i > -1)
				missing.splice(i, 1);
		}
	}

	// add missing root items
	var column = columns[0];
	for (var i = 0; i < missing.length; i++) {
		if (getConfig('show_' + missing[i]) != false)
			column.push(missing[i]);
	}

	// populate coordinate map
	coords = {};
	for (var x = 0; x < columns.length; x++) {
		for (var y = 0; y < columns[x].length; y++) {
			coords[columns[x][y]] = { x: x, y: y};
		}
		if (columns[x].length === 0) {
			columns.splice(x, 1);
			x--;
		}
	}
}

// load columns from storage or default
function loadColumns() {
	columns = [];
	for (var x = 0; ; x++) {
		var row = [];
		for (var y = 0; ; y++) {
			var id = localStorage.getItem('column.' + x + '.' + y);
			if (id) row.push(id); else break;
		}
		if (row.length > 0) columns.push(row); else break;
	}

	if (root) {
		verifyColumns();
		renderColumns();
	} else {
		chrome.bookmarks.getTree(function(result) {
			// init root nodes
			var nodes = result[0].children;
			root = special.slice(0);

			for (var i = 0; i < nodes.length; i++)
				root.push(nodes[i].id);

			verifyColumns();
			renderColumns();
		});
	}
}

// saves current column configuration to storage
function saveColumns() {
	// clear previous config
	for (var x = 0; ; x++) {
		for (var y = 0; ; y++) {
			var id = localStorage.getItem('column.' + x + '.' + y);
			if (id)
				localStorage.removeItem('column.' + x + '.' + y);
			else
				break;
		}
		if (y === 0)
			break;
	}
	verifyColumns();
	// save new config
	for (var x = 0; x < columns.length; x++) {
		for (var y = 0; y < columns[x].length; y++) {
			localStorage.setItem('column.' + x +'.' + y, columns[x][y]);
		}
	}
	// refresh
	loadColumns();
}

// creates and saves a new column
function addColumn(ids, index) {
	var column = ids.slice(0);
	// remove previous locations
	for (var x = 0; x < columns.length; x++) {
		for (var y = 0; y < columns[x].length; y++ ) {
			if (ids.indexOf(columns[x][y]) > -1) {
				columns[x].splice(y, 1);
				y--;
			}
		}
	}
	// insert new id
	if (index == null)
		index = columns.length;
	columns.splice(Math.min(index, columns.length), 0, column);

	// save
	saveColumns();
}

// removes given column
function removeColumn(index) {
	columns.splice(index, 1);
	saveColumns();
}

// creates and saves a new row
function addRow(id, xpos, ypos) {
	if (ypos == null)
		ypos = columns[xpos].length;

	// remove previous locations
	for (var x = 0; x < columns.length; x++) {
		var i = columns[x].indexOf(id);
		if (i > -1) {
			columns[x].splice(i, 1);
			if (x == xpos && ypos > i)
				ypos--;
		}
		if (columns[x].length === 0) {
			columns.splice(x, 1);
			x--;
			if (xpos > x)
				xpos--;
		}
	}
	// insert new id
	columns[xpos].splice(Math.min(ypos, columns[xpos].length), 0, id);

	// save
	saveColumns();
}

// removes given row
function removeRow(xpos, ypos) {
	columns[xpos].splice(ypos, 1);
	saveColumns();
}

// get recently closed tabs
function getClosed(callback) {
	var maxResults = getConfig('number_closed');
	chrome.sessions.getRecentlyClosed({ maxResults: maxResults }, function(sessions) {
		var nodes = [];
		for (var i = 0; i < sessions.length && i < maxResults; i++) {
			(function(session) {
				if (session.window && session.window.tabs.length == 1)
					session.tab = session.window.tabs[0];

				nodes.push({
					title: session.tab ? session.tab.title : session.window.tabs.length + ' ' + plural(session.window.tabs.length, 'вкладка', 'вкладки', 'вкладок'),
					url: session.tab ? session.tab.url : null,
					className: session.window ? 'window' : null,
					action: function() {
						chrome.sessions.restore(session.window ? session.window.sessionId : session.tab.sessionId, function(session) {
							refreshClosed();
						});
						return false;
					}
				});
			})(sessions[i]);
		}
		callback(nodes);
	});
}

function getDevices(callback) {
	chrome.sessions.getDevices({ maxResults: getConfig('number_closed') }, function(devices) {
		var nodes = [];
		for (var i = 0; i < devices.length; i++) {
			(function(device) {
				var children = [];
				for (var j = 0; j < device.sessions.length; j++) {
					var session = device.sessions[j];
					var tabs = session.window ? session.window.tabs : [session.tab];
					for (var k = 0; k < tabs.length; k++) {
						children.push({
							title: tabs[k].title,
							url: tabs[k].url
						});
					}
				}
				nodes.push({
					id: 'device.' + device.deviceName,
					title: device.deviceName,
					children: children
				});
			})(devices[i]);
		}
		callback(nodes);
	});
}

// refresh recently closed tab lists
function refreshClosed() {
	var targets = [];
	var folders = document.getElementsByClassName('closed');
	for (var i = 0; i < folders.length; i++) {
		var a = folders[i];
		if (a.nextSibling) {
			a.parentNode.removeChild(a.nextSibling);
			targets.push(a.parentNode);
		}
	}
	if (folders.length === 0 && coords['closed']) {
		var target = document.getElementsByClassName('column')[coords['closed'].x];
		target.removeChild(target.firstChild);
		targets.push(target);
	}

	getChildrenFunction({id: 'closed'})(function(result) {
		for (var i = 0; i < targets.length; i++)
			renderAll(result, targets[i]);
	});
}

// options : default values
var config = {
	font: 'Sans-serif',
	font_size: 14,
	font_weight: 400,
	theme: 'Default',
	font_color: '#26272b',
	background_color: '#f3f3f1',
	card_color: '#ffffff',
	accent_color: '#3b6fd8',
	highlight_color: '#ebf1fb',
	highlight_font_color: '#1c1d20',
	shadow_color: '#57b0ff',
	background_image_file: '',
	background_image: '',
	background_align: 'left top',
	background_repeat: 'repeat',
	background_size: 'auto',
	shadow_blur: 0,
	highlight_round: 1,
	fade: 1,
	spacing: 1,
	width: 1,
	h_pos: 1,
	v_margin: 1,
	slide: 1,
	hide_options: 0,
	lock: 0,
	show_top: 1,
	show_apps: 1,
	show_recent: 1,
	show_closed: 1,
	show_devices: 1,
	show_root: 0,
	texture: 1,
	newtab: 0,
	remember_open: 1,
	auto_close: 0,
	auto_scale: 1,
	css: '',
	number_top: 10,
	number_closed: 10,
	number_recent: 10
};

// color theme values
var themes = {
	Default: {},
	Classic: {
		font_color: '#000000',
		background_color: '#ffffff',
		highlight_color: '#3399ff',
		highlight_font_color: '#ffffff',
		shadow_color: '#97cbff',
		card_color: '#ffffff',
		accent_color: '#3399ff'
	},
	Dusk: {
		font_color: '#c8b9be',
		background_color: '#56546b',
		highlight_color: '#494d5a',
		highlight_font_color: '#ffd275',
		shadow_color: '#000000',
		card_color: '#615e77',
		accent_color: '#ffd275'
	},
	Elegant: {
		font_color: '#888888',
		background_color: '#f6f6f6',
		highlight_color: '#ffffff',
		highlight_font_color: '#000000',
		shadow_color: '#aaaaaa',
		card_color: '#ffffff',
		accent_color: '#555555'
	},
	Frosty: {
		font_color: '#3e5e82',
		background_color: '#e4eef3',
		highlight_color: '#0080c0',
		highlight_font_color: '#ffffff',
		shadow_color: '#8080ff',
		card_color: '#f4f8fa',
		accent_color: '#0080c0'
	},
	Hacker: {
		font_color: '#00ff00',
		background_color: '#000000',
		highlight_color: '#00ff00',
		highlight_font_color: '#000000',
		shadow_color: '#ff0000',
		card_color: '#071207',
		accent_color: '#00ff00'
	},
	Melon: {
		font_color: '#594526',
		background_color: '#f8ffe1',
		highlight_color: '#ff8000',
		highlight_font_color: '#ffff80',
		shadow_color: '#ff80c0',
		card_color: '#fffff3',
		accent_color: '#ff8000'
	},
	Midnight: {
		font_color: '#bfdfff',
		background_color: '#101827',
		highlight_color: '#000000',
		highlight_font_color: '#80ecff',
		shadow_color: '#0080ff',
		card_color: '#18233a',
		accent_color: '#80ecff'
	},
	Slate: {
		font_color: '#555555',
		background_color: '#b7babf',
		highlight_color: '#aaaaaa',
		highlight_font_color: '#000000',
		shadow_color: '#2a2a2a',
		card_color: '#c9ccd0',
		accent_color: '#2a2a2a'
	},
	Trees: {
		font_color: '#cdd088',
		background_color: '#566157',
		highlight_color: '#4d674b',
		highlight_font_color: '#ffff80',
		shadow_color: '#183010',
		card_color: '#606c61',
		accent_color: '#ffff80'
	},
	Valentine: {
		font_color: '#895fc2',
		background_color: '#eae1ff',
		highlight_color: '#ffb7f0',
		highlight_font_color: '#f00000',
		shadow_color: '#ffffff',
		card_color: '#f6f1ff',
		accent_color: '#c03fa8'
	},
	Warm: {
		font_color: '#824100',
		background_color: '#ffeedd',
		highlight_color: '#fffae8',
		highlight_font_color: '#800000',
		shadow_color: '#d98764',
		card_color: '#fff7ee',
		accent_color: '#d98764'
	}
};
var theme = {};

// названия тем в настройках; ключи themes хранятся в options.theme как есть
var themeNames = {
	Default: 'По умолчанию',
	Classic: 'Классическая',
	Dusk: 'Сумерки',
	Elegant: 'Элегантная',
	Frosty: 'Морозная',
	Hacker: 'Хакер',
	Melon: 'Дыня',
	Midnight: 'Полночь',
	Slate: 'Сланец',
	Trees: 'Лес',
	Valentine: 'Валентинка',
	Warm: 'Тёплая'
};

// get config value or default
function getConfig(key) {
	var value = localStorage.getItem('options.' + key);
	if (value != null)
		return typeof config[key] === 'number' ? Number(value) : value;
	else
		return (theme.hasOwnProperty(key) ? theme[key] : config[key]);
}

// set config value
function setConfig(key, value) {
	if (value != null)
		localStorage.setItem('options.' + key, typeof config[key] === 'number' ? Number(value) : value);
	else {
		localStorage.removeItem('options.' + key);
		value = (theme.hasOwnProperty(key) ? theme[key] : config[key]);
	}
	// special case settings
	if (key == 'lock' || key == 'newtab' || key == 'show_root' || key.substring(0,6) == 'number')
		loadColumns();
	else if (key == 'theme') {
		theme = themes[value];
		for (var i in config) {
			if (i != key) {
				onChange(i);
				showConfig(i);
			}
		}
	} else if (key == 'texture') {
		updateTexture();
	} else if (key.substring(0,4) == 'show') {
		var id = key.substring(5);
		if (!value) {
			if (coords[id])
				removeRow(coords[id].x, coords[id].y);
			saveColumns();
		} else {
			saveColumns();
		}
	}
	onChange(key, value);
	return value;
}

// map config keys to styles
var styles = {};

function getStyle(key, value) {
	switch(key) {
		case 'font':
			return '#main a { font-family: "' + value + '"; }';
		case 'font_size':
			return ':root { --fs: ' + value + 'px; }';
		case 'font_weight':
			return ':root { --fw: ' + value + '; }';
		case 'font_color':
			return ':root { --text: ' + value + '; }';
		case 'background_color':
			return ':root { --bg: ' + value + '; }';
		case 'card_color':
			return ':root { --card: ' + value + '; }';
		case 'accent_color':
			return ':root { --accent: ' + value + '; }';
		case 'background_image':
			return 'body { background-image: url(' + value + '); }';
		case 'background_image_file':
			return 'body { background-image: url(' + value + '); }';
		case 'background_align':
			return 'body { background-position: ' + value + '; }';
		case 'background_repeat':
			return 'body { background-repeat: ' + value + '; }';
		case 'background_size':
			return 'body { background-size: ' + value + '; }';
		case 'highlight_font_color':
			return ':root { --hover-text: ' + value + '; }';
		case 'highlight_color':
			return ':root { --hover-bg: ' + value + '; }';
		case 'shadow_color':
			return '#main a:hover { box-shadow: 0 0 ' + scale(getConfig('shadow_blur'), 7, 100) + 'px ' + value + '; }';
		case 'shadow_blur':
			return '#main a:hover { box-shadow: 0 0 ' + scale(value, 7, 100) + 'px ' + getConfig('shadow_color') + '; }';
		case 'highlight_round':
			return ':root { --radius: ' + scale(value, 8, 16) + 'px; }';
		case 'fade':
			return '#main a { transition-duration: ' + scale(value, .2, 1) + 's; }';
		case 'slide':
			return '.wrap { transition-duration: ' + scale(value, .2, 1) + 's; }';
		case 'spacing':
			return ':root { --row: ' + scale(value, 32, 56, 22) + 'px; }';
		case 'width':
			return '#main { width: ' + (getConfig('auto_scale') ?
				scale(value, 80, 100, 20) + '%' :
				scale(value, 1000, 3000, 400) + 'px') + '; }';
		case 'h_pos':
			var margin = 100 - scale(getConfig('width'), 80, 100, 20);
			return '#main { left: ' + scale(value, 0, margin/2, -margin/2) + '%; }';
		case 'v_margin':
			return '#main { margin-top: ' + (getConfig('auto_scale') ?
				scale(value, 5, 20) + '%' :
				scale(value, 80, 600) + 'px') + '; }';
		case 'hide_options':
			return '#options_button { opacity: 0; }';
		case 'css':
			return value;
		case 'auto_scale':
			return value ? null : '#main { margin-top: 80px; width: 1000px; }';
		default:
			return null;
	}
}

// scales input value from [0,1,2] to [min,mid,max]
function scale(value, mid, max, min) {
	min = min || 0;
	return value > 1 ?
		mid + (value - 1) * (max - mid) :
		min + value * (mid - min);
}

// gets rgb representation of hex color
function hexToRgb(hex) {
	hex = /[a-f\d]{6}/i.exec(hex);
	var bigint = parseInt(hex, 16);
	var r = (bigint >> 16) & 255;
	var g = (bigint >> 8) & 255;
	var b = bigint & 255;
	return r + "," + g + "," + b;
}

// apply config value change
function onChange(key, value) {
	if (value == null)
		value = getConfig(key);

	if (value != config[key]) {
		var css = getStyle(key, value);
		if (css) {
			var style;
			if (styles.hasOwnProperty(key))
				style = styles[key];
			else {
				style = document.createElement('style');
				styles[key] = style;
			}
			document.head.appendChild(style);

			// add style rules
			style.innerText = css;
		}
	} else if (styles.hasOwnProperty(key)) {
		// remove rules
		styles[key].parentNode.removeChild(styles[key]);
		delete styles[key];
	}
	// refresh dependent values
	if (key == 'width')
		onChange('h_pos');
	else if (key == 'shadow_blur')
		onChange('shadow_color');
	else if (key == 'auto_scale') {
		onChange('width');
		onChange('v_margin');
	}

	// update options panel
	if (!settingsInitialized)
		return;

	// show/hide default button (кнопки сброса появляются в initConfig)
	var input = document.getElementById('options_' + key);
	if (input && input.reset) {
		var isDefault = value == (theme.hasOwnProperty(key) ? theme[key] : config[key]);
		input.reset.style.visibility = (isDefault ? 'hidden' : null);
		if (input.swatch)
			input.swatch.value = value;
	}
}

// loads config settings
function loadSettings() {
	// load theme
	theme = themes[getConfig('theme')] || {};
	// load settings
	for (var key in config)
		if (key === 'background_image_file')
			setTimeout(function() { onChange('background_image_file'); }, 0);
		else
			onChange(key);
}

// apply config values to input controls
function showConfig(key) {
	var input = document.getElementById('options_' + key);
	if (!input || input.type === 'file')
		return;

	input[input.type === 'checkbox' ? 'checked' : 'value'] = getConfig(key);
}

// initialize config settings
function initConfig(key) {
	var input = document.getElementById('options_' + key);
	if (!input)
		return;

	if (input.type == 'color') {
		input.type = 'text';
		input.className = 'color';
		var swatch = document.createElement('input');
		swatch.type = 'color';
		swatch.value = input.value;
		swatch.oninput = function(event) {
			input.value = this.value;
			return input.onchange(event);
		};
		input.swatch = swatch;
		input.parentNode.appendChild(swatch);
	}
	input.onchange = function(event) {
		if (input.type == 'file') {
			// load file
			if (event.target.files.length == 1) {
				var file = event.target.files[0];
				if (file.size > 2097152) {
					input.value = null;
					alert('Изображение должно быть меньше 2 МБ.');
					return false;
				}
				var reader = new FileReader();
				reader.onload = function(f) {
					if (f.target.result)
						setConfig(key, f.target.result);
				};
				reader.readAsDataURL(file);
			}
		} else
			setConfig(key, input.type == 'checkbox' ? Number(input.checked) : input.value);
	};

	var reset = document.createElement('a');
	reset.className = 'revert';
	reset.title = 'Вернуть значение по умолчанию';
	reset.tabIndex = 0;
	reset.onclick = function() {
		setConfig(key, null);
		showConfig(key);
		return false;
	};

	input.reset = reset;
	input.parentNode.appendChild(reset);
	showConfig(key);
}

var settingsInitialized = false;

// initialize options panel
function initSettings() {
	settingsInitialized = true;

	// options close button
	document.getElementById('options_close_button').onclick = function() {
		showOptions(false);
		return false;
	};

	// options submenu navigation
	var options = document.getElementById('options');
	var nav = document.getElementById('options_nav');
	var index = 0;
	for (var i=0; i<nav.children.length; i++) {
		var a = nav.children[i].firstChild;
		a.onclick = function(e) {
			// clear current style
			nav.children[index].firstChild.classList.remove('current');
			options.getElementsByClassName('section')[index].classList.remove('current');
			// apply new current style
			index = Array.prototype.indexOf.call(nav.children, this.parentNode);
			nav.children[index].firstChild.classList.add('current');
			options.getElementsByClassName('section')[index].classList.add('current');
			// show custom css on advanced tab
			if (index === nav.children.length-1) {
				var allcss = document.getElementById('all_css');
				allcss.value = '';
				for (var key in config) {
					var css = (getStyle(key, getConfig(key)));
					if (css && css.length < 1000 && key != 'css')
						allcss.value += css + '\n';
				}
			}
			// import/export
			if (index === nav.children.length-2) {
				var exports = document.getElementById('options_export');
				var imports = document.getElementById('options_import');
				var replacer = function(key, value) {
					if (key == 'options.background_image_file' || key == 'weather.cache' || key == 'texture.recent') {
						return undefined;
					}
					return value;
				};
				exports.value = JSON.stringify(localStorage, replacer);
				imports.value = '';
				imports.placeholder = 'Вставьте сюда экспортированные настройки';
				imports.onchange = function() {
					try {
						var imported = JSON.parse(imports.value);
						for(var key in imported) {
							localStorage.setItem(key, imported[key]);
						}
						imports.value = '';
						imports.placeholder = 'Настройки импортированы';
						exports.value = JSON.stringify(localStorage, replacer);
						loadSettings();
						loadColumns();
					} catch (e) {
						imports.value = '';
						imports.placeholder = 'Не удалось импортировать: это не похоже на JSON из экспорта';
					}
				};
			}
			return false;
		};
	}

	// add options to hide bookmark folders
	chrome.bookmarks.getTree(function(result) {
		var placeholder = document.getElementById('options_show_bookmarks');
		var nodes = result[0].children;
		for (var i = 0; i < nodes.length; i++) {
			var key = 'show_' + nodes[i].id;
			config[key] = 1;

			var span = document.createElement('span');
			span.innerText = nodes[i].title;

			var input = document.createElement('input');
			input.type = 'checkbox';
			input.id = 'options_' + key;

			var label = document.createElement('label');
			label.appendChild(span);
			label.appendChild(input);
			placeholder.appendChild(label);
		}

		// replace text input with system font list
		if (chrome.fontSettings) {
			var input = document.getElementById('options_font');
			var select = document.createElement('select');
			input.parentNode.replaceChild(select, input);
			select.id = input.id;
		}

		// show settings
		for (var key in config)
			initConfig(key);

		loadSettings();

		// load themes
		var select = document.getElementById('options_theme');
		if (select.childNodes.length === 0) {
			for (var i in themes) {
				var option = document.createElement('option');
				option.value = i;
				option.innerText = themeNames[i] || i;
				if (i == getConfig('theme'))
					option.selected = 'selected';
				select.appendChild(option);
			}
		}

		// load font list
		if (chrome.fontSettings) {
			chrome.fontSettings.getFontList(function(fonts) {
				var select = document.getElementById('options_font');
				if (select.childNodes.length > 0)
					return;

				fonts.unshift({ fontId: 'Sans-serif' });
				for (var i = 0; i < fonts.length; i++) {
					var font = fonts[i].fontId;
					var option = document.createElement('option');
					option.value = font;
					option.innerText = font === 'Sans-serif' ? 'Системный' : font;
					if (font == getConfig('font'))
						option.selected = 'selected';
					select.appendChild(option);
				}
			});
		}
	});
}

// show options panel
function showOptions(show) {
	document.getElementById('options').classList.toggle('open', show);
	if (show) {
		if (!settingsInitialized)
			initSettings();
		for (var key in config)
			showConfig(key);
	}
}

// фон «символы на ветру» (texture.js)
var texture = null;

function updateTexture() {
	var show = getConfig('texture') && window.HumbleTexture;
	if (show && !texture)
		texture = HumbleTexture.mount(document.getElementById('texture'));
	else if (!show && texture) {
		texture.destroy();
		texture = null;
	}
}

// initialize page
loadSettings();
loadColumns();
updateTexture();

// keyboard shortcuts
document.addEventListener('keypress', function(event) {
	if (event.keyCode == 13 && event.target && event.target.onclick && event.target.tagName == 'A') {
		event.target.dispatchEvent(new MouseEvent('click'));
		event.preventDefault();
	}
});
document.addEventListener('mousedown', function(event) {
	document.body.classList.add('hide-focus');
});
document.addEventListener('keydown', function(event) {
	document.body.classList.remove('hide-focus');
	// Esc закрывает настройки, если поверх нет диалога
	if (event.key === 'Escape' && settingsInitialized && !document.getElementById('dialog').open)
		showOptions(false);
});

window.onresize = function(event) {
	updateTooltips();
};

// load options panel
document.getElementById('options_button').onclick = function() {
	showOptions(true);
	return false;
};
if (location.search === '?options')
	showOptions(true);

// refresh recently closed
if (chrome.sessions)
	chrome.sessions.onChanged.addListener(refreshClosed);

var refreshTimeout = null;

// re-render columns after bookmarks change, keeping page height to avoid scroll jumps
function refreshBookmarks() {
	if (refreshTimeout)
		clearTimeout(refreshTimeout);
	refreshTimeout = setTimeout(function() {
		refreshTimeout = null;
		var main = document.getElementById('main');
		main.style.minHeight = main.offsetHeight + 'px';
		loadColumns();
		setTimeout(function() {
			main.style.minHeight = null;
		}, 500);
	}, 100);
}

// refresh bookmarks
['onCreated', 'onRemoved', 'onChanged', 'onMoved', 'onChildrenReordered', 'onImportEnded'].forEach(function(name) {
	if (chrome.bookmarks[name])
		chrome.bookmarks[name].addListener(refreshBookmarks);
});
