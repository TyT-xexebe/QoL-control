const interceptor = require('qol-control/core/interceptor');
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
	let isLocked = Core.settings.getBool('qol-cbinds-locked', false);

	buttons.forEach((btnConfig) => {
		if (btnConfig.enabled === false) return;
		if (btnConfig.ips && !isAllowedOnServer(btnConfig.ips)) return;

		let table = new Table();
		Vars.ui.hudGroup.addChild(table);

		let width = btnConfig.width || 50;
		let height = btnConfig.height || 50;
		table.setPosition(btnConfig.x || 100, btnConfig.y || 200);

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
		let startX = 0;
		let startY = 0;
		let currentX = btnConfig.x || 100;
		let currentY = btnConfig.y || 200;

		btn.get().addListener(
			extend(InputListener, {
				touchDown(event, x, y, pointer, button) {
					if (isLocked) return true;
					localDragging = false;
					isDraggingBtn = false;
					startX = x;
					startY = y;
					return true;
				},
				touchDragged(event, x, y, pointer) {
					if (isLocked) return true;
					if (
						!localDragging &&
						(Math.abs(x - startX) > 5 || Math.abs(y - startY) > 5)
					) {
						localDragging = true;
						isDraggingBtn = true;
					}
					if (localDragging) {
						currentX = Mathf.clamp(
							event.stageX,
							width / 2,
							Core.scene.getWidth() - width / 2
						);
						currentY = Mathf.clamp(
							event.stageY,
							height / 2,
							Core.scene.getHeight() - height / 2
						);
						table.setPosition(currentX, currentY);
					}
					return true;
				},
				touchUp(event, x, y, pointer) {
					if (isLocked) return true;
					if (localDragging) {
						btnConfig.x = currentX;
						btnConfig.y = currentY;
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

		activeTables.push({
			table: table,
			width: width,
			height: height
		});
	});
}

function buildUI() {
	dialog = new BaseDialog('Custom Screen Binds');
	dialog.addCloseButton();
	showMainMenu();
}

function showMainMenu() {
	let buttons = loadButtons();
	let isLocked = Core.settings.getBool('qol-cbinds-locked', false);

	dialog.cont.clear();

	let table = new Table();
	table.top().left();

	table.check('Lock Positions (Disable Dragging)', isLocked, b => {
		Core.settings.put('qol-cbinds-locked', b);
		Core.settings.forceSave();
		rebuildHUD();
	}).left().padBottom(10).row();

	if (buttons.length === 0) {
		table.add('[lightgray]No custom screen buttons found. Create one!').pad(10).row();
	} else {
		buttons.forEach((btnConfig, index) => {
			let rowTable = new Table();

			rowTable.check("", btnConfig.enabled !== false, b => {
				let currentButtons = loadButtons();
				if (currentButtons[index]) {
					currentButtons[index].enabled = b;
					saveButtons(currentButtons);
					rebuildHUD();
				}
			}).padRight(5);

			let drawable = getIconDrawable(btnConfig.iconName, btnConfig.iconType);
			let displayCmd = (btnConfig.commands || '').replace(/\n/g, ' | ');

			let btnCell = rowTable.button(cons(b => {
				b.left();
				if (drawable) {
					b.image(drawable).size(24).padRight(4);
				}
				b.add('[accent]' + (btnConfig.name || (btnConfig.iconName ? "[" + btnConfig.iconName + "]" : "Unnamed")))
					.width(100)
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

			btnCell.size(260, 60).left().padRight(10);
			btnCell.get().setStyle(Styles.cleart);

			rowTable.button(Icon.edit, Styles.cleari, () => {
				showEditDialog(index, btnConfig);
			}).size(45, 60);

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
			}).size(45, 60);

			table.add(rowTable).padBottom(5).row();
		});
	}

	dialog.cont.add(new ScrollPane(table)).width(440).height(340).row();

	dialog.cont.button('Add Screen Button', Icon.add, () => {
		showEditDialog(-1, {
			name: '',
			iconName: '',
			width: 50,
			height: 50,
			commands: '',
			x: Core.graphics.getWidth() / 2,
			y: Core.graphics.getHeight() / 2
		});
	}).size(440, 50).padTop(10);
}

function showEditDialog(index, btnData) {
	let isNew = index === -1;
	let d = new BaseDialog(isNew ? 'Add Screen Button' : 'Edit Screen Button');

	let name = btnData.name || '';
	let iconName = btnData.iconName || '';
	let iconType = btnData.iconType || '';
	let widthVal = btnData.width || 50;
	let heightVal = btnData.height || 50;
	let commands = btnData.commands || '';
	let noBackground = btnData.noBackground || false;
	let enabled = btnData.enabled !== false;
	let ips = btnData.ips || '';

	let t = new Table();
	t.top().left();

	t.add('Label/Text: ').padRight(5).right();
	let nameField = t.field(name, (n) => (name = n)).size(180, 45).get();

	let iconBtnCell = t.button(cons(b => {
		let drawable = getIconDrawable(iconName, iconType);
		if (drawable) {
			b.image(drawable).size(24).padRight(4);
		}
		b.add(iconName ? "[accent]" + iconName : "Select Icon");
	}), () => {
		showIconPicker((selectedIcon) => {
			iconName = selectedIcon.name;
			iconType = selectedIcon.type;
			iconBtnCell.get().clearChildren();
			let drawable = getIconDrawable(iconName, iconType);
			if (drawable) {
				iconBtnCell.get().image(drawable).size(24).padRight(4);
			}
			iconBtnCell.get().add("[accent]" + iconName);
		});
	});
	iconBtnCell.get().setStyle(Styles.cleart);
	iconBtnCell.size(160, 45).padLeft(5);
	t.row();

	t.add('Size (W x H): ').padRight(5).right().padTop(10);
	let sizeTable = new Table();
	let widthField = sizeTable.field(String(widthVal), (w) => {
		widthVal = parseInt(w) || 50;
	}).size(70, 45).get();

	sizeTable.add(' x ').padLeft(5).padRight(5);

	let heightField = sizeTable.field(String(heightVal), (h) => {
		heightVal = parseInt(h) || 50;
	}).size(70, 45).get();

	sizeTable.button('Reset', Styles.cleart, () => {
		widthVal = 50;
		heightVal = 50;
		widthField.setText('50');
		heightField.setText('50');
	}).size(70, 45).padLeft(10);

	t.add(sizeTable).padTop(10).left();
	t.row();

	t.check("No Background", noBackground, (b) => {
		noBackground = b;
	}).colspan(2).padTop(10).left().row();

	t.add('Server IPs (comma separated): ').colspan(2).padTop(10).left().row();
	let ipField = t.field(ips, (txt) => (ips = txt)).size(400, 45).colspan(2).get();
	t.row();

	t.add('Commands/Messages: ').colspan(2).padTop(15).left().row();
	t.area(commands, (txt) => (commands = txt))
		.size(400, 150)
		.colspan(2)
		.padTop(5)
		.row();

	d.cont.add(t).row();

	d.buttons.button('@cancel', Icon.cancel, () => d.hide()).size(150, 50);
	d.buttons.button('@ok', Icon.ok, () => {
		if (!name && !iconName) {
			Vars.ui.showInfo('Button must have either a Label/Text or an Icon.');
			return;
		}

		let buttons = loadButtons();
		if (isNew) {
			buttons.push({
				name: name,
				iconName: iconName,
				iconType: iconType,
				noBackground: noBackground,
				width: widthVal,
				height: heightVal,
				commands: commands,
				enabled: enabled,
				ips: ips,
				x: btnData.x || (Core.graphics.getWidth() / 2),
				y: btnData.y || (Core.graphics.getHeight() / 2)
			});
		} else {
			buttons[index] = {
				name: name,
				iconName: iconName,
				iconType: iconType,
				noBackground: noBackground,
				width: widthVal,
				height: heightVal,
				commands: commands,
				enabled: enabled,
				ips: ips,
				x: btnData.x,
				y: btnData.y
			};
		}

		saveButtons(buttons);
		rebuildHUD();
		d.hide();
		showMainMenu();
	}).size(150, 50);

	d.show();
}

function handleCommand(args) {
	if (args.length > 1) {
		let sub = args[1].toLowerCase();
		if (sub === 'lock') {
			let val = true;
			if (args.length > 2) {
				if (!interceptor.isBooleanArg(args[2])) {
					Vars.ui.showInfoFade('[scarlet]Usage: !cbinds lock <1/0?>');
					return;
				}
				val = interceptor.parseToggle(Core.settings.getBool('qol-cbinds-locked', false), args[2]);
			} else {
				val = !Core.settings.getBool('qol-cbinds-locked', false);
			}
			Core.settings.put('qol-cbinds-locked', val);
			Core.settings.forceSave();
			rebuildHUD();
			if (val) {
				Vars.ui.showInfoFade('[accent]Custom binds locked!');
			} else {
				Vars.ui.showInfoFade('[accent]Custom binds unlocked!');
			}
			return;
		}
	}
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
			let clampedX = Mathf.clamp(entry.table.x, entry.width / 2, Core.scene.getWidth() - entry.width / 2);
			let clampedY = Mathf.clamp(entry.table.y, entry.height / 2, Core.scene.getHeight() - entry.height / 2);
			if (clampedX !== entry.table.x || clampedY !== entry.table.y) {
				entry.table.setPosition(clampedX, clampedY);
			}
		}
	});
});
