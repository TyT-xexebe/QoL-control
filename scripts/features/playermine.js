const notify = require('qol-control/core/logger').notify;
const interceptor = require('qol-control/core/interceptor');

const state = {
	enabled: false,
	minLimit: 100,
	maxLimit: 1000,
	isMining: false,
	currentMiningItem: null,
	needsMining: { copper: false, lead: false },
	savedBuildingState: true,
};

try {
	state.enabled = Core.settings.getBool('qol-playermine-enabled', false);
	state.minLimit = Core.settings.getInt('qol-playermine-min', 100);
	state.maxLimit = Core.settings.getInt('qol-playermine-max', 1000);
} catch (e) {}

const getMiningItems = () => {
	let copper = null;
	let lead = null;
	Vars.content.items().each(cons((it) => {
		if (String(it.name) === 'copper') copper = it;
		if (String(it.name) === 'lead') lead = it;
	}));
	return { copper: copper, lead: lead };
};

const findClosestOreInMiningRange = (u, item) => {
	let range = u.type.mineRange / 8;
	let utx = u.tileX();
	let uty = u.tileY();
	let closest = null;
	let minDst = Infinity;
	let air = Blocks.air;
	let r = Math.ceil(range);
	let tiles = Vars.world.tiles;

	for (let dx = -r; dx <= r; dx++) {
		for (let dy = -r; dy <= r; dy++) {
			let tx = utx + dx;
			let ty = uty + dy;
			if (tx < 0 || tx >= Vars.world.width() || ty < 0 || ty >= Vars.world.height()) continue;
			let tile = tiles.getn(tx, ty);
			if (!tile) continue;
			
			let block = tile.block();
			let isMineable = false;
			if (block === air) {
				isMineable = tile.drop() === item;
			} else {
				isMineable = block.itemDrop === item;
			}

			if (isMineable) {
				let d = dx * dx + dy * dy;
				if (d < minDst) {
					minDst = d;
					closest = tile;
				}
			}
		}
	}
	return closest;
};

function showSettingsDialog() {
	let d = new BaseDialog('Player Mine Settings');
	d.addCloseButton();

	let rebuild = () => {
		d.cont.clear();

		let t = new Table();
		t.top();

		t.table(cons((row) => {
			row.add('[lightgray]Status:[] ').left();
			row.button(state.enabled ? '[green]ON[]' : '[scarlet]OFF[]', () => {
				state.enabled = !state.enabled;
				Core.settings.put('qol-playermine-enabled', new java.lang.Boolean(state.enabled));
				rebuild();
			}).size(120, 40);
		})).padBottom(15).row();

		let limitsTable = new Table();
		limitsTable.add('[lightgray]Min core count to START:[]').padRight(10);
		limitsTable.field(String(state.minLimit), (val) => {
			let n = parseInt(val);
			if (!isNaN(n) && n >= 0) {
				state.minLimit = n;
				Core.settings.put('qol-playermine-min', new java.lang.Integer(n));
			}
		}).width(100).padRight(20);

		limitsTable.add('[lightgray]Max core count to STOP:[]').padRight(10);
		limitsTable.field(String(state.maxLimit), (val) => {
			let n = parseInt(val);
			if (!isNaN(n) && n >= 0) {
				state.maxLimit = n;
				Core.settings.put('qol-playermine-max', new java.lang.Integer(n));
			}
		}).width(100);

		t.add(limitsTable).padBottom(15).row();

		let scroll = new ScrollPane(t);
		d.cont.add(scroll).grow().row();
	};

	rebuild();
	d.show();
}

let lastUpdate = 0;

Events.run(Trigger.update, () => {
	if (!Vars.state.isGame()) return;

	lastUpdate++;
	if (lastUpdate < 5) return;
	lastUpdate = 0;

	if (!state.enabled) {
		if (state.isMining) {
			let u = Vars.player.unit();
			if (u && !u.dead) {
				u.mineTile = null;
			}
			Vars.control.input.isBuilding = true;
			state.isMining = false;
			state.currentMiningItem = null;
			state.needsMining.copper = false;
			state.needsMining.lead = false;
		}
		return;
	}

	let u = Vars.player.unit();
	if (!u || u.dead || !u.canMine()) {
		if (state.isMining) {
			Vars.control.input.isBuilding = true;
			state.isMining = false;
			state.currentMiningItem = null;
		}
		return;
	}

	let core = u.closestCore();
	if (!core) {
		if (state.isMining) {
			u.mineTile = null;
			Vars.control.input.isBuilding = true;
			state.isMining = false;
			state.currentMiningItem = null;
		}
		return;
	}

	let items = getMiningItems();
	if (!items.copper && !items.lead) return;

	if (items.copper) {
		let copperAmount = core.items.get(items.copper);
		if (copperAmount < state.minLimit) {
			state.needsMining.copper = true;
		} else if (copperAmount >= state.maxLimit) {
			state.needsMining.copper = false;
		}
	} else {
		state.needsMining.copper = false;
	}

	if (items.lead) {
		let leadAmount = core.items.get(items.lead);
		if (leadAmount < state.minLimit) {
			state.needsMining.lead = true;
		} else if (leadAmount >= state.maxLimit) {
			state.needsMining.lead = false;
		}
	} else {
		state.needsMining.lead = false;
	}

	if (state.isMining && state.currentMiningItem) {
		let itemObj = state.currentMiningItem;
		let stillNeeds = state.needsMining[itemObj.name];
		let canMineObj = itemObj.hardness <= u.type.mineTier;

		if (stillNeeds && canMineObj) {
			let oreTile = findClosestOreInMiningRange(u, itemObj);
			if (oreTile) {
				u.mineTile = oreTile;
				return;
			}
		}

		u.mineTile = null;
		state.currentMiningItem = null;
		state.isMining = false;
		Vars.control.input.isBuilding = true;
	}

	let targetItem = null;
	if (state.needsMining.copper && items.copper && items.copper.hardness <= u.type.mineTier) {
		targetItem = items.copper;
	}
	if (state.needsMining.lead && items.lead && items.lead.hardness <= u.type.mineTier) {
		if (targetItem) {
			let copperAmt = core.items.get(items.copper);
			let leadAmt = core.items.get(items.lead);
			if (leadAmt < copperAmt) {
				targetItem = items.lead;
			}
		} else {
			targetItem = items.lead;
		}
	}

	if (targetItem) {
		let oreTile = findClosestOreInMiningRange(u, targetItem);
		if (oreTile) {
			state.savedBuildingState = Vars.control.input.isBuilding;
			Vars.control.input.isBuilding = false;
			state.isMining = true;
			state.currentMiningItem = targetItem;
			u.mineTile = oreTile;
		}
	} else {
		if (state.isMining) {
			u.mineTile = null;
			Vars.control.input.isBuilding = true;
			state.isMining = false;
			state.currentMiningItem = null;
		}
	}
});

interceptor.add('mine', (args) => {
	if (args[1] === 'set' || args[1] === 's' || args[1] === 'settings') {
		showSettingsDialog();
		return;
	}

	if (args[1] && !interceptor.isBooleanArg(args[1])) {
		notify('[lightgray]Usage: !mine <1/0?> or !mine set/settings');
		return;
	}

	state.enabled = interceptor.parseToggle(state.enabled, args[1]);
	Core.settings.put('qol-playermine-enabled', new java.lang.Boolean(state.enabled));

	notify('[lightgray]Player Auto-Mine:[] ' + (state.enabled ? '[green]ON[]' : '[scarlet]OFF[]'));
});
