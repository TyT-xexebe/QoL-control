const notify = require('qol-control/core/logger').notify;
const interceptor = require('qol-control/core/interceptor');

let state = {
	enabled: false,
	drawOutline: true,
	turretSelectionFetch: true,
	storageAutofill: true,
	blockSettings: {}
};

const DELAY_MS = 200;
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
const StorageBlockClass = Packages.mindustry.world.blocks.storage.StorageBlock;
const CoreBlockClass = Packages.mindustry.world.blocks.storage.CoreBlock;
const ConsumeGeneratorClass = Packages.mindustry.world.blocks.power.ConsumeGenerator;
const ConsumeItemsClass = Packages.mindustry.world.consumers.ConsumeItems;
const ConsumeItemFilterClass = Packages.mindustry.world.consumers.ConsumeItemFilter;

// Generators accept any item that is flammable or radioactive, which is far
// wider than we ever want to feed them: a combustion generator happily eats
// blast-compound and spore-pod, and that burns through expensive stock while
// coal sits in the core. Those blocks get a fuel list the player can edit -
// the same priority order and on/off toggles the turrets use for their ammo.
// The listed items are the ones enabled by default, everything else the block
// could take is listed but switched off.
const FUEL_DEFAULTS = {
	'combustion-generator': ['coal'],
	'rtg-generator': ['thorium', 'phase-fabric'],
};

const EXCLUDED_BLOCKS = [
	'heat-source', 'vent-condenser', 'cultivator', 'heat-reactor',
	'slag-heater', 'electric-heater', 'atmospheric-concentrator',
	'atmosphere-condenser', 'electrolyzer', 'coal-centrifuge',
	'slag-centrifuge', 'phase-heater', 'sublimate', 'heat-redirector'
];

const blockInfoCache = {};

const storageCache = {};
// Container/Vault detection: walks the Java class chain (excluding CoreBlock),
// falls back to instanceof and then to block name.
function isStorageBlock(block) {
	if (!block) return false;
	let id = block.id;
	if (storageCache[id] !== undefined) return storageCache[id];
	let result = null;
	try {
		let c = block.getClass();
		let storage = false;
		while (c != null) {
			let cn = String(c.getName());
			if (cn === 'mindustry.world.blocks.storage.CoreBlock') {
				storage = false;
				result = false;
				break;
			}
			if (cn === 'mindustry.world.blocks.storage.StorageBlock') storage = true;
			c = c.getSuperclass();
		}
		if (result === null && storage) result = true;
	} catch (e) {}
	if (result === null) {
		try {
			if (block instanceof CoreBlockClass) result = false;
			else if (block instanceof StorageBlockClass) result = true;
		} catch (e) {}
	}
	if (result === null) {
		let n = String(block.name);
		result = n === 'container' || n === 'vault';
	}
	storageCache[id] = result;
	return result;
}

// Container/Vault have update=false, so the game never adds them to Groups.build.
// They are only reachable through the block indexer's building tree.
function collectStorages(p, u, buildRange) {
	let out = [];
	Vars.indexer.allBuildings(u.x, u.y, buildRange + 40, cons(b => {
		if (!b || b.team !== p.team()) return;
		if (!u.within(b, buildRange + (b.block ? b.block.size * 4 : 0))) return;
		if (isStorageBlock(b.block)) out.push(b);
	}));
	return out;
}

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
	// Any item-burning generator (combustion, RTG, differential...). Kept broad on
	// purpose: the whitelist below decides what it is actually fed.
	let isItemGenerator = block instanceof ConsumeGeneratorClass;
	let isCombustionGenerator = name === 'combustion-generator';

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
	let hasFuelFilter = false;
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
					// Flammable/radioactive filters: this is the fuel list of a generator.
					hasFuelFilter = true;
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

	// A generator whose fuel comes from a filter (flammable, radioactive) is
	// the one the player gets to configure: priority order and on/off per fuel.
	let isFuelSelectable = hasFuelFilter && consumedItems.length > 0;
	let fuelDefaults = FUEL_DEFAULTS[name] || null;

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
		} else if (isCrafter || isUnit || isRecon || isHeal || isShield || isOverdrive || isCombustionGenerator || isItemGenerator) {
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
		isCombustionGenerator: isCombustionGenerator,
		isItemGenerator: isItemGenerator,
		isFuelSelectable: isFuelSelectable,
		fuelDefaults: fuelDefaults,
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
		state.turretSelectionFetch = Core.settings.getBool('qol-autofill-turret-select-fetch', true);
		state.storageAutofill = Core.settings.getBool('qol-autofill-storage-enabled', true);
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
		Core.settings.put('qol-autofill-turret-select-fetch', new java.lang.Boolean(state.turretSelectionFetch));
		Core.settings.put('qol-autofill-storage-enabled', new java.lang.Boolean(state.storageAutofill));
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

// Every item a generator could take, the preferred ones first.
function getDefaultFuelList(info) {
	if (!info) return [];
	let ordered = [];
	let defaults = info.fuelDefaults || [];
	for (let i = 0; i < defaults.length; i++) {
		let it = Vars.content.item(defaults[i]);
		if (it && info.consumedItems.indexOf(it) !== -1) ordered.push(it);
	}
	for (let i = 0; i < info.consumedItems.length; i++) {
		if (ordered.indexOf(info.consumedItems[i]) === -1) ordered.push(info.consumedItems[i]);
	}
	return ordered;
}

// Makes sure a fuel-selectable block has its fuel list and the disabled set.
function ensureFuelSettings(info, entry) {
	if (!info || !info.isFuelSelectable) return;
	if (!entry.fuelPriority || entry.fuelPriority.length === 0) {
		let list = getDefaultFuelList(info);
		entry.fuelPriority = [];
		for (let i = 0; i < list.length; i++) entry.fuelPriority.push(String(list[i].name));
	}
	if (!entry.disabledFuel) entry.disabledFuel = {};
	// Fresh list: the fuels the block prefers stay on, the rest starts off.
	// A block without a preference keeps everything it could take.
	if (!entry.fuelInitialized) {
		let defaults = info.fuelDefaults || [];
		if (defaults.length > 0) {
			for (let i = 0; i < entry.fuelPriority.length; i++) {
				if (defaults.indexOf(entry.fuelPriority[i]) === -1) {
					entry.disabledFuel[entry.fuelPriority[i]] = true;
				}
			}
		}
		entry.fuelInitialized = true;
	}
}

// The items a block should actually be filled with, in priority order.
function getFillItems(info) {
	if (!info) return [];
	if (!info.isFuelSelectable) return info.consumedItems;
	let entry = state.blockSettings[info.name];
	if (!entry) return info.consumedItems;
	let list = entry.fuelPriority && entry.fuelPriority.length ? entry.fuelPriority : info.consumedItems;
	let out = [];
	for (let i = 0; i < list.length; i++) {
		let itemName = list[i];
		if (entry.disabledFuel && entry.disabledFuel[itemName]) continue;
		let it = Vars.content.item(itemName);
		if (!it) continue;
		if (info.consumedItems.indexOf(it) === -1) continue;
		out.push(it);
	}
	return out;
}

function initBlockSettings() {
	let allBlocks = Vars.content ? Vars.content.blocks() : null;
	if (!allBlocks || allBlocks.size === 0) return false;

	for (let i = 0; i < allBlocks.size; i++) {
		let b = allBlocks.get(i);
		let info = getBlockInfo(b);
		if (!info || !info.eligible) continue;
		let name = info.name;

		if (!state.blockSettings[name]) {
			let defaultPriority = 10;
			if (info.isTurret) defaultPriority = 70;
			else if (info.isOverdrive) defaultPriority = 60;
			else if (info.isHeal || info.isShield) defaultPriority = 50;
			else if (info.isRecon || info.isUnit) defaultPriority = 40;
			else if (info.isCrafter) defaultPriority = 30;
			else if (info.isCombustionGenerator) defaultPriority = 25;
			else if (info.isItemGenerator) defaultPriority = 25;

			state.blockSettings[name] = {
				enabled: true,
				priority: defaultPriority,
				ammoPriority: info.isTurret ? info.ammoTypes.slice() : [],
				disabledAmmo: {}
			};
		} else {
			if (info.isTurret) {
				if (!state.blockSettings[name].ammoPriority || state.blockSettings[name].ammoPriority.length === 0) {
					state.blockSettings[name].ammoPriority = info.ammoTypes.slice();
				}
				if (!state.blockSettings[name].disabledAmmo) {
					state.blockSettings[name].disabledAmmo = {};
				}
			}
		}

		ensureFuelSettings(info, state.blockSettings[name]);
	}
	return true;
}

function initCache() {
	if (cacheInitialized) return;
	let ok = initBlockSettings();
	if (ok) {
		cacheInitialized = true;
	}
}

loadSettings();

Events.on(WorldLoadEvent, () => {
	currentlyFillingBuilding = null;
	lastActionTime = 0;
});

// Shared list dialog: an ordered list of items with an on/off toggle per
// entry. Used for turret ammo and for generator fuel.
function showItemPriorityDialog(blockName, title, listKey, disabledKey, fallbackList) {
	let blockObj = Vars.content.block(blockName);
	if (!blockObj) return;

	let d = new BaseDialog((blockObj.localizedName || blockName) + ' ' + title);
	d.addCloseButton();

	let bSettings = state.blockSettings[blockName];
	if (!bSettings[listKey] || bSettings[listKey].length === 0) {
		bSettings[listKey] = fallbackList();
	}
	if (!bSettings[disabledKey]) {
		bSettings[disabledKey] = {};
	}

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

	let card = createCard(title + ' & Toggles (Top = First Loaded)', 'ffd37f');
	let listTable = card.table().top().left().growX().get();

	let rebuildRows = () => {
		listTable.clearChildren();
		let list = bSettings[listKey];

		list.forEach((itemName, idx) => {
			let itemObj = Vars.content.item(itemName);
			if (!itemObj) return;

			let row = listTable.table().growX().pad(2).get();
			row.left();

			if (!bSettings[disabledKey]) bSettings[disabledKey] = {};
			let isDisabled = !!bSettings[disabledKey][itemName];

			row.check('', !isDisabled, b => {
				if (!bSettings[disabledKey]) bSettings[disabledKey] = {};
				if (!b) {
					bSettings[disabledKey][itemName] = true;
				} else {
					delete bSettings[disabledKey][itemName];
				}
				saveSettings();
				rebuildRows();
			}).padRight(8);

			row.image(itemObj.uiIcon).size(32).padRight(10);
			let nameColor = isDisabled ? '[gray]' : '[white]';
			let nameCell = row.add(nameColor + itemObj.localizedName).left().growX().minWidth(0);
			nameCell.get().setEllipsis(true);

			row.button('▲', Styles.grayt, () => {
				if (idx > 0) {
					let temp = list[idx - 1];
					list[idx - 1] = list[idx];
					list[idx] = temp;
					saveSettings();
				rebuildRows();
				}
			}).size(44, 34).disabled(idx === 0).padRight(6);

			row.button('▼', Styles.grayt, () => {
				if (idx < list.length - 1) {
					let temp = list[idx + 1];
					list[idx + 1] = list[idx];
					list[idx] = temp;
					saveSettings();
				rebuildRows();
				}
			}).size(44, 34).disabled(idx === list.length - 1);

			listTable.row();
		});
	};

	rebuildRows();
	root.row();

	let scroll = new ScrollPane(root);
	scroll.setScrollingDisabled(true, false);
	scroll.setOverscroll(false, true);

	let dw = Math.min(Core.scene.getWidth() * 0.95, 560);
	let dh = Math.min(Core.scene.getHeight() * 0.85, 420);
	d.cont.add(scroll).width(dw).height(dh).row();

	d.show();
}

function showAmmoPriorityDialog(blockName) {
	let blockObj = Vars.content.block(blockName);
	if (!blockObj) return;
	showItemPriorityDialog(
		blockName,
		'Ammo Priority',
		'ammoPriority',
		'disabledAmmo',
		() => getTurretAmmoList(blockObj)
	);
}

function showFuelPriorityDialog(blockName) {
	let blockObj = Vars.content.block(blockName);
	if (!blockObj) return;
	let info = getBlockInfo(blockObj);
	if (!info) return;
	ensureFuelSettings(info, state.blockSettings[blockName]);
	showItemPriorityDialog(
		blockName,
		'Fuel Priority',
		'fuelPriority',
		'disabledFuel',
		() => {
			let names = [];
			let list = getDefaultFuelList(info);
			for (let i = 0; i < list.length; i++) names.push(String(list[i].name));
			return names;
		}
	);
}

function showSettingsDialog() {
	initCache();
	let d = new BaseDialog('Autofill Config');
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

	// 1. Global Settings Card
	let c1 = createCard('Global Autofill Settings', '50fa7b');
	c1.check('Enable Autofill', state.enabled, b => {
		state.enabled = b;
		saveSettings();
	}).pad(3).left().row();
	c1.check('Draw Target Outline & Range', state.drawOutline, b => {
		state.drawOutline = b;
		saveSettings();
	}).pad(3).left().row();
	c1.check('Fetch Ammo When Turret Selected', state.turretSelectionFetch, b => {
		state.turretSelectionFetch = b;
		saveSettings();
	}).pad(3).left().row();
	c1.check('Take Turret Ammo from Container/Vault (Away from Core)', state.storageAutofill, b => {
		state.storageAutofill = b;
		saveSettings();
	}).pad(3).left().row();

	root.row();

	// 2. Block Priorities Card
	let c2 = createCard('Block Priorities & Ammo Config', 'ffd37f');
	let sortedBlockNames = Object.keys(state.blockSettings).sort((a, b) => {
		let pA = state.blockSettings[a].priority;
		let pB = state.blockSettings[b].priority;
		return pB - pA;
	});

	sortedBlockNames.forEach(name => {
		let bSettings = state.blockSettings[name];
		let blockObj = Vars.content.block(name);
		if (!blockObj) return;

		let row = c2.table().growX().pad(2).get();
		row.image(blockObj.uiIcon).size(32).padRight(10);
		row.check('', bSettings.enabled, b => {
			bSettings.enabled = b;
			saveSettings();
		}).padRight(10);

		let nameCell = row.add('[white]' + (blockObj.localizedName || name)).left().growX().minWidth(0);
		nameCell.get().setEllipsis(true);

		row.add('[lightgray]P:[]').padRight(2);
		let pLabel = row.add(String(bSettings.priority)).color(Pal.accent).width(30).center().get();

		row.button('-', Styles.grayt, () => {
			bSettings.priority = Math.max(0, bSettings.priority - 1);
			pLabel.setText(String(bSettings.priority));
			saveSettings();
		}).size(32, 32).padRight(4);

		row.button('+', Styles.grayt, () => {
			bSettings.priority = Math.min(100, bSettings.priority + 1);
			pLabel.setText(String(bSettings.priority));
			saveSettings();
		}).size(32, 32).padRight(8);

		let info = getBlockInfo(blockObj);
		if (info && info.isTurret) {
			let ammoBtn = row.button('Ammo', Styles.grayt, () => {
				showAmmoPriorityDialog(name);
			}).size(76, 32).get();
			ammoBtn.getLabel().setFontScale(0.85);
		} else if (info && info.isFuelSelectable) {
			let fuelBtn = row.button('Fuel', Styles.grayt, () => {
				showFuelPriorityDialog(name);
			}).size(76, 32).get();
			fuelBtn.getLabel().setFontScale(0.85);
		} else {
			row.add('').width(76);
		}
		c2.row();
	});

	root.row();

	let scroll = new ScrollPane(root);
	scroll.setScrollingDisabled(true, false);
	scroll.setOverscroll(false, true);

	let dw = Math.min(Core.scene.getWidth() * 0.95, 740);
	let dh = Math.min(Core.scene.getHeight() * 0.85, 520);
	d.cont.add(scroll).width(dw).height(dh).row();

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

	let buildRange = Math.max(u.type.buildRange, 220);
	let stack = u.stack;
	let hasItem = stack.amount > 0 && stack.item != null;

	// Check if a turret is currently selected in build menu
	let selBlock = (Vars.control && Vars.control.input) ? Vars.control.input.block : null;
	let selInfo = selBlock ? getBlockInfo(selBlock) : null;
	let isTurretSelected = state.turretSelectionFetch && selInfo && selInfo.isTurret;

	// 1. Scan for buildings in range that need autofill
	let targets = [];
	Groups.build.each(cons(b => {
		if (!b || b.team !== p.team() || !u.within(b, buildRange + b.block.size * 4)) return;
		let info = getBlockInfo(b.block);
		if (!info || !info.eligible) return;

		// While a turret is selected in hand, other blocks for autofill in range are ignored!
		if (isTurretSelected && b.block !== selBlock) return;

		let bSettings = state.blockSettings[info.name];
		if (!bSettings || !bSettings.enabled) return;

		let needsFilling = false;
		if (info.isTurret) {
			if (b.totalAmmo <= b.block.maxAmmo * 0.85) {
				let ammoNames = (bSettings && bSettings.ammoPriority && bSettings.ammoPriority.length > 0) ? bSettings.ammoPriority : info.ammoTypes;
				for (let j = 0; j < ammoNames.length; j++) {
					let ammoName = ammoNames[j];
					if (bSettings && bSettings.disabledAmmo && bSettings.disabledAmmo[ammoName]) continue;
					let it = Vars.content.item(ammoName);
					if (it && b.acceptItem(b, it)) {
						needsFilling = true;
						break;
					}
				}
			}
		} else {
			let consumed = getFillItems(info);
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

	if (targets.length > 0) {
		targets.sort((a, b) => {
			let aSettings = state.blockSettings[a.block.name];
			let bSettings = state.blockSettings[b.block.name];
			let pA = aSettings ? aSettings.priority : 0;
			let pB = bSettings ? bSettings.priority : 0;
			if (pA !== pB) return pB - pA;
			return u.dst2(a) - u.dst2(b);
		});
	}

	let core = u.closestCore();
	let nearCore = core && u.within(core, buildRange + (core.block ? core.block.size * 4 : 0));

	// 2. Turret selected in build menu & Near Core: Fetch best ammo from core
	if (isTurretSelected && nearCore) {
		let selSettings = state.blockSettings[selInfo.name];
		let selAmmoNames = (selSettings && selSettings.ammoPriority && selSettings.ammoPriority.length > 0) ? selSettings.ammoPriority : selInfo.ammoTypes;
		let bestSelItem = null;

		for (let j = 0; j < selAmmoNames.length; j++) {
			let aName = selAmmoNames[j];
			if (selSettings && selSettings.disabledAmmo && selSettings.disabledAmmo[aName]) continue;
			let it = Vars.content.item(aName);
			if (!it) continue;
			if (hasItem && stack.item === it) {
				bestSelItem = it;
				break;
			}
			if (core.items && core.items.get(it) > 0) {
				bestSelItem = it;
				break;
			}
		}

		if (bestSelItem != null) {
			if (hasItem && stack.item !== bestSelItem) {
				// Holding wrong item: return to core
				Call.transferInventory(p, core);
				lastActionTime = now;
				return;
			} else if (!hasItem) {
				let countToTake = Math.min(u.type.itemCapacity, core.items.get(bestSelItem));
				if (countToTake > 0) {
					Call.requestItem(p, core, bestSelItem, countToTake);
					lastActionTime = now;
					return;
				}
			} else if (hasItem && stack.item === bestSelItem && stack.amount < u.type.itemCapacity && core.items.get(bestSelItem) > 0) {
				let countToTake = Math.min(u.type.itemCapacity - stack.amount, core.items.get(bestSelItem));
				if (countToTake > 0) {
					Call.requestItem(p, core, bestSelItem, countToTake);
					lastActionTime = now;
					return;
				}
			}
		}
	}

	// 3. Normal Near Core Auto-fetch logic for targets
	if (nearCore) {
		for (let i = 0; i < targets.length; i++) {
			let t = targets[i];
			let info = getBlockInfo(t.block);
			let bestItem = null;

		if (info && info.isTurret) {
			if (t.totalAmmo < t.block.maxAmmo * 0.85) {
				let bSettings = state.blockSettings[t.block.name];
				let ammoNames = (bSettings && bSettings.ammoPriority && bSettings.ammoPriority.length > 0) ? bSettings.ammoPriority : info.ammoTypes;
				for (let j = 0; j < ammoNames.length; j++) {
					let ammoName = ammoNames[j];
					if (bSettings && bSettings.disabledAmmo && bSettings.disabledAmmo[ammoName]) continue;
					let it = Vars.content.item(ammoName);
					if (!it || !t.acceptItem(t, it)) continue;
					if (hasItem && stack.item === it) {
						bestItem = it;
						break;
					}
					if (core.items && core.items.get(it) > 0) {
						bestItem = it;
						break;
					}
				}
			}
		} else if (info) {
			let allConsumed = getFillItems(info);
			for (let j = 0; j < allConsumed.length; j++) {
				let it = allConsumed[j];
				let currentAmt = t.items ? t.items.get(it) : 0;
				if (currentAmt >= t.block.itemCapacity * 0.85 || !t.acceptItem(t, it)) continue;
				if (hasItem && stack.item === it) {
					bestItem = it;
					break;
				}
				if (core.items && core.items.get(it) > 0) {
					bestItem = it;
					break;
				}
			}
		}

			if (bestItem != null) {
				if (hasItem && stack.item === bestItem) {
					if (t.acceptItem(t, stack.item)) {
						Call.transferInventory(p, t);
						lastActionTime = now;
						currentlyFillingBuilding = t;
						return;
					}
				} else if (hasItem && stack.item !== bestItem) {
					Call.transferInventory(p, core);
					lastActionTime = now;
					return;
				} else if (!hasItem) {
					let countToTake = Math.min(u.type.itemCapacity, core.items.get(bestItem));
					Call.requestItem(p, core, bestItem, countToTake);
					lastActionTime = now;
					currentlyFillingBuilding = t;
					return;
				}
			}
		}
	}

	// 4. Away from Core (!nearCore) & Storage Autofill enabled: take ammo for turrets from Container and Vault
	if (!nearCore && state.storageAutofill) {
		let turretTargets = targets.filter(t => {
			let info = getBlockInfo(t.block);
			return info && info.isTurret;
		});

		let storages = collectStorages(p, u, buildRange);

		// If player holds a turret in hand (isTurretSelected), pre-fetch ammo from nearby container/vault
		if (isTurretSelected && storages.length > 0) {
			let selSettings = state.blockSettings[selInfo.name];
			let selAmmoNames = (selSettings && selSettings.ammoPriority && selSettings.ammoPriority.length > 0) ? selSettings.ammoPriority : selInfo.ammoTypes;
			let bestStorageItem = null;
			let bestStorageBuild = null;

			for (let j = 0; j < selAmmoNames.length; j++) {
				let aName = selAmmoNames[j];
				if (selSettings && selSettings.disabledAmmo && selSettings.disabledAmmo[aName]) continue;
				let it = Vars.content.item(aName);
				if (!it) continue;
				if (hasItem && stack.item === it) {
					bestStorageItem = it;
					break;
				}
				for (let sIdx = 0; sIdx < storages.length; sIdx++) {
					let s = storages[sIdx];
					if (s.items && s.items.get(it) > 0) {
						bestStorageItem = it;
						bestStorageBuild = s;
						break;
					}
				}
				if (bestStorageItem != null) break;
			}

			if (bestStorageItem != null) {
				if (!hasItem && bestStorageBuild) {
					let countToTake = Math.min(u.type.itemCapacity, bestStorageBuild.items.get(bestStorageItem));
					if (countToTake > 0) {
						Call.requestItem(p, bestStorageBuild, bestStorageItem, countToTake);
						lastActionTime = now;
						return;
					}
				} else if (hasItem && stack.item === bestStorageItem && stack.amount < u.type.itemCapacity && bestStorageBuild && bestStorageBuild.items.get(bestStorageItem) > 0) {
					let countToTake = Math.min(u.type.itemCapacity - stack.amount, bestStorageBuild.items.get(bestStorageItem));
					if (countToTake > 0) {
						Call.requestItem(p, bestStorageBuild, bestStorageItem, countToTake);
						lastActionTime = now;
						return;
					}
				}
			}
		}

		if (turretTargets.length > 0 && storages.length > 0) {
			for (let i = 0; i < turretTargets.length; i++) {
				let t = turretTargets[i];
				let info = getBlockInfo(t.block);
				if (!info || !info.isTurret) continue;
				if (t.totalAmmo >= t.block.maxAmmo * 0.85) continue;

				let bSettings = state.blockSettings[t.block.name];
				let ammoNames = (bSettings && bSettings.ammoPriority && bSettings.ammoPriority.length > 0) ? bSettings.ammoPriority : info.ammoTypes;

				let bestItem = null;
				let storageWithItem = null;

				for (let j = 0; j < ammoNames.length; j++) {
					let ammoName = ammoNames[j];
					if (bSettings && bSettings.disabledAmmo && bSettings.disabledAmmo[ammoName]) continue;
					let it = Vars.content.item(ammoName);
					if (!it || !t.acceptItem(t, it)) continue;

					if (hasItem && stack.item === it) {
						bestItem = it;
						break;
					}

					for (let sIdx = 0; sIdx < storages.length; sIdx++) {
						let s = storages[sIdx];
						if (s.items && s.items.get(it) > 0) {
							bestItem = it;
							storageWithItem = s;
							break;
						}
					}
					if (bestItem != null) break;
				}

				if (bestItem != null) {
				if (hasItem && stack.item === bestItem) {
					if (t.acceptItem(t, stack.item)) {
						Call.transferInventory(p, t);
						lastActionTime = now;
						currentlyFillingBuilding = t;
						return;
					}
				} else if (hasItem && stack.item !== bestItem) {
					let dumpTarget = storages.find(s => s.acceptItem(s, stack.item));
					if (dumpTarget) {
						Call.transferInventory(p, dumpTarget);
						lastActionTime = now;
						return;
					}
				} else if (!hasItem && storageWithItem) {
					let countToTake = Math.min(u.type.itemCapacity, storageWithItem.items.get(bestItem));
					if (countToTake > 0) {
						Call.requestItem(p, storageWithItem, bestItem, countToTake);
						lastActionTime = now;
						currentlyFillingBuilding = t;
						return;
					}
				}
				}
			}
		}
	}

	// 5. Transfer items from player unit inventory if matching any valid target
	if (hasItem) {
		for (let i = 0; i < targets.length; i++) {
			let t = targets[i];
			let info = getBlockInfo(t.block);
			if (info && info.isTurret) {
				let bSettings = state.blockSettings[t.block.name];
				if (bSettings && bSettings.disabledAmmo && bSettings.disabledAmmo[stack.item.name]) {
					continue;
				}
			}
			if (info && info.isFuelSelectable) {
				let bSettings = state.blockSettings[t.block.name];
				if (bSettings && bSettings.disabledFuel && bSettings.disabledFuel[stack.item.name]) {
					continue;
				}
			}
			if (t.acceptItem(t, stack.item)) {
				Call.transferInventory(p, t);
				lastActionTime = now;
				currentlyFillingBuilding = t;
				return;
			}
		}
	}

	if (!hasItem) {
		currentlyFillingBuilding = null;
	}
});

Events.run(Trigger.draw, () => {
	if (!Vars.state.isGame() || !state.enabled || !state.drawOutline || !currentlyFillingBuilding) return;
	let b = currentlyFillingBuilding;
	if (b == null || b.dead || b.block == null) {
		currentlyFillingBuilding = null;
		return;
	}

	Draw.z(Layer.max);
	Lines.stroke(1);
	Draw.color(Color.gold, 0.8);
	let sizePx = b.block.size * 8;
	Lines.rect(b.x - sizePx / 2, b.y - sizePx / 2, sizePx, sizePx);
});

require('qol-control/core/settings-ui').register(
	'features/autofill',
	'Autofill',
	showSettingsDialog,
	{ menuSafe: true }
);
