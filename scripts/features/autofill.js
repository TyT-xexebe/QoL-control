const notify = require('qol-control/core/logger').notify;
const interceptor = require('qol-control/core/interceptor');

let state = {
	enabled: false,
	drawOutline: true,
	blockSettings: {}
};

const DELAY_MS = 250;
let lastActionTime = 0;
let cacheInitialized = false;
let currentlyFillingBuilding = null;

const ItemTurretClass = Packages.mindustry.world.blocks.defense.turrets.ItemTurret;
const GenericCrafterClass = Packages.mindustry.world.blocks.production.GenericCrafter;
const UnitFactoryClass = Packages.mindustry.world.blocks.units.UnitFactory;
const ReconstructorClass = Packages.mindustry.world.blocks.units.Reconstructor;
const MendProjectorClass = Packages.mindustry.world.blocks.defense.MendProjector;
const ForceProjectorClass = Packages.mindustry.world.blocks.defense.ForceProjector;
const OverdriveProjectorClass = Packages.mindustry.world.blocks.power.OverdriveProjector;
const ConsumeItemsClass = Packages.mindustry.world.consumers.ConsumeItems;
const ConsumeItemFilterClass = Packages.mindustry.world.consumers.ConsumeItemFilter;

const EXCLUDED_BLOCKS = [
	'heat-source', 'vent-condenser', 'cultivator', 'heat-reactor',
	'slag-heater', 'electric-heater', 'atmospheric-concentrator',
	'atmosphere-condenser', 'electrolyzer', 'coal-centrifuge',
	'slag-centrifuge', 'phase-heater', 'sublimate', 'heat-redirector'
];

const blockInfoCache = {};

function getBlockInfo(block) {
	if (!block) return null;
	let id = block.id;
	if (blockInfoCache[id]) return blockInfoCache[id];

	let name = String(block.name);
	let isTurret = block instanceof ItemTurretClass;
	let isCrafter = block instanceof GenericCrafterClass;
	let isUnit = block instanceof UnitFactoryClass;
	let isRecon = block instanceof ReconstructorClass;
	let isHeal = block instanceof MendProjectorClass;
	let isShield = block instanceof ForceProjectorClass;
	let isOverdrive = block instanceof OverdriveProjectorClass || name.indexOf('overdrive') !== -1 || name.indexOf('dome') !== -1;

	let ammoTypes = [];
	if (isTurret && block.ammoTypes) {
		try {
			let seq = block.ammoTypes.keys().toSeq();
			for (let j = 0; j < seq.size; j++) {
				let k = seq.get(j);
				if (k && k.name) ammoTypes.push(String(k.name));
			}
		} catch (e) {
			try {
				let it = block.ammoTypes.keys();
				while (it.hasNext) {
					let k = it.next();
					if (k && k.name) ammoTypes.push(String(k.name));
				}
			} catch (e2) {}
		}
	}

	let consumedItems = [];
	try {
		if (isUnit && block.plans && block.plans.size) {
			for (let i = 0; i < block.plans.size; i++) {
				let plan = block.plans.get(i);
				if (plan && plan.requirements) {
					for (let r = 0; r < plan.requirements.length; r++) {
						let it = plan.requirements[r].item;
						if (it && consumedItems.indexOf(it) === -1) consumedItems.push(it);
					}
				}
			}
		}

		if (isRecon && block.requirements) {
			for (let r = 0; r < block.requirements.length; r++) {
				let it = block.requirements[r].item;
				if (it && consumedItems.indexOf(it) === -1) consumedItems.push(it);
			}
		}

		if (block.consumers) {
			for (let i = 0; i < block.consumers.length; i++) {
				let c = block.consumers[i];
				if (c instanceof ConsumeItemsClass && c.items) {
					for (let s = 0; s < c.items.length; s++) {
						let it = c.items[s].item;
						if (it && consumedItems.indexOf(it) === -1) consumedItems.push(it);
					}
				} else if (c instanceof ConsumeItemFilterClass) {
					let allItems = Vars.content.items();
					for (let itIdx = 0; itIdx < allItems.size; itIdx++) {
						let it = allItems.get(itIdx);
						try {
							if (c.filter && c.filter.get(it) && consumedItems.indexOf(it) === -1) consumedItems.push(it);
						} catch (eFilter) {}
					}
				}
			}
		}
	} catch (e) {}

	let eligible = false;
	let isExcluded = false;
	for (let i = 0; i < EXCLUDED_BLOCKS.length; i++) {
		if (name === EXCLUDED_BLOCKS[i] || name.indexOf(EXCLUDED_BLOCKS[i]) !== -1) {
			isExcluded = true;
			break;
		}
	}

	if (!isExcluded) {
		if (isTurret) {
			eligible = ammoTypes.length > 0;
		} else if (isCrafter || isUnit || isRecon || isHeal || isShield || isOverdrive) {
			eligible = consumedItems.length > 0;
		}
	}

	let info = {
		id: id,
		name: name,
		block: block,
		isTurret: isTurret,
		isCrafter: isCrafter,
		isUnit: isUnit,
		isRecon: isRecon,
		isHeal: isHeal,
		isShield: isShield,
		isOverdrive: isOverdrive,
		ammoTypes: ammoTypes,
		consumedItems: consumedItems,
		eligible: eligible
	};

	blockInfoCache[id] = info;
	return info;
}

function loadSettings() {
	try {
		state.enabled = Core.settings.getBool('qol-autofill-enabled', false);
		state.drawOutline = Core.settings.getBool('qol-autofill-draw-outline', true);
		let bs = Core.settings.getString('qol-autofill-blocks', '');
		if (bs) {
			state.blockSettings = JSON.parse(bs);
		}
	} catch (e) {}
}

function saveSettings() {
	try {
		Core.settings.put('qol-autofill-enabled', new java.lang.Boolean(state.enabled));
		Core.settings.put('qol-autofill-draw-outline', new java.lang.Boolean(state.drawOutline));
		Core.settings.put('qol-autofill-blocks', String(JSON.stringify(state.blockSettings)));
		if (typeof Core.settings.forceSave === 'function') {
			Core.settings.forceSave();
		}
	} catch (e) {}
}

function getTurretAmmoList(b) {
	let info = getBlockInfo(b);
	return info ? info.ammoTypes : [];
}

function getConsumedItems(block) {
	let info = getBlockInfo(block);
	return info ? info.consumedItems : [];
}

function isBlockEligible(b) {
	let info = getBlockInfo(b);
	return info ? info.eligible : false;
}

function initBlockSettings() {
	Object.keys(state.blockSettings).forEach(name => {
		let b = Vars.content.block(name);
		if (!b || !isBlockEligible(b)) {
			delete state.blockSettings[name];
		}
	});

	let allBlocks = Vars.content.blocks();
	for (let i = 0; i < allBlocks.size; i++) {
		let b = allBlocks.get(i);
		let info = getBlockInfo(b);
		if (!info.eligible) continue;
		let name = info.name;

		if (!state.blockSettings[name]) {
			let defaultPriority = 10;
			if (info.isTurret) defaultPriority = 70;
			else if (info.isOverdrive) defaultPriority = 60;
			else if (info.isHeal || info.isShield) defaultPriority = 50;
			else if (info.isRecon || info.isUnit) defaultPriority = 40;
			else if (info.isCrafter) defaultPriority = 30;

			state.blockSettings[name] = {
				enabled: true,
				priority: defaultPriority,
				ammoPriority: info.isTurret ? info.ammoTypes.slice() : []
			};
		} else {
			if (info.isTurret && (!state.blockSettings[name].ammoPriority || state.blockSettings[name].ammoPriority.length === 0)) {
				state.blockSettings[name].ammoPriority = info.ammoTypes.slice();
			}
		}
	}
}

function initCache() {
	if (cacheInitialized) return;
	loadSettings();
	initBlockSettings();
	cacheInitialized = true;
}

function showAmmoPriorityDialog(blockName) {
	let blockObj = Vars.content.block(blockName);
	if (!blockObj) return;
	
	let d = new BaseDialog(blockObj.localizedName + ' Ammo');
	d.addCloseButton();
	
	let bSettings = state.blockSettings[blockName];
	if (!bSettings.ammoPriority || bSettings.ammoPriority.length === 0) {
		bSettings.ammoPriority = getTurretAmmoList(blockObj);
	}

	d.cont.clear();
	d.cont.top();
	
	d.cont.add('[accent]Ammo Priority Order (top = highest):[]').left().padBottom(10).row();

	let listTable = new Table();
	listTable.top().left();

	let rebuildAmmoRows = () => {
		listTable.clearChildren();
		let list = bSettings.ammoPriority;
		list.forEach((ammoName, idx) => {
			let itemObj = Vars.content.item(ammoName);
			if (!itemObj) return;
			
			let row = new Table();
			row.left();
			
			row.image(itemObj.uiIcon).size(34).padRight(12);
			row.add(itemObj.localizedName).width(150).left();
			
			row.button('▲', Styles.defaultt, () => {
				if (idx > 0) {
					let temp = list[idx - 1];
					list[idx - 1] = list[idx];
					list[idx] = temp;
					saveSettings();
					rebuildAmmoRows();
				}
			}).size(48, 38).disabled(idx === 0).padRight(6);
			
			row.button('▼', Styles.defaultt, () => {
				if (idx < list.length - 1) {
					let temp = list[idx + 1];
					list[idx + 1] = list[idx];
					list[idx] = temp;
					saveSettings();
					rebuildAmmoRows();
				}
			}).size(48, 38).disabled(idx === list.length - 1);
			
			listTable.add(row).left().pad(4).row();
		});
	};
	
	rebuildAmmoRows();

	let dialogWidth = Math.min(Core.graphics.getWidth() * 0.9, 440);
	let dialogHeight = Math.min(Core.graphics.getHeight() * 0.7, 340);
	let scroll = new ScrollPane(listTable);
	scroll.setFadeScrollBars(false);
	d.cont.add(scroll).size(dialogWidth, dialogHeight).row();
	
	d.show();
}

function showSettingsDialog() {
	initCache();
	let d = new BaseDialog('Autofill Settings');
	d.addCloseButton();
	
	d.cont.clear();
	d.cont.top();

	let mainTable = new Table();
	mainTable.top().left();

	let globalTable = new Table();
	globalTable.left();

	globalTable.check('Enable Autofill', state.enabled, b => {
		state.enabled = b;
		saveSettings();
	}).pad(6).left().row();

	globalTable.check('Draw Target Outline', state.drawOutline, b => {
		state.drawOutline = b;
		saveSettings();
	}).pad(6).left().row();

	mainTable.add(globalTable).left().padBottom(10).row();
	mainTable.image().color(Color.gray).height(2).fillX().padBottom(10).row();

	mainTable.add('[accent]=== Block Priorities & Config ===[]').left().padBottom(8).row();

	let listTable = new Table();
	listTable.top().left();

	let sortedBlockNames = Object.keys(state.blockSettings).sort((a, b) => {
		let pA = state.blockSettings[a].priority;
		let pB = state.blockSettings[b].priority;
		return pB - pA;
	});

	sortedBlockNames.forEach(name => {
		let bSettings = state.blockSettings[name];
		let blockObj = Vars.content.block(name);
		if (!blockObj) return;

		let row = new Table();
		row.left();

		row.image(blockObj.uiIcon).size(36).padRight(14);

		row.check('', bSettings.enabled, b => {
			bSettings.enabled = b;
			saveSettings();
		}).padRight(14);

		row.add('[lightgray]P:[]').padRight(2);
		let pLabel = row.add(String(bSettings.priority)).color(Pal.accent).width(36).center().get();

		row.button('-', Styles.defaultt, () => {
			bSettings.priority = Math.max(0, bSettings.priority - 1);
			pLabel.setText(String(bSettings.priority));
			saveSettings();
		}).size(44, 38).padRight(4);

		row.button('+', Styles.defaultt, () => {
			bSettings.priority = Math.min(100, bSettings.priority + 1);
			pLabel.setText(String(bSettings.priority));
			saveSettings();
		}).size(44, 38).padRight(12);

		let info = getBlockInfo(blockObj);
		if (info && info.isTurret) {
			row.button('Ammo', Styles.defaultt, () => {
				showAmmoPriorityDialog(name);
			}).size(80, 38);
		} else {
			row.add('').width(80);
		}

		listTable.add(row).left().pad(4).row();
	});

	mainTable.add(listTable).left().row();

	let dialogWidth = Math.min(Core.graphics.getWidth() * 0.92, 540);
	let dialogHeight = Math.min(Core.graphics.getHeight() * 0.75, 450);
	let scroll = new ScrollPane(mainTable);
	scroll.setFadeScrollBars(false);
	d.cont.add(scroll).size(dialogWidth, dialogHeight).row();

	d.show();
}

const autofillHandler = (args) => {
	let arg1 = args[1] ? String(args[1]).toLowerCase().trim() : '';

	if (arg1 === 's' || arg1 === 'settings' || arg1 === 'ui') {
		Core.app.post(() => {
			showSettingsDialog();
		});
		return;
	}
	
	if (args[1] && !interceptor.isBooleanArg(args[1])) {
		notify('[lightgray]Usage: !autofill <1/0/s?>');
		return;
	}
	
	initCache();
	state.enabled = interceptor.parseToggle(state.enabled, args[1]);
	saveSettings();
	notify(
		'[lightgrey]Autofill ' +
			(state.enabled ? '[green]ON' : '[scarlet]OFF')
	);
};

interceptor.add('autofill', autofillHandler);
interceptor.add('af', autofillHandler);

Events.run(Trigger.update, () => {
	if (!state.enabled || !Vars.state.isGame()) return;

	initCache();

	let p = Vars.player;
	let u = p.unit();
	if (!u || u.dead || u.type.itemCapacity <= 0) return;

	let now = Time.millis();
	if (now - lastActionTime < DELAY_MS) return;

	let core = u.closestCore();
	if (!core) {
		currentlyFillingBuilding = null;
		return;
	}

	let buildRange = Math.max(u.type.buildRange, 220);
	let nearCore = u.within(core, buildRange + (core.block ? core.block.size * 4 : 0));
	if (!nearCore) {
		currentlyFillingBuilding = null;
		return;
	}

	let stack = u.stack;
	let hasItem = stack.amount > 0 && stack.item != null;

	let targets = [];

	Groups.build.each(cons(b => {
		if (!b || b.team !== p.team() || !u.within(b, buildRange + b.block.size * 4)) return;
		let info = getBlockInfo(b.block);
		if (!info || !info.eligible) return;
		let bSettings = state.blockSettings[info.name];
		if (!bSettings || !bSettings.enabled) return;

		let needsFilling = false;
		
		if (info.isTurret) {
			if (b.totalAmmo <= b.block.maxAmmo * 0.85) {
				let ammoNames = (bSettings && bSettings.ammoPriority && bSettings.ammoPriority.length > 0) ? bSettings.ammoPriority : info.ammoTypes;
				for (let j = 0; j < ammoNames.length; j++) {
					let it = Vars.content.item(ammoNames[j]);
					if (it && b.acceptItem(b, it)) {
						needsFilling = true;
						break;
					}
				}
			}
		} else {
			let consumed = info.consumedItems;
			for (let i = 0; i < consumed.length; i++) {
				let item = consumed[i];
				let currentAmount = b.items ? b.items.get(item) : 0;
				if (currentAmount < b.block.itemCapacity * 0.85 && b.acceptItem(b, item)) {
					needsFilling = true;
					break;
				}
			}
		}

		if (needsFilling) {
			targets.push(b);
		}
	}));

	if (targets.length === 0) {
		if (hasItem) {
			Call.transferInventory(p, core);
			lastActionTime = now;
		}
		currentlyFillingBuilding = null;
		return;
	}

	targets.sort((a, b) => {
		let aSettings = state.blockSettings[a.block.name];
		let bSettings = state.blockSettings[b.block.name];
		let pA = aSettings ? aSettings.priority : 0;
		let pB = bSettings ? bSettings.priority : 0;
		if (pA !== pB) return pB - pA;
		return u.dst2(a) - u.dst2(b);
	});

	let topTarget = targets[0];
	let topPriority = state.blockSettings[topTarget.block.name] ? state.blockSettings[topTarget.block.name].priority : 0;

	if (hasItem) {
		let itemTransferred = false;

		for (let i = 0; i < targets.length; i++) {
			let t = targets[i];
			let tPriority = state.blockSettings[t.block.name] ? state.blockSettings[t.block.name].priority : 0;
			
			if (tPriority < topPriority) {
				break;
			}

			if (t.acceptItem(t, stack.item)) {
				Call.transferInventory(p, t);
				lastActionTime = now;
				currentlyFillingBuilding = t;
				itemTransferred = true;
				break;
			}
		}

		if (!itemTransferred) {
			Call.transferInventory(p, core);
			lastActionTime = now;
			currentlyFillingBuilding = null;
		}
		return;
	}

	for (let i = 0; i < targets.length; i++) {
		let t = targets[i];
		let info = getBlockInfo(t.block);
		let bestItem = null;

		if (info && info.isTurret) {
			if (t.totalAmmo >= t.block.maxAmmo * 0.85) continue;
			let bSettings = state.blockSettings[t.block.name];
			let ammoNames = (bSettings && bSettings.ammoPriority && bSettings.ammoPriority.length > 0) ? bSettings.ammoPriority : info.ammoTypes;

			for (let j = 0; j < ammoNames.length; j++) {
				let it = Vars.content.item(ammoNames[j]);
				if (!it || !t.acceptItem(t, it)) continue;

				if (core.items && core.items.get(it) > 0) {
					bestItem = it;
					break;
				}
			}
		} else if (info) {
			let allConsumed = info.consumedItems;
			for (let j = 0; j < allConsumed.length; j++) {
				let it = allConsumed[j];
				let currentAmt = t.items ? t.items.get(it) : 0;
				if (currentAmt >= t.block.itemCapacity * 0.85 || !t.acceptItem(t, it)) continue;

				if (core.items && core.items.get(it) > 0) {
					bestItem = it;
					break;
				}
			}
		}

		if (bestItem != null) {
			let countToTake = Math.min(u.type.itemCapacity, core.items.get(bestItem));
			Call.requestItem(p, core, bestItem, countToTake);
			lastActionTime = now;
			currentlyFillingBuilding = t;
			return;
		}
	}
	
	currentlyFillingBuilding = null;
});

Events.run(Trigger.draw, () => {
	if (!Vars.state.isGame() || !state.enabled || !state.drawOutline || !currentlyFillingBuilding) return;
	let b = currentlyFillingBuilding;
	if (b == null || b.dead || b.block == null) {
		currentlyFillingBuilding = null;
		return;
	}
	Draw.z(Layer.max);
	Lines.stroke(0.5);
	Draw.color(Color.gold, 0.8);
	let sizePx = b.block.size * 8;
	Lines.rect(b.x - sizePx / 2, b.y - sizePx / 2, sizePx, sizePx);
});
