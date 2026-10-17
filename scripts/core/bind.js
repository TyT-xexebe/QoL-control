const interceptor = require('qol-control/core/interceptor');
const SETTINGS_KEY = 'qol-binds';

const allKeys = KeyCode.values();
let dialog = null;
let bindsCache = [];
let listeningCallback = null;
let listeningDialog = null;

function loadData() {
	try {
		let dataStr = Core.settings.getString(SETTINGS_KEY, '[]');
		let data;
		try {
			data = JSON.parse(dataStr);
		} catch (e) {
			data = [];
		}

		if (data && typeof data === 'object' && !Array.isArray(data)) {
			let migrated = [];
			for (let key in data) {
				let oldObj = data[key];
				if (typeof oldObj === 'string') {
					oldObj = {
						cmd: oldObj,
						enabled: true,
						ips: ''
					};
				}
				let newObj = {
					key: key,
					cmd: oldObj.cmd || '',
					enabled: oldObj.enabled !== false,
					ips: oldObj.ips || ''
				};
				migrated.push(newObj);
			}
			data = migrated;
			saveData(data);
		} else if (!Array.isArray(data)) {
			data = [];
		}

		data.forEach(item => {
			if (!item.key) item.key = '';
			if (item.enabled === undefined) item.enabled = true;
			if (item.ips === undefined) item.ips = '';
			if (item.cmd === undefined) item.cmd = '';
		});

		bindsCache = data;
		return data;
	} catch (e) {
		bindsCache = [];
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

function saveData(data) {
	bindsCache = data;
	Core.settings.put(SETTINGS_KEY, JSON.stringify(data));
}

loadData();

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

function buildUI() {
	dialog = new BaseDialog('Key Binds Menu');
	dialog.addCloseButton();
	showMainMenu();
}

function showMainMenu() {
	let data = loadData();
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

	let c1 = createCard('Configured Keybinds (' + data.length + ')', '50fa7b');

	if (data.length === 0) {
		c1.add('[lightgray]No keybinds configured. Click button below to add one![]').pad(10).left().row();
	} else {
		data.forEach((bindObj, index) => {
			let key = bindObj.key;
			let displayCmd = (bindObj.cmd || "").replace(/\r/g, "").replace(/\n/g, " | ");
			let rowTable = c1.table().growX().pad(2).get();

			rowTable.check("", bindObj.enabled !== false, b => {
				let currentData = loadData();
				if (currentData[index]) {
					currentData[index].enabled = b;
					saveData(currentData);
				}
			}).padRight(6);

			let btnCell = rowTable.button(cons((b) => {
				b.left();
				b.add('[accent]' + key).width(110).left().padRight(10).get().setEllipsis(true);
				let infoCell = b.add('[white]' + displayCmd).left().growX().minWidth(0);
				infoCell.get().setEllipsis(true);
			}), () => {
				showEditBindDialog(index, bindObj);
			});

			btnCell.growX().height(48).left().padRight(8);
			btnCell.get().setStyle(Styles.grayt);

			rowTable.button(Icon.edit, Styles.cleari, () => {
				showEditBindDialog(index, bindObj);
			}).size(40, 48).padRight(4);

			rowTable.button(Icon.trash, Styles.cleari, () => {
				Vars.ui.showConfirm(
					'Delete Bind',
					"Are you sure you want to delete this bind?",
					() => {
						let currentData = loadData();
						currentData.splice(index, 1);
						saveData(currentData);
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

	actRow.button('[#73d216]Add New Bind[]', Icon.add, Styles.grayt, () => {
		showEditBindDialog(-1, null);
	}).size(220, 40);

	root.row();

	let pane = new ScrollPane(root);
	pane.setScrollingDisabled(true, false);
	pane.setOverscroll(false, true);

	let dw = Math.min(Core.scene.getWidth() * 0.95, 680);
	let dh = Math.min(Core.scene.getHeight() * 0.85, 480);
	dialog.cont.add(pane).width(dw).height(dh);
}

function showListeningDialog(callback) {
	listeningDialog = new BaseDialog('Listening for Key...');
	listeningDialog.addCloseButton();

	let root = new Table();
	root.top().margin(16);

	let card = root.table(Styles.black6).growX().padBottom(10).get();
	card.margin(14);
	card.add('[#50fa7b]Press Any Key Combination[]').style(Styles.outlineLabel).fontScale(1.0).padBottom(8).row();
	card.image().color(Color.valueOf('3a3a46')).height(1.5).growX().padBottom(12).row();
	card.add('[lightgray]Press the desired key or combination (e.g. [accent]B[], [accent]Ctrl+Z[], [accent]Alt+1[])...[]').padBottom(10).row();

	let cancelBtn = card.button('Cancel', Icon.cancel, Styles.grayt, () => {
		listeningCallback = null;
		listeningDialog.hide();
	}).size(160, 42).get();

	root.row();
	listeningDialog.cont.add(root).width(Math.min(Core.scene.getWidth() * 0.95, 480));
	listeningDialog.show();

	listeningCallback = (res) => {
		listeningDialog.hide();
		callback(res);
	};
}

function showEditBindDialog(index, existingBind) {
	let isNew = index === -1;
	let d = new BaseDialog(isNew ? 'Add Key Bind' : 'Edit Key Bind');
	d.addCloseButton();

	let key = existingBind ? (existingBind.key || '') : '';
	let cmd = existingBind ? (existingBind.cmd || '') : '';
	let ips = existingBind ? (existingBind.ips || '') : '';
	let enabled = existingBind ? (existingBind.enabled !== false) : true;

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

	// 1. Key Trigger Card
	let c1 = createCard('Key Trigger', '50fa7b');
	let keyRow = c1.table().growX().pad(2).get();
	keyRow.add('[lightgray]Assigned Key: []').left().padRight(8);

	// Keep the Cell, not the button: the callback below needs .get() to reach the
	// TextButton and update its label. Calling .get() here too left a bare
	// TextButton in the variable and crashed with
	// "Cannot find function get in object TextButton" once a key was recorded.
	let keyBtnCell = keyRow
		.button(key ? '[accent]' + key + '[]' : '[gray]Click to record key...[]', Styles.grayt, () => {
			showListeningDialog((res) => {
				key = res;
				keyBtnCell.get().setText('[accent]' + key + '[]');
			});
		})
		.height(40)
		.growX();
	c1.row();

	c1.check('Enable this bind', enabled, (b) => {
		enabled = b;
	}).padTop(6).left().row();

	root.row();

	// 2. Command Action Card
	let c2 = createCard('Command / Action', '8be9fd');
	c2.add('[lightgray]Command or chat message to execute when pressed:[]').left().padBottom(4).row();
	let cmdArea = c2.area(cmd, (txt) => { cmd = txt; }).growX().height(110).get();
	c2.row();
	c2.add('[gray]Tip: Multiple commands can be chained using newlines or |[]').fontScale(0.85).left().padTop(4).row();

	root.row();

	// 3. Server Filter Card
	let c3 = createCard('Server Filter (Optional)', 'ffd37f');
	c3.add('[lightgray]Only execute on specific server IPs (comma-separated, leave blank for all):[]').left().padBottom(4).row();
	let ipField = c3.field(ips, (txt) => { ips = txt; }).growX().height(38).get();

	root.row();

	// 4. Action Buttons Card
	let actCard = root.table(Styles.black6).growX().padBottom(2).get();
	actCard.margin(8);
	let actRow = actCard.table().center().get();

	actRow.button('[#73d216]Save Bind[]', Icon.ok, Styles.grayt, () => {
		if (!key || !cmd) {
			Vars.ui.showInfo('Key and Command cannot be empty.');
			return;
		}

		let data = loadData();
		let newBind = {
			key: key,
			cmd: cmd,
			enabled: enabled,
			ips: ips
		};
		if (isNew) {
			data.push(newBind);
		} else {
			data[index] = newBind;
		}
		saveData(data);

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

interceptor.add('bind', () => {
	if (!dialog) buildUI();
	else showMainMenu();
	dialog.show();
});

Events.run(Trigger.update, () => {
	if (listeningCallback) {
		for (let i = 0; i < allKeys.length; i++) {
			let k = allKeys[i];
			if (
				k === KeyCode.controlLeft ||
				k === KeyCode.controlRight ||
				k === KeyCode.shiftLeft ||
				k === KeyCode.shiftRight ||
				k === KeyCode.altLeft ||
				k === KeyCode.altRight ||
				k === KeyCode.unknown
			)
				continue;

			if (Core.input.keyTap(k)) {
				let ctrl =
					Core.input.keyDown(KeyCode.controlLeft) ||
					Core.input.keyDown(KeyCode.controlRight);
				let shift =
					Core.input.keyDown(KeyCode.shiftLeft) ||
					Core.input.keyDown(KeyCode.shiftRight);
				let alt =
					Core.input.keyDown(KeyCode.altLeft) ||
					Core.input.keyDown(KeyCode.altRight);

				let prefix = '';
				if (ctrl) prefix += 'ctrl+';
				if (alt) prefix += 'alt+';
				if (shift) prefix += 'shift+';

				let res = prefix + k.name();
				let cb = listeningCallback;
				listeningCallback = null;
				cb(res);
				break;
			}
		}
		return;
	}

	if (!Vars.state.isGame() || Vars.state.isMenu()) return;
	if (Core.scene.hasKeyboard() || Vars.ui.chatfrag.shown()) return;

	for (let i = 0; i < bindsCache.length; i++) {
		let bindObj = bindsCache[i];
		if (!bindObj || bindObj.enabled === false) continue;
		let bindStr = bindObj.key;
		if (!bindStr) continue;

		let parts = bindStr.split('+');
		let baseKeyStr = parts.pop();
		let needsCtrl = parts.indexOf('ctrl') !== -1;
		let needsAlt = parts.indexOf('alt') !== -1;
		let needsShift = parts.indexOf('shift') !== -1;

		let baseKey;
		try {
			baseKey = KeyCode.valueOf(baseKeyStr);
		} catch (e) {
			continue;
		}

		if (Core.input.keyTap(baseKey)) {
			let hasCtrl =
				Core.input.keyDown(KeyCode.controlLeft) ||
				Core.input.keyDown(KeyCode.controlRight);
			let hasAlt =
				Core.input.keyDown(KeyCode.altLeft) ||
				Core.input.keyDown(KeyCode.altRight);
			let hasShift =
				Core.input.keyDown(KeyCode.shiftLeft) ||
				Core.input.keyDown(KeyCode.shiftRight);

			if (
				needsCtrl === hasCtrl &&
				needsAlt === hasAlt &&
				needsShift === hasShift
			) {
				if (isAllowedOnServer(bindObj.ips)) {
					executeChat(bindObj.cmd);
				}
			}
		}
	}
});

// Expose this module's config dialog to the mod settings screen (gear button).
require('qol-control/core/settings-ui').register(
	'core/bind',
	'Key Binds',
	() => {
		if (!dialog) buildUI();
		else showMainMenu();
		dialog.show();
	},
	{ menuSafe: true }
);
