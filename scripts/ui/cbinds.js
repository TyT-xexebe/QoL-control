const interceptor = require('qol-control/core/interceptor');
const uiUtils = require('qol-control/ui/utils');
const SETTINGS_KEY = 'qol-cbinds';

let dialog = null;
let activeTables = [];
let hudBuilt = false;
let allIcons = [];

function loadButtons() {
	try {
		let data = JSON.parse(Core.settings.getString(SETTINGS_KEY, '[]'));
		data.forEach(btn => {
			if (btn.enabled === undefined) btn.enabled = true;
			if (btn.ips === undefined) btn.ips = '';
		});
		return data;
	} catch (e) {
		return [];
	}
}

function isAllowedOnServer(ipsStr) {
	if (!ipsStr) return true;
	
	let currentIpOnly = null;
	let currentIpAndPort = null;
	
	try {
		if (Vars.net.active() && Vars.net.client()) {
			let hostField = Vars.netClient.getClass().getDeclaredField('host');
			hostField.setAccessible(true);
			let currentHost = hostField.get(Vars.netClient);
			if (currentHost) {
				let address = String(currentHost.address);
				if (address.startsWith('/')) address = address.substring(1);
				if (address.indexOf(':') !== -1) {
					address = address.split(':')[0];
				}
				currentIpOnly = address;
				currentIpAndPort = address + ":" + String(currentHost.port);
			}
		}
	} catch (e) {}
	
	if (!currentIpOnly) {
		let lastIp = String(Core.settings.getString('qol-last-ip', ''));
		if (lastIp) {
			if (lastIp.startsWith('/')) lastIp = lastIp.substring(1);
			currentIpOnly = lastIp;
			currentIpAndPort = lastIp;
		}
	}
	if (!currentIpOnly) {
		let ipSetting = String(Core.settings.getString('ip', ''));
		if (ipSetting) {
			if (ipSetting.startsWith('/')) ipSetting = ipSetting.substring(1);
			currentIpOnly = ipSetting;
			currentIpAndPort = ipSetting;
		}
	}
	
	if (!currentIpOnly) return false;
	
	let ips = ipsStr.split(',').map(s => String(s).trim().toLowerCase());
	
	for (let i = 0; i < ips.length; i++) {
		let pattern = ips[i];
		if (pattern.indexOf(':') !== -1) {
			if (currentIpAndPort && currentIpAndPort.toLowerCase() === pattern) {
				return true;
			}
		} else {
			if (currentIpOnly && currentIpOnly.toLowerCase() === pattern) {
				return true;
			}
		}
	}
	return false;
}

function saveButtons(data) {
	Core.settings.put(SETTINGS_KEY, JSON.stringify(data));
	Core.settings.forceSave();
}

function executeChat(text) {
	if (!text) return;
	let lines = text.split('\n');
	for (let i = 0; i < lines.length; i++) {
		let line = lines[i];
		if (line.length > 0) {
			while (line.length > 150) {
				Call.sendChatMessage(line.substring(0, 150));
				line = line.substring(150);
			}
			if (line.length > 0) {
				Call.sendChatMessage(line);
			}
		}
	}
}

function getIconDrawable(name, type) {
	if (!name) return null;
	try {
		let val = Packages.mindustry.gen.Icon[name];
		if (val) return val;
	} catch (e) {}
	try {
		let content = null;
		let contentTypes = [];
		if (type) {
			if (type === "Block") contentTypes.push(ContentType.block);
			else if (type === "Item") contentTypes.push(ContentType.item);
			else if (type === "Liquid") contentTypes.push(ContentType.liquid);
			else if (type === "Unit") contentTypes.push(ContentType.unit);
		}
		if (contentTypes.length === 0) {
			contentTypes = [ContentType.block, ContentType.item, ContentType.liquid, ContentType.unit];
		}
		for (let i = 0; i < contentTypes.length; i++) {
			content = Vars.content.getByName(contentTypes[i], name);
			if (content) break;
		}
		if (content && content.uiIcon) {
			return new Packages.arc.scene.style.TextureRegionDrawable(content.uiIcon);
		}
	} catch (e) {}
	return null;
}

function loadIconsList() {
	if (allIcons.length > 0) return;
	try {
		let iconClass = Packages.mindustry.gen.Icon;
		let fields = iconClass.getFields();
		for (let i = 0; i < fields.length; i++) {
			let f = fields[i];
			let val = f.get(null);
			if (val instanceof Packages.arc.scene.style.Drawable) {
				allIcons.push({
					name: String(f.getName()),
					icon: val,
					type: "Standard"
				});
			}
		}
	} catch (e) {
		let fallbackNames = ["add", "save", "ok", "cancel", "edit", "trash", "chat", "settings", "info", "bookOpen", "copy", "download", "folder", "paste", "zoom", "refresh", "play", "pause"];
		fallbackNames.forEach(name => {
			try {
				let val = Packages.mindustry.gen.Icon[name];
				if (val) {
					allIcons.push({
						name: name,
						icon: val,
						type: "Standard"
					});
				}
			} catch (err) {}
		});
	}

	const addContentIcons = (type, typeLabel) => {
		Vars.content.getBy(type).each((c) => {
			if (
				c.uiIcon &&
				c.uiIcon !== Core.atlas.find('error') &&
				c.uiIcon !== Core.atlas.find('clear')
			) {
				allIcons.push({
					name: String(c.name),
					icon: new Packages.arc.scene.style.TextureRegionDrawable(c.uiIcon),
					type: typeLabel
				});
			}
		});
	};

	try {
		addContentIcons(ContentType.block, "Block");
		addContentIcons(ContentType.item, "Item");
		addContentIcons(ContentType.liquid, "Liquid");
		addContentIcons(ContentType.unit, "Unit");
	} catch (e) {}
}

function showIconPicker(callback) {
	loadIconsList();
	let d = new BaseDialog('Select Icon');
	d.addCloseButton();

	let listTable = new Table();
	listTable.top();

	let searchQuery = "";
	let currentTab = "All";

	let filterTable = new Table();
	let searchTable = new Table();
	searchTable.add('Search: ').padRight(8);
	searchTable.field('', cons(text => {
		searchQuery = String(text).toLowerCase();
		rebuild();
	})).width(300);
	filterTable.add(searchTable).padBottom(8).row();

	let tabsTable = new Table();
	let tabs = ["All", "Standard", "Block", "Item", "Liquid", "Unit"];
	let tabButtons = {};
	tabs.forEach(tab => {
		let btn = tabsTable.button(tab, () => {
			currentTab = tab;
			tabs.forEach(t => {
				let b = tabButtons[t];
				if (b) b.setColor(t === currentTab ? Color.orange : Color.white);
			});
			rebuild();
		}).size(90, 35).pad(2).get();
		tabButtons[tab] = btn;
	});
	if (tabButtons["All"]) tabButtons["All"].setColor(Color.orange);

	let tabsScroll = new ScrollPane(tabsTable);
	tabsScroll.setScrollingDisabled(false, true);
	filterTable.add(tabsScroll).width(500).height(40).row();

	d.cont.add(filterTable).padBottom(10).row();

	let scrollPane = new ScrollPane(listTable);
	d.cont.add(scrollPane).size(500, 350).row();

	function rebuild() {
		listTable.clearChildren();
		let filtered = allIcons.filter(ic => {
			if (currentTab !== "All" && ic.type !== currentTab) return false;
			if (searchQuery && ic.name.toLowerCase().indexOf(searchQuery) === -1) return false;
			return true;
		});

		let cols = 10;
		let count = 0;
		filtered.forEach(ic => {
			listTable.button(ic.icon, Styles.clearNonei, 32, () => {
				callback(ic);
				d.hide();
			}).size(45).pad(2);
			count++;
			if (count % cols === 0) listTable.row();
		});
	}

	rebuild();
	d.show();
}

// ---------------------------------------------------------------------------
// Anchored positioning for custom screen binds
//
// Stored as (anchor, offset) so a window resize re-derives the pixel position
// instead of re-clamping an already-clamped value. Legacy configs that only
// carry a bare x/y get their anchor derived once, then migrated on next save.
// ---------------------------------------------------------------------------
function resolveAnchor(entry, fallbackX, fallbackY) {
	let size = uiUtils.elementSize(entry.table);
	let w = size.w > 0 ? size.w : entry.width || 50;
	let h = size.h > 0 ? size.h : entry.height || 50;
	let sw = uiUtils.stageWidth();
	let sh = uiUtils.stageHeight();

	if (!entry.anchorX || !entry.anchorY) {
		let det = uiUtils.detectAnchor(
			fallbackX,
			fallbackY,
			sw,
			sh,
			w,
			h,
			16
		);
		if (!entry.anchorX) {
			entry.anchorX = det.anchorX;
			entry.offsetX = entry.offsetX !== undefined ? entry.offsetX : det.offsetX;
		}
		if (!entry.anchorY) {
			entry.anchorY = det.anchorY;
			entry.offsetY = entry.offsetY !== undefined ? entry.offsetY : det.offsetY;
		}
		if (entry.config) {
			entry.config.anchorX = entry.anchorX;
			entry.config.anchorY = entry.anchorY;
			entry.config.offsetX = entry.offsetX;
			entry.config.offsetY = entry.offsetY;
		}
	}
	if (entry.offsetX === undefined || entry.offsetX === null) entry.offsetX = fallbackX;
	if (entry.offsetY === undefined || entry.offsetY === null) entry.offsetY = fallbackY;

	entry.px = uiUtils.computeX(
		entry.anchorX,
		entry.offsetX,
		sw,
		size.w > 0 ? size.w : w
	);
	entry.py = uiUtils.computeY(
		entry.anchorY,
		entry.offsetY,
		sh,
		size.h > 0 ? size.h : h
	);
	return entry;
}

// Re-derive and apply without touching the stored offset (idempotent on resize).
function positionEntry(entry) {
	if (!entry || !entry.table) return;
	resolveAnchor(entry, entry.px !== undefined ? entry.px : 100, entry.py !== undefined ? entry.py : 200);
	entry.table.setPosition(entry.px, entry.py);
}

function repositionAllEntries() {
	activeTables.forEach((entry) => {
		try {
			positionEntry(entry);
		} catch (e) {}
	});
}

function rebuildHUD() {
	activeTables.forEach(entry => {
		try {
			entry.table.remove();
		} catch (e) {}
	});
	activeTables = [];

	if (!Vars.state.isGame() || !Vars.ui.hudfrag.shown) {
		hudBuilt = false;
		return;
	}

	hudBuilt = true;

	let buttons = loadButtons();

	buttons.forEach((btnConfig) => {
		if (btnConfig.enabled === false) return;
		if (btnConfig.ips && !isAllowedOnServer(btnConfig.ips)) return;

		let table = new Table();
		Vars.ui.hudGroup.addChild(table);

		let width = btnConfig.width || 50;
		let height = btnConfig.height || 50;

		// Anchor + offset instead of a raw pixel pair. Existing configs only have
		// a bare x/y, so the anchor is derived from that once and then stored.
		let entry = {
			table: table,
			width: width,
			height: height,
			config: btnConfig,
			anchorX: btnConfig.anchorX || null,
			anchorY: btnConfig.anchorY || null,
			offsetX: btnConfig.offsetX,
			offsetY: btnConfig.offsetY
		};
		resolveAnchor(entry, btnConfig.x || 100, btnConfig.y || 200);
		table.setPosition(entry.px, entry.py);

		let drawable = getIconDrawable(btnConfig.iconName, btnConfig.iconType);
		let btn;
		let isDraggingBtn = false;

		if (drawable) {
			if (btnConfig.name) {
				btn = table.button(cons(b => {
					b.image(drawable).size(24).padRight(4);
					b.add(btnConfig.name);
				}), () => {
					if (!isDraggingBtn) {
						executeChat(btnConfig.commands);
					}
				});
				btn.get().setStyle(btnConfig.noBackground ? Styles.clearNonet : Styles.cleart);
			} else {
				btn = table.button(drawable, btnConfig.noBackground ? Styles.clearNonei : Styles.cleari, Math.min(width, height) - 10, () => {
					if (!isDraggingBtn) {
						executeChat(btnConfig.commands);
					}
				});
			}
		} else {
			btn = table.button(btnConfig.name || "Button", btnConfig.noBackground ? Styles.clearNonet : Styles.cleart, () => {
				if (!isDraggingBtn) {
					executeChat(btnConfig.commands);
				}
			});
		}

		btn.size(width, height).get();

		let localDragging = false;
		let dragArmed = false;
		let startX = 0;
		let startY = 0;
		let currentX = btnConfig.x || 100;
		let currentY = btnConfig.y || 200;

		btn.get().addListener(
			extend(InputListener, {
				touchDown(event, x, y, pointer, button) {
					// Desktop moves buttons with the right button, so a left click
					// still fires the command bound to the button.
					if (!uiUtils.isDragButton(button)) return false;
					dragArmed = true;
					localDragging = false;
					isDraggingBtn = false;
					startX = x;
					startY = y;
					return true;
				},
				touchDragged(event, x, y, pointer) {
					if (!dragArmed) return false;
					if (
						!localDragging &&
						(Math.abs(x - startX) > 5 || Math.abs(y - startY) > 5)
					) {
						localDragging = true;
						isDraggingBtn = true;
					}
				if (localDragging) {
					let sw = uiUtils.stageWidth();
					let sh = uiUtils.stageHeight();
					currentX = Mathf.clamp(
						event.stageX,
						width / 2,
						Math.max(width / 2, sw - width / 2)
					);
					currentY = Mathf.clamp(
						event.stageY,
						height / 2,
						Math.max(height / 2, sh - height / 2)
					);
					entry.px = currentX;
					entry.py = currentY;
					table.setPosition(currentX, currentY);
				}
				return true;
			},
			touchUp(event, x, y, pointer) {
				if (!dragArmed) return false;
				dragArmed = false;
				if (localDragging) {
					// Re-anchor from the drop point, then persist anchor + offset.
					let size = uiUtils.elementSize(table);
					let det = uiUtils.detectAnchor(
						currentX,
						currentY,
						uiUtils.stageWidth(),
						uiUtils.stageHeight(),
						size.w > 0 ? size.w : width,
						size.h > 0 ? size.h : height,
						16
					);
					entry.anchorX = det.anchorX;
					entry.anchorY = det.anchorY;
					entry.offsetX = det.offsetX;
					entry.offsetY = det.offsetY;
					entry.px = currentX;
					entry.py = currentY;

					btnConfig.x = currentX;
					btnConfig.y = currentY;
					btnConfig.anchorX = det.anchorX;
					btnConfig.anchorY = det.anchorY;
					btnConfig.offsetX = det.offsetX;
					btnConfig.offsetY = det.offsetY;
					saveButtons(buttons);
				}
					Timer.schedule(() => {
						localDragging = false;
						isDraggingBtn = false;
					}, 0.1);
					return true;
				},
			})
		);

		activeTables.push(entry);
	});
}

function buildUI() {
	dialog = new BaseDialog('Custom Screen Binds');
	dialog.addCloseButton();
	showMainMenu();
}

function showMainMenu() {
	let buttons = loadButtons();

	dialog.cont.clear();

	let root = new Table();
	root.top().left().margin(10);

	function createCard(title, titleColor) {
		let card = root.table(Styles.black6).growX().padBottom(8).get();
		card.margin(8);
		card.top().left();
		card.add('[#' + (titleColor || 'ffd37f') + ']' + title + '[]').style(Styles.outlineLabel).fontScale(0.90).left().padBottom(4).row();
		card.image().color(Color.valueOf('3a3a46')).height(1.5).growX().padBottom(6).row();
		return card;
	}

	let c1 = createCard('On-Screen Action Buttons (' + buttons.length + ')', '50fa7b');

	if (buttons.length === 0) {
		c1.add('[lightgray]No custom screen buttons configured. Click button below to create one![]').pad(10).left().row();
	} else {
		buttons.forEach((btnConfig, index) => {
			let rowTable = c1.table().growX().pad(2).get();

			rowTable.check("", btnConfig.enabled !== false, b => {
				let currentButtons = loadButtons();
				if (currentButtons[index]) {
					currentButtons[index].enabled = b;
					saveButtons(currentButtons);
					rebuildHUD();
				}
			}).padRight(6);

			let drawable = getIconDrawable(btnConfig.iconName, btnConfig.iconType);
			let displayCmd = (btnConfig.commands || "").replace(/\r/g, "").replace(/\n/g, " | ");

			let btnCell = rowTable.button(cons(b => {
				b.left();
				if (drawable) {
					b.image(drawable).size(22).padRight(6);
				}
				b.add('[accent]' + (btnConfig.name || (btnConfig.iconName ? "[" + btnConfig.iconName + "]" : "Unnamed")))
					.width(110)
					.left()
					.padRight(10)
					.get()
					.setEllipsis(true);

				let infoCell = b.add('[white]' + displayCmd)
					.left()
					.growX()
					.minWidth(0);
				infoCell.get().setEllipsis(true);
			}), () => {
				showEditDialog(index, btnConfig);
			});

			btnCell.growX().height(48).left().padRight(8);
			btnCell.get().setStyle(Styles.grayt);

			rowTable.button(Icon.edit, Styles.cleari, () => {
				showEditDialog(index, btnConfig);
			}).size(40, 48).padRight(4);

			rowTable.button(Icon.trash, Styles.cleari, () => {
				Vars.ui.showConfirm(
					'Delete Custom Button',
					"Are you sure you want to delete '" + (btnConfig.name || "this button") + "'?",
					() => {
						let currentButtons = loadButtons();
						currentButtons.splice(index, 1);
						saveButtons(currentButtons);
						rebuildHUD();
						showMainMenu();
					}
				);
			}).size(40, 48);

			c1.row();
		});
	}

	root.row();

	// Add Button Card
	let actCard = root.table(Styles.black6).growX().padBottom(2).get();
	actCard.margin(8);
	let actRow = actCard.table().center().get();

	actRow.button('[#73d216]Add Screen Button[]', Icon.add, Styles.grayt, () => {
		showEditDialog(-1, {
			name: '',
			iconName: '',
			width: 50,
			height: 50,
			commands: '',
			x: uiUtils.stageWidth() / 2,
			y: uiUtils.stageHeight() / 2
		});
	}).size(220, 40);

	root.row();

	let pane = new ScrollPane(root);
	pane.setScrollingDisabled(true, false);
	pane.setOverscroll(false, true);

	let dw = Math.min(Core.scene.getWidth() * 0.95, 680);
	let dh = Math.min(Core.scene.getHeight() * 0.85, 480);
	dialog.cont.add(pane).width(dw).height(dh);
}

function showEditDialog(index, btnData) {
	let isNew = index === -1;
	let d = new BaseDialog(isNew ? 'Add Screen Button' : 'Edit Screen Button');
	d.addCloseButton();

	let name = btnData.name || '';
	let iconName = btnData.iconName || '';
	let iconType = btnData.iconType || '';
	let widthVal = btnData.width || 50;
	let heightVal = btnData.height || 50;
	let commands = btnData.commands || '';
	let noBackground = btnData.noBackground || false;
	let enabled = btnData.enabled !== false;
	let ips = btnData.ips || '';

	let root = new Table();
	root.top().left().margin(10);

	function createCard(title, titleColor) {
		let card = root.table(Styles.black6).growX().padBottom(8).get();
		card.margin(8);
		card.top().left();
		card.add('[#' + (titleColor || 'ffd37f') + ']' + title + '[]').style(Styles.outlineLabel).fontScale(0.90).left().padBottom(4).row();
		card.image().color(Color.valueOf('3a3a46')).height(1.5).growX().padBottom(6).row();
		return card;
	}

	// 1. Button Identity Card
	let c1 = createCard('Button Identity & Icon', '50fa7b');

	let nameRow = c1.table().growX().pad(2).get();
	nameRow.add('[lightgray]Label / Text: []').left().padRight(8);
	let nameField = nameRow.field(name, (n) => { name = n; }).height(38).growX().get();
	c1.row();

	let iconRow = c1.table().growX().pad(2).get();
	iconRow.add('[lightgray]Icon: []').left().padRight(8);
	let iconBtnCell = iconRow.button(cons(b => {
		b.left();
		let drawable = getIconDrawable(iconName, iconType);
		if (drawable) {
			b.image(drawable).size(22).padRight(6);
		}
		b.add(iconName ? ('[accent]' + iconName + '[]') : '[gray]Choose Icon...[]');
	}), () => {
		showIconPicker((selectedIcon) => {
			iconName = selectedIcon.name;
			iconType = selectedIcon.type;
			iconBtnCell.get().clearChildren();
			let drawable = getIconDrawable(iconName, iconType);
			if (drawable) {
				iconBtnCell.get().image(drawable).size(22).padRight(6);
			}
			iconBtnCell.get().add('[accent]' + iconName + '[]');
		});
	}).height(38).growX().get();
	iconBtnCell.setStyle(Styles.grayt);
	c1.row();

	c1.check('No Background (Transparent button)', noBackground, (b) => {
		noBackground = b;
	}).padTop(4).left().row();

	root.row();

	// 2. Dimensions Card
	let c2 = createCard('Size & Dimensions', '8be9fd');
	let sizeRow = c2.table().growX().pad(2).get();
	sizeRow.add('[lightgray]Width: []').left().padRight(4);
	let widthField = sizeRow.field(String(widthVal), (w) => {
		widthVal = parseInt(w) || 50;
	}).size(65, 36).get();

	sizeRow.add('[lightgray]px  Height: []').padLeft(8).padRight(4);
	let heightField = sizeRow.field(String(heightVal), (h) => {
		heightVal = parseInt(h) || 50;
	}).size(65, 36).get();
	sizeRow.add('[lightgray]px[]').padLeft(4).padRight(12);

	sizeRow.button('Reset 50x50', Styles.grayt, () => {
		widthVal = 50;
		heightVal = 50;
		widthField.setText('50');
		heightField.setText('50');
	}).size(120, 36);
	c2.row();

	root.row();

	// 3. Commands Card
	let c3 = createCard('Commands / Messages', 'ffd37f');
	c3.add('[lightgray]Command or chat message executed on click:[]').left().padBottom(4).row();
	let cmdArea = c3.area(commands, (txt) => { commands = txt; }).growX().height(100).get();
	c3.row();
	c3.add('[gray]Tip: Multiple commands can be chained using newlines or |[]').fontScale(0.85).left().padTop(4).row();

	root.row();

	// 4. Server Filter Card
	let c4 = createCard('Server Filter (Optional)', 'f1fa8c');
	c4.add('[lightgray]Only show on specific server IPs (comma-separated, leave blank for all):[]').left().padBottom(4).row();
	let ipField = c4.field(ips, (txt) => { ips = txt; }).growX().height(38).get();

	root.row();

	// 5. Actions Card
	let actCard = root.table(Styles.black6).growX().padBottom(2).get();
	actCard.margin(8);
	let actRow = actCard.table().center().get();

	actRow.button('[#73d216]Save Button[]', Icon.ok, Styles.grayt, () => {
		if (!name && !iconName) {
			Vars.ui.showInfo('Button must have either a Label/Text or an Icon.');
			return;
		}

		let buttons = loadButtons();
		let targetObj = {
			name: name,
			iconName: iconName,
			iconType: iconType,
			noBackground: noBackground,
			width: widthVal,
			height: heightVal,
			commands: commands,
			enabled: enabled,
			ips: ips,
			x: isNew ? (btnData.x || (uiUtils.stageWidth() / 2)) : btnData.x,
			y: isNew ? (btnData.y || (uiUtils.stageHeight() / 2)) : btnData.y
		};

		if (isNew) {
			buttons.push(targetObj);
		} else {
			buttons[index] = targetObj;
		}

		saveButtons(buttons);
		rebuildHUD();
		d.hide();
		showMainMenu();
	}).size(170, 40).padRight(10);

	actRow.button('Cancel', Icon.cancel, Styles.grayt, () => {
		d.hide();
	}).size(140, 40);

	root.row();

	let pane = new ScrollPane(root);
	pane.setScrollingDisabled(true, false);
	pane.setOverscroll(false, true);

	let dw = Math.min(Core.scene.getWidth() * 0.95, 640);
	let dh = Math.min(Core.scene.getHeight() * 0.85, 520);
	d.cont.add(pane).width(dw).height(dh);
	d.show();
}

function handleCommand(args) {
	if (!dialog) buildUI();
	else showMainMenu();
	dialog.show();
}

interceptor.add('cbinds', handleCommand);
interceptor.add('cbind', handleCommand);

Events.on(EventType.ClientLoadEvent, () => {
	loadIconsList();
	if (Vars.state.isGame()) {
		rebuildHUD();
	}
});

Events.on(EventType.WorldLoadEvent, (e) => {
	hudBuilt = false;
	rebuildHUD();
});

Events.run(Trigger.update, () => {
	let inGame = Vars.state.isGame();
	let visible = inGame && Vars.ui.hudfrag.shown;

	if (visible && !hudBuilt) {
		rebuildHUD();
	} else if (!inGame && hudBuilt) {
		hudBuilt = false;
		activeTables.forEach((entry) => {
			try {
				entry.table.remove();
			} catch (e) {}
		});
		activeTables = [];
	}

	activeTables.forEach((entry) => {
		if (!entry.table) return;
		if (entry.table.visible !== visible) {
			entry.table.visible = visible;
		}
		if (visible) {
			// Idempotent: recomputed from anchor + offset, nothing written back.
			positionEntry(entry);
		}
	});
});

// Expose this module's config dialog to the mod settings screen (gear button).
require('qol-control/core/settings-ui').register(
	'ui/cbinds',
	'Custom Screen Binds',
	() => handleCommand([]),
	{ menuSafe: true }
);
