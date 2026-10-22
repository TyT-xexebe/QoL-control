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
// The block is kept only when it is exactly the one the plan wants, at the same
// anchor: the same type shifted by a tile still overlaps the new block.
// A block that cannot be broken stops the whole plan - the rest is left alone,
// because such a plan could never be placed anyway.
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

// Whether the block on this tile is the very block the plan wants: the same
// type at the same anchor. Such a block is already placed and has to stay.
//
// A block of the same type at ANOTHER anchor only overlaps the plan - it still
// has to be demolished. This matters for blocks bigger than 1x1: a 3x3 block
// shifted by one tile covers a part of the new footprint, and the game cannot
// place the plan over it.
function sameBlock(plan, tile) {
	return !!(
		tile.build &&
		tile.build.block == plan.block &&
		tile.build.tileX() === plan.x &&
		tile.build.tileY() === plan.y
	);
}

// What stands on this tile and what to do about it:
//
//   null    - nothing in the way
//   'keep'  - the very block the plan wants, it stays
//   'clear' - a block the player can break, it has to go
//   'stuck' - a block the player cannot break, the plan can never be placed
function tileState(input, plan, x, y) {
	let tile = Vars.world.tile(x, y);
	if (!isOccupied(tile)) return null;
	if (sameBlock(plan, tile)) return 'keep';
	if (!canBreak(input, x, y)) return 'stuck';
	return 'clear';
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

	// The game shifts the held plans to the cursor in its own input update,
	// which runs after this module (Trigger.update fires first). So the shift
	// of this frame is added here, exactly like DesktopInput does it.
	let dx = 0;
	let dy = 0;
	try {
		let mouse = Core.input.mouseWorld();
		let mx = Math.round(mouse.x / Vars.tilesize);
		let my = Math.round(mouse.y / Vars.tilesize);
		// schematicX/Y live on DesktopInput; on mobile they are missing, then the
		// game's own shift is not available either and the plans are used as is
		if (
			isFinite(mx) &&
			isFinite(my) &&
			isFinite(input.schematicX) &&
			isFinite(input.schematicY)
		) {
			dx = mx - input.schematicX;
			dy = my - input.schematicY;
		}
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
		let clear = [];
		let stuck = false;
		for (let t = 0; t < tiles.length; t++) {
			let state = tileState(input, plan, tiles[t].x, tiles[t].y);
			// One block that can never be removed and the whole plan is dead:
			// clearing the rest would only destroy the base for nothing.
			if (state === 'stuck') {
				stuck = true;
				break;
			}
			if (state === 'clear') clear.push(tiles[t]);
		}

		// Nothing to clear: the plan is dropped for another reason (no tech,
		// wrong team, ...) or the block that is already there is exactly the one
		// the schematic wants. Either way there is nothing to wait for.
		if (stuck || !clear.length) continue;

		// The blocks in the way get demolished by the unit.
		for (let t = 0; t < clear.length; t++) {
			let tile = Vars.world.tile(clear[t].x, clear[t].y);
			let bx = tile.build ? tile.build.tileX() : clear[t].x;
			let by = tile.build ? tile.build.tileY() : clear[t].y;
			try {
				unit.addBuild(new BuildPlanClass(bx, by), false);
			} catch (e) {
				logger.err('[buildover] ' + e);
			}
		}
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
		let waiting = false;
		let stuck = false;
		for (let t = 0; t < tiles.length; t++) {
			// Only the blocks that really have to go are waited for.
			let state = tileState(input, plan, tiles[t].x, tiles[t].y);
			if (state === 'clear') waiting = true;
			else if (state === 'stuck') stuck = true;
		}

		if (waiting) {
			if (time - plan.time > timeout) pending.splice(i, 1);
			continue;
		}
		if (stuck) {
			pending.splice(i, 1);
			continue;
		}

		// The whole footprint is free, but the game may still refuse the plan
		// for another reason (deep water, tech, a queued plan on the same
		// tiles, ...). Pushing it into the queue would only get it thrown away
		// silently, so it is handed over only when the game accepts it.
		let fits = true;
		try {
			fits = !!input.validPlace(
				plan.x,
				plan.y,
				plan.block,
				plan.rotation,
				null,
				true
			);
		} catch (e) {}

		if (fits) {
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
