// features/pumpfix - cover water with mechanical pumps where an extractor cannot go.
//
// A water extractor (2x2 SolidPump) refuses to stand on a liquid floor, so a
// schematic drawn over a lake silently loses every extractor in it. Mechanical
// pumps have the opposite rule - they must stand ON liquid - so the four cells of
// the extractor's footprint are covered with four 1x1 pumps.
//
// Why the extractor plan is left in place
//   InputHandler.rotatePlans()/flipPlans() rotate every plan around its own
//   block.offset, and a 2x2 block uses different arithmetic than a 1x1 one. An
//   earlier version swapped the anchor plan to a pump, so the game rotated it as
//   a 1x1 and the whole block landed one tile off after a rotation. The extractor
//   plan is therefore left untouched: it rotates with correct 2x2 semantics, and
//   it is simply invalid on water, so the game skips placing it. The four pump
//   plans are rebuilt around it on every frame, which keeps them attached to the
//   extractor no matter how the layout is rotated, mirrored or dragged.
//
// No command and no chat message: the module is controlled by its on/off toggle.

const logger = require('qol-control/core/logger');

const EXTRACTOR = 'water-extractor';
const PUMP = 'mechanical-pump';

const BuildPlanClass = Packages.mindustry.entities.units.BuildPlan;

// {anchor: BuildPlan (the extractor), pumps: [BuildPlan x4]}
let groups = [];
let idleFrames = 0;

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

function footprintWet(x, y, size) {
	for (let dx = 0; dx < size; dx++) {
		for (let dy = 0; dy < size; dy++) {
			if (isLiquidAt(x + dx, y + dy)) return true;
		}
	}
	return false;
}

function hasPlan(plans, plan) {
	for (let i = 0; i < plans.size; i++) {
		if (plans.get(i) === plan) return true;
	}
	return false;
}

function dropPlan(plans, plan) {
	for (let i = 0; i < plans.size; i++) {
		if (plans.get(i) === plan) {
			plans.remove(i);
			return true;
		}
	}
	return false;
}

// Park the four pumps exactly on the extractor's cells. Called every frame, so a
// rotation or a drag cannot leave them behind.
function placePumps(group) {
	let size = group.anchor.block.size || 2;
	let i = 0;
	for (let dx = 0; dx < size; dx++) {
		for (let dy = 0; dy < size; dy++) {
			let pump = group.pumps[i++];
			if (!pump) continue;
			pump.x = group.anchor.x + dx;
			pump.y = group.anchor.y + dy;
			pump.cachedValid = false;
		}
	}
}

function addPumps(anchor, pump, plans) {
	let size = anchor.block.size || 2;
	let pumps = [];
	for (let dx = 0; dx < size; dx++) {
		for (let dy = 0; dy < size; dy++) {
			let plan = new BuildPlanClass(anchor.x + dx, anchor.y + dy, 0, pump);
			plans.add(plan);
			pumps.push(plan);
		}
	}
	groups.push({anchor: anchor, pumps: pumps});
}

function removeGroup(group, plans) {
	for (let i = 0; i < group.pumps.length; i++) dropPlan(plans, group.pumps[i]);
}

function tick() {
	if (!Vars.state.isGame()) {
		groups = [];
		idleFrames = 0;
		return;
	}

	let input = Vars.control.input;
	if (!input || !input.selectPlans) return;

	let plans = input.selectPlans;

	if (plans.size === 0) {
		idleFrames++;
		if (idleFrames > 2) groups = [];
		return;
	}
	idleFrames = 0;

	let pump = Vars.content.block(PUMP);
	if (!pump) return;

	try {
		// 1. Keep the groups we already made in sync, drop the ones that no longer
		//    apply (layout released, extractor moved off the water).
		let kept = [];
		for (let i = 0; i < groups.length; i++) {
			let group = groups[i];

			if (!hasPlan(plans, group.anchor)) {
				for (let p = 0; p < group.pumps.length; p++) dropPlan(plans, group.pumps[p]);
				continue;
			}

			let size = group.anchor.block.size || 2;
			if (footprintWet(group.anchor.x, group.anchor.y, size)) {
				placePumps(group);
				kept.push(group);
			} else {
				removeGroup(group, plans);
			}
		}
		groups = kept;

		// 2. Cover extractors that are standing on liquid and are not covered yet.
		let covered = {};
		for (let i = 0; i < groups.length; i++) covered[groups[i].anchor] = true;

		let current = [];
		for (let i = 0; i < plans.size; i++) current.push(plans.get(i));

		for (let i = 0; i < current.length; i++) {
			let plan = current[i];
			if (!plan || !plan.block || plan.block.name !== EXTRACTOR) continue;
			if (plan.breaking) continue;
			// Already converted: adding again would stack a second set of pumps.
			if (covered[plan]) continue;
			let size = plan.block.size || 2;
			if (!footprintWet(plan.x, plan.y, size)) continue;
			addPumps(plan, pump, plans);
		}
	} catch (e) {
		logger.err('[pumpfix] ' + e);
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
	groups: () => groups,
	reset: () => {
		groups = [];
		idleFrames = 0;
	},
};
