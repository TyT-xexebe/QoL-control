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

	let table = new Table();
	table.top().left();

	if (data.length === 0) {
		table.add('[lightgray]No keybinds found. Create one!').pad(10).row();
	} else {
		data.forEach((bindObj, index) => {
			let key = bindObj.key;
			let displayCmd = (bindObj.cmd || '').replace(/\n/g, ' | ');
			let rowTable = new Table();

			rowTable.check("", bindObj.enabled !== false, b => {
				let currentData = loadData();
				if (currentData[index]) {
					currentData[index].enabled = b;
					saveData(currentData);
				}
			}).padRight(5);

			let btnCell = rowTable.button(
				cons((b) => {
					b.left();
					b.add('[accent]' + key)
						.width(100)
						.left()
						.padRight(10)
						.get()
						.setEllipsis(true);

					let infoCell = b
						.add('[white]' + displayCmd)
						.left()
						.growX()
						.minWidth(0);
					infoCell.get().setEllipsis(true);
				}),
				() => {
					showEditBindDialog(index, bindObj);
				}
			);

			btnCell.size(260, 60).left().padRight(10);
			btnCell.get().setStyle(Styles.cleart);

			rowTable
				.button(Icon.edit, Styles.cleari, () => {
					showEditBindDialog(index, bindObj);
				})
				.size(45, 60);

			rowTable
				.button(Icon.trash, Styles.cleari, () => {
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
				})
				.size(45, 60);

			table.add(rowTable).padBottom(5).row();
		});
	}

	dialog.cont.add(new ScrollPane(table)).width(440).height(340).row();

	dialog.cont
		.button('Add Bind', Icon.add, () => {
			showEditBindDialog(-1, null);
		})
		.size(440, 50)
		.padTop(10);
}

function showListeningDialog(callback) {
	listeningDialog = new BaseDialog('Listening...');
	listeningDialog.cont.add('Press any key combination...').row();
	listeningDialog.cont
		.button('Cancel', () => {
			listeningCallback = null;
			listeningDialog.hide();
		})
		.size(150, 50)
		.padTop(10);
	listeningDialog.show();

	listeningCallback = (res) => {
		listeningDialog.hide();
		callback(res);
	};
}

function showEditBindDialog(index, existingBind) {
	let isNew = index === -1;
	let d = new BaseDialog(isNew ? 'Add Bind' : 'Edit Bind');

	let key = existingBind ? (existingBind.key || '') : '';
	let cmd = existingBind ? (existingBind.cmd || '') : '';
	let ips = existingBind ? (existingBind.ips || '') : '';
	let enabled = existingBind ? (existingBind.enabled !== false) : true;

	let t = new Table();

	t.add('Key: ').padRight(5).right();
	let keyBtnCell = t
		.button(key || 'Click to set', () => {
			showListeningDialog((res) => {
				key = res;
				keyBtnCell.get().setText(key);
			});
		})
		.size(250, 50);
	t.row();

	t.add('Server IPs (comma separated): ').colspan(2).padTop(10).left().row();
	let ipField = t.field(ips, (txt) => (ips = txt)).size(400, 45).colspan(2).get();
	t.row();

	t.add('Command: ').colspan(2).padTop(10).left().row();
	t.area(cmd, (txt) => (cmd = txt))
		.size(400, 150)
		.colspan(2)
		.padTop(5)
		.row();

	d.cont.add(t).row();

	d.buttons.button('@cancel', Icon.cancel, () => d.hide()).size(150, 50);
	d.buttons
		.button('@ok', Icon.ok, () => {
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
		})
		.size(150, 50);

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
