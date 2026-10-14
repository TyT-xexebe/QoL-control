const notify = require('qol-control/core/logger').notify;
const interceptor = require('qol-control/core/interceptor');

const state = {
	units: { mono: true, poly: false, pulsar: true, mega: true, quasar: true },
	items: {
		copper: true,
		lead: true,
		sand: true,
		coal: true,
		titanium: true,
		beryllium: true,
		scrap: false,
	},
	itemTiers: {
		copper: 1,
		lead: 1,
		sand: 1,
		scrap: 1,
		coal: 2,
		titanium: 3,
		beryllium: 3,
	},
	ignored: {},
	interval: 5,
	freePercent: 50,
};

try {
	let u = Core.settings.getString('qol-mining-units', '');
	if (u) Object.assign(state.units, JSON.parse(u));
	let i = Core.settings.getString('qol-mining-items', '');
	if (i) Object.assign(state.items, JSON.parse(i));
	let ig = Core.settings.getString('qol-mining-ignored', '');
	if (ig) Object.assign(state.ignored, JSON.parse(ig));
	let f = Core.settings.getInt('qol-mining-free', 50);
	state.freePercent = f;
	let iv = Core.settings.getInt('qol-mining-interval', 5);
	state.interval = iv;
} catch (e) {}

const itemColors = {
	copper: '[#d99d73]',
	lead: '[#8c7fa9]',
	sand: '[#e8d174]',
	coal: '[#595959]',
	titanium: '[#8da1e3]',
	beryllium: '[#54b582]',
	scrap: '[#9b9b9b]',
};

let miningTask = null;
let idleTrackerTask = null;
let unitIdleData = {};
let lastDistribution = {};

function startIdleTracker() {
	if (idleTrackerTask) return;
	unitIdleData = {};
	idleTrackerTask = Timer.schedule(
		() => {
			if (!Vars.state.isGame()) return;
			let currentIds = {};
			const playerTeam = Vars.player.team();
			Groups.unit.each((u) => {
				if (u.team === playerTeam && !u.dead && u.type.mineTier > 0) {
					currentIds[u.id] = true;
					let data = unitIdleData[u.id];
					if (!data) {
						unitIdleData[u.id] = { x: u.x, y: u.y, time: 0 };
					} else {
						if (Mathf.dst2(u.x, u.y, data.x, data.y) < 256) {
							data.time += 1;
						} else {
							data.x = u.x;
							data.y = u.y;
							data.time = 0;
						}
					}
				}
			});
			for (let id in unitIdleData) {
				if (!currentIds[id]) delete unitIdleData[id];
			}
		},
		0,
		1
	);
}

function stopIdleTracker() {
	if (idleTrackerTask) {
		idleTrackerTask.cancel();
		idleTrackerTask = null;
	}
	unitIdleData = {};
}

function runMining() {
	const player = Vars.player;
	if (!player || !Vars.state.isGame()) return;

	const playerTeam = player.team();
	if (!playerTeam) return;

	const core = playerTeam.core();
	if (!core) return;

	const validItems = [];
	const priorities = new ObjectMap();

	let capacity = core.storageCapacity || 4000;
	let limit = Math.floor(capacity * 0.9);

	Vars.content.items().each((it) => {
		if (
			state.items[it.name] &&
			(Vars.indexer.hasOre(it) ||
				(Vars.indexer.hasWallOre && Vars.indexer.hasWallOre(it)))
		) {
			let amount = core.items.get(it);
			if (amount < limit) {
				validItems.push(it);
				priorities.put(it, 1 / Math.pow(Math.max(amount, 1), 2));
			}
		}
	});

	if (validItems.length === 0) {
		lastDistribution = {};
		return;
	}

	const unitGroups = {};
	const playerCommandedGroups = {};

	Groups.unit.each((u) => {
		let isAssisting =
			global.qolAssistingUnits && global.qolAssistingUnits[u.id];

		if (
			u.team === playerTeam &&
			!u.dead &&
			u.type.mineTier > 0 &&
			u.player == null &&
			state.units[u.type.name] &&
			!(u.controller() instanceof LogicAI) &&
			!isAssisting
		) {
			let typeName = u.type.name;
			if (!unitGroups[typeName]) {
				unitGroups[typeName] = [];
				playerCommandedGroups[typeName] = [];
			}

			let isPlayerCommanded = false;
			try {
				let ctrl = u.controller();
				if (ctrl) {
					let cmd = ctrl.command;
					if (cmd && cmd !== UnitCommand.mineCommand) {
						isPlayerCommanded = true;
					} else {
						let leader = ctrl.leader;
						if (leader && leader.controller) {
							let lCtrl = leader.controller();
							if (
								lCtrl &&
								lCtrl.command &&
								lCtrl.command !== UnitCommand.mineCommand
							) {
								isPlayerCommanded = true;
							}
						}
					}
				}
			} catch (e) {}

			if (isPlayerCommanded) {
				let idleData = unitIdleData[u.id];
				if (idleData && idleData.time >= 5) {
					isPlayerCommanded = false;
				}
			}

			if (isPlayerCommanded) {
				playerCommandedGroups[typeName].push(u);
			} else {
				unitGroups[typeName].push(u);
			}
		}
	});

	for (let typeName in playerCommandedGroups) {
		let playerUnits = playerCommandedGroups[typeName];
		let miningUnits = unitGroups[typeName];
		let total = playerUnits.length + miningUnits.length;
		let maxPlayerUnits = Math.floor(total * (state.freePercent / 100));

		while (playerUnits.length > maxPlayerUnits) {
			miningUnits.push(playerUnits.pop());
		}
	}

	lastDistribution = {};

	for (let typeName in unitGroups) {
		let list = unitGroups[typeName];
		if (list.length === 0) continue;

		let tier = list[0].type.mineTier;

		let availableForUnit = validItems.filter((it) => {
			let tierOk = (state.itemTiers[it.name] || 1) <= tier;
			let unitAllowed = !(
				state.ignored[typeName] && state.ignored[typeName][it.name]
			);
			return tierOk && unitAllowed;
		});

		if (availableForUnit.length === 0) continue;

		let totalPriority = 0;
		availableForUnit.forEach((it) => (totalPriority += priorities.get(it)));

		let sumAssigned = 0,
			assignments = [];

		availableForUnit.forEach((it) => {
			let count = Math.floor(
				(priorities.get(it) / totalPriority) * list.length
			);
			assignments.push({
				item: it,
				count: count,
				mod: (priorities.get(it) / totalPriority) * list.length - count,
			});
			sumAssigned += count;
		});

		if (sumAssigned < list.length) {
			assignments.sort((a, b) => b.mod - a.mod);
			for (let i = 0; i < list.length - sumAssigned; i++)
				assignments[i].count++;
		}

		lastDistribution[typeName] = {};
		assignments.forEach((as) => {
			if (as.count > 0) {
				lastDistribution[typeName][as.item.name] = as.count;
			}
		});

		let itemNeeds = {};
		let unitsToCommand = {};

		assignments.forEach((as) => {
			itemNeeds[as.item.name] = as.count;
			unitsToCommand[as.item.name] = { item: as.item, ids: new IntSeq() };
		});

		let unassignedUnits = [];

		list.forEach((u) => {
			let currentItem = null;
			if (u.mineTile && u.mineTile.drop()) {
				currentItem = u.mineTile.drop();
			}
			if (!currentItem && u.controller() && u.controller().targetItem) {
				currentItem = u.controller().targetItem;
			}

			if (currentItem && itemNeeds[currentItem.name] > 0) {
				itemNeeds[currentItem.name]--;
			} else {
				unassignedUnits.push(u);
			}
		});

		assignments.forEach((as) => {
			let needed = itemNeeds[as.item.name];
			let cmdObj = unitsToCommand[as.item.name];
			for (let i = 0; i < needed; i++) {
				if (unassignedUnits.length > 0) {
					let u = unassignedUnits.pop();
					cmdObj.ids.add(u.id);
				}
			}

			if (cmdObj.ids.size > 0) {
				Call.setUnitCommand(
					player,
					cmdObj.ids.toArray(),
					UnitCommand.mineCommand
				);
				let stance = ItemUnitStance.getByItem(cmdObj.item);
				if (stance) {
					Call.setUnitStance(
						player,
						cmdObj.ids.toArray(),
						UnitStance.mineAuto,
						false
					);
					Call.setUnitStance(
						player,
						cmdObj.ids.toArray(),
						stance,
						true
					);
				}
			}
		});
	}
}

Events.on(WorldLoadEvent, () => {
	lastDistribution = {};
	if (miningTask) {
		miningTask.cancel();
		miningTask = null;
	}
	stopIdleTracker();
});

function showMiningSettingsDialog() {
	let d = new BaseDialog('Mining Controller Config');
	d.addCloseButton();

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

	function render() {
		root.clearChildren();

		// 1. Status & Timing Card
		let c1 = createCard('Mining Status & Execution', '73d216');

		let statusRow = c1.table().growX().pad(2).get();
		statusRow.add('[lightgray]Mining Engine: []').left().padRight(8);
		let statusBtn = statusRow.button(miningTask ? '[#73d216]● RUNNING[]' : '[#ff5555]■ STOPPED[]', Styles.grayt, () => {
			if (miningTask) {
				miningTask.cancel();
				miningTask = null;
				stopIdleTracker();
				notify('[scarlet]Mining stopped');
			} else {
				let interval = state.interval || 5;
				if (interval <= 0) interval = 5;
				state.interval = interval;
				miningTask = Timer.schedule(() => {
					try {
						runMining();
					} catch(e) {
						if (miningTask) miningTask.cancel();
						miningTask = null;
						stopIdleTracker();
					}
				}, 0, interval);
				startIdleTracker();
				notify('[green]Mining started ([accent]' + interval + '[green]s)');
			}
			render();
		}).size(180, 36).get();
		c1.row();

		let ivLabel = c1.add('[lightgray]Update Interval: [accent]' + state.interval + ' sec[]').left().pad(2).get();
		c1.row();
		c1.slider(1, 30, 1, state.interval, (v) => {
			let val = Math.round(v);
			if (val !== state.interval) {
				state.interval = val;
				ivLabel.setText('[lightgray]Update Interval: [accent]' + val + ' sec[]');
				if (miningTask) {
					miningTask.cancel();
					miningTask = Timer.schedule(() => {
						try { runMining(); } catch(e) { if (miningTask) miningTask.cancel(); miningTask = null; stopIdleTracker(); }
					}, 0, state.interval);
				}
			}
		}).growX().padBottom(6).row();

		let freeLabel = c1.add('[lightgray]Reserve Free Units: [accent]' + state.freePercent + '%[]').left().pad(2).get();
		c1.row();
		c1.slider(0, 90, 5, state.freePercent, (v) => {
			let val = Math.round(v);
			state.freePercent = val;
			freeLabel.setText('[lightgray]Reserve Free Units: [accent]' + val + '%[]');
		}).growX().padBottom(6).row();

		root.row();

		// 2. Mining Fleet Units Card
		let c2 = createCard('Mining Fleet Units', '8be9fd');
		let unitGrid = c2.table().growX().padBottom(4).get();
		let col = 0;
		for (let uName in state.units) {
			let currentUnit = uName;
			let uObj = Vars.content ? Vars.content.unit(currentUnit) : null;
			let cell = unitGrid.table().pad(2).left().get();
			if (uObj && uObj.uiIcon) {
				cell.image(uObj.uiIcon).size(24).padRight(4);
			}
			cell.check(currentUnit.toUpperCase(), state.units[currentUnit], b => {
				state.units[currentUnit] = b;
			}).padRight(12);

			col++;
			if (col % 3 === 0) unitGrid.row();
		}
		c2.row();

		let unitActRow = c2.table().left().padTop(4).get();
		unitActRow.button('Enable All', Styles.grayt, () => {
			for (let u in state.units) state.units[u] = true;
			render();
		}).size(120, 32).padRight(8);
		unitActRow.button('Disable All', Styles.grayt, () => {
			for (let u in state.units) state.units[u] = false;
			render();
		}).size(120, 32);

		root.row();

		// 3. Target Resources Card
		let c3 = createCard('Target Resources to Mine', 'ffd37f');
		let itemGrid = c3.table().growX().padBottom(4).get();
		let iCol = 0;
		for (let iName in state.items) {
			let currentItem = iName;
			let color = itemColors[currentItem] || '[white]';
			let itObj = Vars.content ? Vars.content.item(currentItem) : null;
			let cell = itemGrid.table().pad(2).left().get();
			if (itObj && itObj.uiIcon) {
				cell.image(itObj.uiIcon).size(24).padRight(4);
			}
			cell.check(color + currentItem.toUpperCase() + '[]', state.items[currentItem], b => {
				state.items[currentItem] = b;
				render();
			}).padRight(12);

			iCol++;
			if (iCol % 3 === 0) itemGrid.row();
		}
		c3.row();

		let itemActRow = c3.table().left().padTop(4).get();
		itemActRow.button('Select All', Styles.grayt, () => {
			for (let it in state.items) state.items[it] = true;
			render();
		}).size(120, 32).padRight(8);
		itemActRow.button('Deselect All', Styles.grayt, () => {
			for (let it in state.items) state.items[it] = false;
			render();
		}).size(120, 32);

		root.row();

		// 4. Exclusion Matrix Card
		let c4 = createCard('Unit Resource Exclusion Matrix', 'ff79c6');
		let ignoreTable = c4.table().growX().padBottom(4).get();
		ignoreTable.left();

		ignoreTable.add('').padRight(8);
		for (let iName in state.items) {
			let color = itemColors[iName] || '[white]';
			let itObj = Vars.content ? Vars.content.item(iName) : null;
			let headerCell = ignoreTable.table().padRight(4).center().get();
			if (itObj && itObj.uiIcon) {
				headerCell.image(itObj.uiIcon).size(18).padRight(2);
			}
			headerCell.add(color + iName.substring(0, 3).toUpperCase() + '[]').fontScale(0.85);
		}
		ignoreTable.row();

		for (let uName in state.units) {
			let currentUnit = uName;
			ignoreTable.add('[lightgray]' + currentUnit.toUpperCase() + '[]').padRight(8).left();

			for (let iName in state.items) {
				let currentItem = iName;
				let isGlobalEnabled = state.items[currentItem];

				let uType = Vars.content ? Vars.content.unit(currentUnit) : null;
				let unitMineTier = uType ? uType.mineTier : ({ mono: 1, poly: 2, pulsar: 2, mega: 3, quasar: 3 }[currentUnit] || 1);
				let itemTier = state.itemTiers[currentItem] || 1;

				if (!isGlobalEnabled || unitMineTier < itemTier) {
					ignoreTable.add('[gray]-[]').size(32, 22).padRight(4).center();
				} else {
					let isIgnored = state.ignored[currentUnit] && state.ignored[currentUnit][currentItem];

					let fillColor = isIgnored ? Color.valueOf('e53935') : Color.valueOf('43a047');
					let btn = new Button(Styles.cleart);
					btn.margin(0);
					btn.image(Tex.whiteui).color(fillColor).grow();
					btn.clicked(run(() => {
						if (!state.ignored[currentUnit]) state.ignored[currentUnit] = {};
						if (isIgnored) {
							delete state.ignored[currentUnit][currentItem];
							if (Object.keys(state.ignored[currentUnit]).length === 0) {
								delete state.ignored[currentUnit];
							}
						} else {
							state.ignored[currentUnit][currentItem] = true;
						}
						render();
					}));
					ignoreTable.add(btn).size(32, 22).padRight(4);
				}
			}
			ignoreTable.row();
		}
		root.row();

		// 5. Quick Actions & Save Card
		let actCard = root.table(Styles.black6).growX().padBottom(2).get();
		actCard.margin(8);
		let actRow = actCard.table().center().get();

		actRow.button('[#73d216]Save Defaults[]', Icon.save, Styles.grayt, () => {
			try {
				Core.settings.put('qol-mining-units', String(JSON.stringify(state.units)));
				Core.settings.put('qol-mining-items', String(JSON.stringify(state.items)));
				Core.settings.put('qol-mining-ignored', String(JSON.stringify(state.ignored)));
				Core.settings.put('qol-mining-free', new java.lang.Integer(state.freePercent));
				Core.settings.put('qol-mining-interval', new java.lang.Integer(state.interval));
				if (typeof Core.settings.forceSave === 'function') Core.settings.forceSave();
				notify('[green]Mining settings saved');
			} catch (err) {
				notify('[scarlet]Save error: ' + err);
			}
		}).size(180, 38).padRight(10);

		actRow.button('Close', Icon.cancel, Styles.grayt, () => {
			d.hide();
		}).size(140, 38);
	}

	let pane = new ScrollPane(root);
	pane.setScrollingDisabled(true, false);
	pane.setOverscroll(false, true);

	let dw = Math.min(Core.scene.getWidth() * 0.95, 780);
	let dh = Math.min(Core.scene.getHeight() * 0.85, 540);
	d.cont.add(pane).width(dw).height(dh);

	render();
	d.show();
}

const miningHandler = (args) => {
	let arg1 = args[1] ? String(args[1]).toLowerCase().trim() : '';

	if (arg1 === 'ui') {
		showMiningSettingsDialog();
		return;
	}

	if (arg1 === 'stop') {
		if (miningTask) {
			miningTask.cancel();
			miningTask = null;
			stopIdleTracker();
			notify('[scarlet]Mining stopped');
		} else notify('[lightgrey]Mining not running');
		return;
	}

	if (arg1 === 'save') {
		try {
			Core.settings.put('qol-mining-units', String(JSON.stringify(state.units)));
			Core.settings.put('qol-mining-items', String(JSON.stringify(state.items)));
			Core.settings.put('qol-mining-ignored', String(JSON.stringify(state.ignored)));
			try {
				Core.settings.put('qol-mining-free', new java.lang.Integer(state.freePercent));
				Core.settings.put('qol-mining-interval', new java.lang.Integer(state.interval));
			} catch (e) {
				Core.settings.put('qol-mining-free', state.freePercent);
				Core.settings.put('qol-mining-interval', state.interval);
			}
			if (typeof Core.settings.forceSave === 'function') {
				Core.settings.forceSave();
			}
			notify('[green]Mining settings saved');
		} catch (err) {
			notify('[scarlet]Save error: ' + err);
		}
		return;
	}

	if (arg1 === 'free' || arg1 === 'f') {
		let pct = parseInt(args[2]);
		if (isNaN(pct) || pct < 0 || pct > 100)
			return notify('[lightgrey]!mining free <0-100>');
		state.freePercent = pct;
		notify('[green]Free units set to [accent]' + pct + '%');
		return;
	}

	if (arg1 === 'set' || arg1 === 's') {
		let time;
		if (args[2] !== undefined && String(args[2]).trim() !== '') {
			time = parseFloat(args[2]);
			if (isNaN(time) || time < 0)
				return notify('[lightgrey]!mining set <sec>');
		} else {
			time = state.interval;
			if (time <= 0) time = 5;
		}

		state.interval = time;
		if (time === 0) {
			runMining();
			notify('[green]Mining executed once');
		} else {
			if (miningTask) miningTask.cancel();
			miningTask = Timer.schedule(
				() => {
					try {
						runMining();
					} catch (err) {
						if (miningTask) miningTask.cancel();
						miningTask = null;
						stopIdleTracker();
					}
				},
				0,
				time
			);
			startIdleTracker();
			notify('[green]Mining started ([accent]' + time + '[green]s)');
		}
		return;
	}

	if (arg1 === 'ignore' || arg1 === 'ig') {
		if (args.length < 4)
			return notify('[lightgrey]!mining ignore <unit> <items.../clear>');

		let uName = args[2] ? String(args[2]).toLowerCase().trim() : '';
		if (!state.units.hasOwnProperty(uName))
			return notify('[scarlet]Unknown unit: ' + uName);

		let arg3 = args[3] ? String(args[3]).toLowerCase().trim() : '';
		if (arg3 === 'clear') {
			delete state.ignored[uName];
			return notify('[green]Cleared ignores for ' + uName);
		}

		if (!state.ignored[uName]) state.ignored[uName] = {};

		let changed = [];
		let lastArg = args[args.length - 1] ? String(args[args.length - 1]).toLowerCase().trim() : '';
		let explicitState = null;

		if (lastArg === '1' || lastArg === 'true' || lastArg === 'on')
			explicitState = true;
		else if (lastArg === '0' || lastArg === 'false' || lastArg === 'off')
			explicitState = false;

		let limit = explicitState !== null ? args.length - 1 : args.length;

		for (let i = 3; i < limit; i++) {
			let iName = args[i] ? String(args[i]).toLowerCase().trim() : '';
			if (state.items.hasOwnProperty(iName)) {
				let currentState = state.ignored[uName][iName] || false;
				let newState =
					explicitState !== null ? explicitState : !currentState;

				if (newState) {
					state.ignored[uName][iName] = true;
					changed.push('[scarlet]' + iName);
				} else {
					delete state.ignored[uName][iName];
					changed.push('[green]' + iName);
				}
			}
		}

		if (Object.keys(state.ignored[uName]).length === 0)
			delete state.ignored[uName];
		if (changed.length > 0)
			notify('[lightgrey]' + uName + ' ignores: ' + changed.join(' '));
		return;
	}

	if (arg1 === 'status' || arg1 === 'st') {
		let uStr = '',
			iStr = '';
		for (let k in state.units)
			uStr += (state.units[k] ? '[green]' : '[scarlet]') + k + ' ';
		for (let k in state.items)
			iStr += (state.items[k] ? '[green]' : '[scarlet]') + k + ' ';

		let statsStr = '';
		for (let uName in state.units) {
			if (!state.units[uName] || !lastDistribution[uName]) continue;

			let row = '';
			let uStats = lastDistribution[uName];

			for (let iName in itemColors) {
				if (uStats[iName]) {
					row += itemColors[iName] + uStats[iName] + ' ';
				}
			}

			if (row !== '') {
				statsStr += '\n[lightgrey]' + uName + ' | ' + row;
			}
		}

		let igStr = '';
		for (let uName in state.ignored) {
			let igItems = Object.keys(state.ignored[uName]);
			if (igItems.length > 0) {
				igStr +=
					'\n[lightgrey]' +
					uName +
					' ignores: [scarlet]' +
					igItems.join(', ');
			}
		}

		let finalMsg =
			'\n[lightgrey]State ' +
			(miningTask
				? '[lightgrey]Active ([accent]' +
					state.interval +
					'[lightgrey]s)'
				: '[scarlet]Inactive') +
			'\n[lightgrey]Units ' +
			uStr +
			'\n[lightgrey]Items ' +
			iStr +
			'\n[lightgrey]Free ' +
			'[accent]' +
			state.freePercent +
			'%';

		if (igStr !== '') finalMsg += igStr;
		if (statsStr !== '') finalMsg += '\n\n[lightgrey]Stats:' + statsStr;

		notify(finalMsg);
		return;
	}

	if (args.length > 1) {
		let changed = [];
		let lastArg = args[args.length - 1] ? String(args[args.length - 1]).toLowerCase().trim() : '';
		let explicitState = null;

		if (lastArg === '1' || lastArg === 'true' || lastArg === 'on')
			explicitState = true;
		else if (lastArg === '0' || lastArg === 'false' || lastArg === 'off')
			explicitState = false;

		let limit = explicitState !== null ? args.length - 1 : args.length;

		for (let i = 1; i < limit; i++) {
			let key = args[i] ? String(args[i]).toLowerCase().trim() : '';
			if (state.units.hasOwnProperty(key)) {
				state.units[key] =
					explicitState !== null ? explicitState : !state.units[key];
				changed.push(
					(state.units[key] ? '[green]' : '[scarlet]') + key
				);
			} else if (state.items.hasOwnProperty(key)) {
				state.items[key] =
					explicitState !== null ? explicitState : !state.items[key];
				changed.push(
					(state.items[key] ? '[green]' : '[scarlet]') + key
				);
			}
		}
		if (changed.length > 0)
			return notify('[lightgrey]Toggle ' + changed.join(' '));
	}

	notify(
		'[lightgray]!mining ui\n!mining status\n!mining <units/items?> <1/0?>\n!mining ignore <unit> <items.../clear>\n!mining set <sec>\n!mining free <0-100>\n!mining stop\n!mining save\n\n!m ui\n!m st\n!m <units/items?> <1/0?>\n!m ig <unit> <items.../clear>\n!m s <sec>\n!m f <0-100>\n!m stop\n!m save'
	);
};

interceptor.add('mining', miningHandler);
interceptor.add('m', miningHandler);

// Expose the config dialog to the mod settings screen (gear button).
require('qol-control/core/settings-ui').register(
	'features/mining',
	'Mining',
	showMiningSettingsDialog,
	{ menuSafe: true }
);
