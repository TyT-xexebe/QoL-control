const notify = require('qol-control/core/logger').notify;
const interceptor = require('qol-control/core/interceptor');

const state = {
	enabled: false,
	minLimit: 100,
	maxLimit: 1000,
	cap: 0,
	isMining: false,
	currentMiningItem: null,
	needsMining: { copper: false, lead: false },
	savedBuildingState: true,
	buildPaused: false,
};

try {
	state.enabled = Core.settings.getBool('qol-playermine-enabled', false);
	state.minLimit = Core.settings.getInt('qol-playermine-min', 100);
	state.maxLimit = Core.settings.getInt('qol-playermine-max', 1000);
	state.cap = Core.settings.getInt('qol-playermine-cap', 0);
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

		t.add(limitsTable).padBottom(10).row();

		let capTable = new Table();
		capTable.add('[lightgray]Max amount to mine:[]').padRight(10);
		capTable.field(String(state.cap), (val) => {
			let n = parseInt(val);
			if (!isNaN(n) && n >= 0) {
				state.cap = n;
				Core.settings.put('qol-playermine-cap', new java.lang.Integer(n));
			}
		}).width(100).padRight(10);
		capTable.add('[lightgray](copper & lead, 0 = unlimited)[]').left();

		t.add(capTable).padBottom(5).row();

		t.add(
			'[lightgray]Once the core holds that much of a resource, the unit stops digging it and picks it up again on its own once the amount drops back down.[lightgray]'
		)
			.width(460)
			.wrap()
			.left()
			.padBottom(15)
			.row();

		let scroll = new ScrollPane(t);
		d.cont.add(scroll).grow().row();
	};

	rebuild();
	d.show();
}

// Drops the ore target and forgets what we were digging.
const clearMiningTarget = (u) => {
	if (u && !u.dead) u.mineTile = null;
	state.isMining = false;
	state.currentMiningItem = null;
};

// Hides the build mode from the player so the unit is free to dig.
const pauseBuilding = () => {
	if (state.buildPaused) return;
	state.savedBuildingState = Vars.control.input.isBuilding;
	Vars.control.input.isBuilding = false;
	state.buildPaused = true;
};

// Gives the build mode back, but only if we were the ones who took it away.
const resumeBuilding = () => {
	if (!state.buildPaused) return;
	Vars.control.input.isBuilding = state.savedBuildingState;
	state.buildPaused = false;
};

let lastUpdate = 0;

Events.run(Trigger.update, () => {
	if (!Vars.state.isGame()) return;

	lastUpdate++;
	if (lastUpdate < 5) return;
	lastUpdate = 0;

	let u = Vars.player.unit();

	if (!state.enabled) {
		if (state.isMining || state.currentMiningItem) {
			clearMiningTarget(u);
			resumeBuilding();
		}
		state.needsMining.copper = false;
		state.needsMining.lead = false;
		return;
	}

	if (!u || u.dead || !u.canMine()) {
		if (state.isMining || state.currentMiningItem) clearMiningTarget(u);
		resumeBuilding();
		return;
	}

	let core = u.closestCore();
	if (!core) {
		if (state.isMining || state.currentMiningItem) clearMiningTarget(u);
		resumeBuilding();
		return;
	}

	let items = getMiningItems();
	if (!items.copper && !items.lead) {
		if (state.isMining || state.currentMiningItem) clearMiningTarget(u);
		resumeBuilding();
		return;
	}

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

	// The cap is a ceiling for the digging: once the core holds that much of a
	// resource the unit stops digging it and picks it up again on its own once
	// the amount drops back down. A shortage below the start threshold always
	// wins, so the player is never left without resources.
	let capAllows = (item) => {
		if (state.cap <= 0) return true;
		let amount = core.items.get(item);
		if (amount < state.minLimit) return true;
		return amount < state.cap;
	};

	// What to dig: first the resource we are short of, then whatever else is
	// in reach, scarcest first.
	let wanted = [];
	if (state.needsMining.copper && items.copper && capAllows(items.copper)) {
		wanted.push(items.copper);
	}
	if (state.needsMining.lead && items.lead && capAllows(items.lead)) {
		wanted.push(items.lead);
	}

	let spare = [];
	if (items.copper && !state.needsMining.copper && capAllows(items.copper)) {
		spare.push(items.copper);
	}
	if (items.lead && !state.needsMining.lead && capAllows(items.lead)) {
		spare.push(items.lead);
	}
	spare.sort((a, b) => core.items.get(a) - core.items.get(b));
	wanted = wanted.concat(spare);

	let targetItem = null;
	let oreTile = null;
	for (let i = 0; i < wanted.length; i++) {
		let item = wanted[i];
		if (!item || item.hardness > u.type.mineTier) continue;
		let tile = findClosestOreInMiningRange(u, item);
		if (tile) {
			targetItem = item;
			oreTile = tile;
			break;
		}
	}

	if (!oreTile) {
		if (state.isMining || state.currentMiningItem) clearMiningTarget(u);
		resumeBuilding();
		return;
	}

	// Keep the ore targeted either way, so the unit digs as soon as it is
	// free to do so.
	u.mineTile = oreTile;
	state.currentMiningItem = targetItem;

	// Building only gives way when the resource we dig is the one we are short of.
	if (state.needsMining[targetItem.name]) {
		// Short on resources: digging wins, building waits.
		pauseBuilding();
		state.isMining = true;
	} else {
		// Core is stocked: building goes on, digging continues in between.
		state.isMining = false;
		resumeBuilding();
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

// Expose this module's config dialog to the mod settings screen (gear button).
require('qol-control/core/settings-ui').register(
	'features/playermine',
	'Player Auto-Mine',
	showSettingsDialog,
	{ menuSafe: true }
);
