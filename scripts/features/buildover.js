// features/buildover - place a schematic over blocks that are already there.
//
// The vanilla silently drops the plans of a schematic for tiles that are
// occupied. You cannot build over an existing block, so the layout has to be
// cleared by hand first, and every block that sits in the way has to be found
// with the mouse one by one.
//
// This module keeps those plans instead:
//
//   - when a schematic is placed, every plan of it that lands on an occupied
//     tile is remembered instead of being dropped;
//   - the block that stands there is marked for demolition, so the unit breaks
//     it on its own;
//   - as soon as the tile is free the remembered plan goes back into the build
//     queue and the unit builds it.
//
// A block bigger than 1x1 covers more than one tile, so every tile under it is
// looked at and everything that stands there is cleared - the same way the
// game counts the footprint of a block:
//
//   offset = -(size - 1) / 2, the tiles are (x + dx + offset, y + dy + offset)
//
// The demolition and the build are done by the player's unit, so the usual
// rules apply: the unit has to be in range, the resources have to be there and
// the build mode has to be on.
//
// The demolition is a real demolition - the blocks are gone for good. The
// module is controlled by its on/off toggle in the mod settings.

const logger = require('qol-control/core/logger');

const BindingClass = Packages.mindustry.input.Binding;
const BuildPlanClass = Packages.mindustry.entities.units.BuildPlan;

let enabled = true;
// How long a plan waits for its tile before it is given up on (ms).
let timeout = 60000;

try {
	enabled = Core.settings.getBool('qol-buildover-enabled', true);
	timeout = Core.settings.getInt('qol-buildover-timeout', 60000);
} catch (e) {}

// Plans that wait for their tile to be freed.
let pending = [];
// Signatures of the plans the unit had in its queue, to spot a new placement.
let lastQueue = {};

function now() {
	return Time.millis();
}

// A tile is taken when a building stands on it or a wall blocks it.
function isOccupied(tile) {
	if (!tile) return false;
	if (tile.build) return true;
	let block = tile.block();
	return !!(block && block.solid);
}

// Whether the player is allowed to break the block on this tile. Walls and
// other unbreakable blocks would only make the unit waste its time.
function canBreak(input, x, y) {
	try {
		return !!input.validBreak(x, y);
	} catch (e) {
		// No answer from the game: assume it can be broken, like the vanilla.
		return true;
	}
}

// Does the block on this tile have to go for the plan to be placed?
//
//   - nothing there: no
//   - the same block the schematic wants: no, the game places it by itself
//   - a block the player cannot break: no, that plan can never be placed
//   - anything else: yes, it has to be demolished first
function needsDemolition(input, plan, x, y) {
	let tile = Vars.world.tile(x, y);
	if (!isOccupied(tile)) return false;
	if (tile.build && tile.build.block == plan.block) return false;
	if (!canBreak(input, x, y)) return false;
	return true;
}

// The tiles a planned block covers, counted the way the game counts them.
function footprint(plan) {
	let size = plan.block && plan.block.size ? plan.block.size : 1;
	let offset = -Math.floor((size - 1) / 2);
	let out = [];
	for (let dx = 0; dx < size; dx++) {
		for (let dy = 0; dy < size; dy++) {
			out.push({ x: plan.x + dx + offset, y: plan.y + dy + offset });
		}
	}
	return out;
}

function signature(plan) {
	if (!plan) return '';
	return (
		plan.x +
		',' +
		plan.y +
		',' +
		(plan.block ? String(plan.block.name) : 'break')
	);
}

function queueSignatures(unit) {
	let out = {};
	if (!unit || !unit.plans) return out;
	for (let i = 0; i < unit.plans.size; i++) {
		out[signature(unit.plans.get(i))] = true;
	}
	return out;
}

// The plans of the schematic that is currently held, with the shift to the
// current cursor position applied: the game moves them every frame, so they
// can be a frame behind.
function currentPlans(input) {
	let out = [];
	let plans = input.selectPlans;
	if (!plans) return out;

	let dx = 0;
	let dy = 0;
	try {
		dx = Math.floor(Vars.mouseWorld.x / 8) - input.schematicX;
		dy = Math.floor(Vars.mouseWorld.y / 8) - input.schematicY;
	} catch (e) {}

	for (let i = 0; i < plans.size; i++) {
		let plan = plans.get(i);
		if (!plan || !plan.block) continue;
		out.push({
			x: plan.x + dx,
			y: plan.y + dy,
			rotation: plan.rotation,
			block: plan.block,
			config: plan.config,
		});
	}
	return out;
}

function hasPending(x, y) {
	for (let i = 0; i < pending.length; i++) {
		if (pending[i].x === x && pending[i].y === y) return true;
	}
	return false;
}

// Marks the blocks that are in the way and remembers the plans of the
// schematic for the tiles they stand on.
function handlePlacement(input, unit) {
	let plans = currentPlans(input);
	if (!plans.length) return;

	for (let i = 0; i < plans.length; i++) {
		let plan = plans[i];

		// Everything that fits is placed by the game itself.
		let fits = false;
		try {
			fits = input.validPlace(plan.x, plan.y, plan.block, plan.rotation, null, true);
		} catch (e) {
			fits = true;
		}
		if (fits) continue;

		// Everything under the block has to go, not only the tile it starts on.
		let tiles = footprint(plan);
		let needDemolition = false;
		for (let t = 0; t < tiles.length; t++) {
			if (!needsDemolition(input, plan, tiles[t].x, tiles[t].y)) continue;
			needDemolition = true;

			// The block in the way gets demolished by the unit.
			let tile = Vars.world.tile(tiles[t].x, tiles[t].y);
			let bx = tile.build ? tile.build.tileX() : tiles[t].x;
			let by = tile.build ? tile.build.tileY() : tiles[t].y;
			try {
				unit.addBuild(new BuildPlanClass(bx, by), false);
			} catch (e) {
				logger.err('[buildover] ' + e);
			}
		}

		// Nothing to clear: the plan is dropped for another reason (no tech,
		// wrong team, ...) or the block that is already there is exactly the one
		// the schematic wants. Either way there is nothing to wait for.
		if (!needDemolition) continue;
		if (hasPending(plan.x, plan.y)) continue;

		pending.push({
			x: plan.x,
			y: plan.y,
			rotation: plan.rotation,
			block: plan.block,
			config: plan.config,
			time: now(),
		});
	}
}

// Puts the remembered plans back into the queue as soon as their tile is free.
function processPending(unit, input) {
	if (!pending.length) return;
	let time = now();
	for (let i = pending.length - 1; i >= 0; i--) {
		let plan = pending[i];
		let tiles = footprint(plan);
		let free = true;
		for (let t = 0; t < tiles.length; t++) {
			// Only the blocks that really have to go are waited for.
			if (needsDemolition(input, plan, tiles[t].x, tiles[t].y)) {
				free = false;
				break;
			}
		}
		if (free) {
			try {
				unit.addBuild(
					new BuildPlanClass(
						plan.x,
						plan.y,
						plan.rotation,
						plan.block,
						plan.config
					)
				);
			} catch (e) {
				logger.err('[buildover] ' + e);
			}
			pending.splice(i, 1);
		} else if (time - plan.time > timeout) {
			pending.splice(i, 1);
		}
	}
}

function tick() {
	if (!enabled) {
		pending.length = 0;
		lastQueue = {};
		return;
	}
	if (!Vars.state || !Vars.state.isGame()) return;

	let player = Vars.player;
	if (!player || player.dead()) {
		pending.length = 0;
		lastQueue = {};
		return;
	}
	let unit = player.unit();
	if (!unit || !unit.plans) return;

	let input = Vars.control ? Vars.control.input : null;
	if (!input || !input.selectPlans) return;

	let queue = queueSignatures(unit);
	let added = [];
	for (let key in queue) {
		if (!lastQueue[key]) added.push(key);
	}
	lastQueue = queue;

	let clicked = false;
	try {
		clicked = Core.input.keyTap(BindingClass.select);
	} catch (e) {}

	// A placement happened when the player clicked, or when the queue grew
	// with a plan of the schematic that is held.
	let placed = false;
	if (input.selectPlans.size > 0) {
		if (clicked) {
			placed = true;
		} else if (added.length > 0) {
			let held = currentPlans(input);
			for (let i = 0; i < added.length; i++) {
				for (let h = 0; h < held.length; h++) {
					if (
						added[i] ===
						held[h].x +
							',' +
							held[h].y +
							',' +
							String(held[h].block.name)
					) {
						placed = true;
						break;
					}
				}
				if (placed) break;
			}
		}
	}

	if (placed) handlePlacement(input, unit);
	processPending(unit, input);
}

Events.run(Trigger.update, () => {
	try {
		tick();
	} catch (e) {
		logger.err('[buildover] ' + e);
	}
});

module.exports = {
	tick: tick,
	pending: () => pending,
	reset: () => {
		pending.length = 0;
		lastQueue = {};
	},
};
