// features/pumpfix - replace water extractors that cannot be built.
//
// A water extractor (2x2 SolidPump) needs dry ground under it. The module does
// not touch the schematic while it is held - the preview shows what the
// schematic really contains and nothing is rewritten under the player. The work
// is done once, when the schematic is placed.
//
// On the placement the module remembers every water extractor of the schematic
// together with the water under its footprint. Then it looks into the build
// queue of the player, where the game puts the placed plans:
//
//   1 cell  wet  -> rotary-pump (2x2) on the same footprint
//   2+ cells wet -> mechanical-pump (1x1) on every wet cell
//
// An extractor standing entirely on water is not put into the queue at all -
// the game throws that plan away. Such an extractor is rebuilt from the
// remembered water: the pumps are added to the queue directly.
//
// Extractors on dry ground are left alone.
//
// No command and no chat message: the module is controlled by its on/off toggle.

const logger = require('qol-control/core/logger');

const EXTRACTOR = 'water-extractor';
const ROTARY = 'rotary-pump';
const PUMP = 'mechanical-pump';
const SIZE = 2;
// How many frames the game gets to put the placed plans into the queue.
const QUEUE_GRACE = 4;

const BindingClass = Packages.mindustry.input.Binding;
const BuildPlanClass = Packages.mindustry.entities.units.BuildPlan;

// Extractors of recent placements that still have to be handled:
//   x, y - the footprint corner
//   wet  - the wet cells under the footprint, remembered at the placement
let pending = [];
let frames = 0;

function tileAt(x, y) {
	try {
		return Vars.world.tile(x, y);
	} catch (e) {
		return null;
	}
}

function isLiquidAt(x, y) {
	let tile = tileAt(x, y);
	if (!tile) return false;
	try {
		let floor = tile.floor();
		return !!(floor && floor.isLiquid);
	} catch (e) {
		return false;
	}
}

// The wet cells of the 2x2 footprint that starts at (x, y).
function wetCells(x, y) {
	let out = [];
	for (let dy = 0; dy < SIZE; dy++) {
		for (let dx = 0; dx < SIZE; dx++) {
			let cx = x + dx;
			let cy = y + dy;
			if (isLiquidAt(cx, cy)) out.push({x: cx, y: cy});
		}
	}
	return out;
}

// The plan of this extractor that the game put into the build queue.
function findQueued(unit, x, y) {
	let plans = unit.plans;
	if (!plans) return null;
	for (let i = 0; i < plans.size; i++) {
		let plan = plans.get(i);
		if (!plan || plan.breaking || !plan.block) continue;
		if (plan.x !== x || plan.y !== y) continue;
		if (String(plan.block.name) !== EXTRACTOR) continue;
		return plan;
	}
	return null;
}

// Writes the replacement into the queue. plan is the queued extractor plan, or
// null when the game threw it away and the pumps are built from scratch.
function replace(unit, item, plan, rotaryBlock, pumpBlock) {
	let wet = item.wet;

	// one wet cell: the rotary pump takes the whole footprint
	if (wet.length === 1) {
		if (plan) {
			plan.block = rotaryBlock;
			plan.cachedValid = false;
		} else {
			unit.addBuild(new BuildPlanClass(item.x, item.y, 0, rotaryBlock));
		}
		return 'rotary pump';
	}

	// more wet cells: a mechanical pump on every wet cell
	for (let i = 0; i < wet.length; i++) {
		if (i === 0 && plan) {
			plan.block = pumpBlock;
			plan.x = wet[i].x;
			plan.y = wet[i].y;
			plan.cachedValid = false;
			continue;
		}
		unit.addBuild(new BuildPlanClass(wet[i].x, wet[i].y, 0, pumpBlock));
	}
	return wet.length + ' pumps';
}

function tick() {
	if (!Vars.state || !Vars.state.isGame()) {
		pending = [];
		return;
	}

	let input = Vars.control.input;
	if (!input || !input.selectPlans) return;

	let player = Vars.player;
	if (!player || player.dead()) {
		pending = [];
		return;
	}

	let unit = player.unit();
	if (!unit || !unit.plans) return;

	let rotaryBlock = Vars.content.block(ROTARY);
	let pumpBlock = Vars.content.block(PUMP);
	if (!rotaryBlock || !pumpBlock) return;

	// A placement: remember the extractors of the schematic and the water under
	// them. The selection still holds every plan of the schematic, so even the
	// extractors the game is about to throw away are seen here.
	let clicked = false;
	try {
		clicked = Core.input.keyTap(BindingClass.select);
	} catch (e) {}
	if (clicked && input.selectPlans.size > 0) {
		frames = 0;
		for (let i = 0; i < input.selectPlans.size; i++) {
			let plan = input.selectPlans.get(i);
			if (!plan || !plan.block || plan.breaking) continue;
			if (String(plan.block.name) !== EXTRACTOR) continue;
			let wet = wetCells(plan.x, plan.y);
			if (wet.length === 0) continue; // dry ground, nothing to do
			pending.push({x: plan.x, y: plan.y, wet: wet});
		}
	}

	if (!pending.length) return;
	frames++;

	for (let i = pending.length - 1; i >= 0; i--) {
		let item = pending[i];
		let queued = findQueued(unit, item.x, item.y);

		if (queued) {
			let what = replace(unit, item, queued, rotaryBlock, pumpBlock);
			logger.info(
				'[pumpfix] ' + item.x + ',' + item.y + ' (' + item.wet.length +
				' wet) -> ' + what
			);
			pending.splice(i, 1);
		} else if (frames > QUEUE_GRACE) {
			// the game threw the plan away - the extractor is all water
			let what = replace(unit, item, null, rotaryBlock, pumpBlock);
			logger.info(
				'[pumpfix] ' + item.x + ',' + item.y + ' (' + item.wet.length +
				' wet) thrown away by the game -> ' + what
			);
			pending.splice(i, 1);
		}
	}
}

Events.run(Trigger.update, () => {
	try {
		tick();
	} catch (e) {
		logger.err('[pumpfix] ' + e);
	}
});

module.exports = {
	tick: tick,
	pending: () => pending,
	reset: () => {
		pending = [];
		frames = 0;
	},
};
