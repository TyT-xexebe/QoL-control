// features/buildover - place a schematic over blocks that are already there.
//
// Port of the game-side BuildOverModule. The game calls it right before the
// schematic plans are flushed, with the plans already shifted to the cursor.
// A script cannot hook that call, so the press is caught on the click frame
// and the plans are handled on the next tick: by then the game has shifted
// them to the cursor, exactly as the game-side module sees them.
//
// The vanilla drops the plans of a schematic for occupied tiles. This module
// keeps them: the blocks in the way are marked for demolition and the plans go
// back into the build queue as soon as their footprint is free.
//
// A block bigger than 1x1 covers more than one tile, so every tile under it is
// looked at, the same way the game counts the footprint:
//
//   offset = -(size - 1) / 2, the tiles are (x + dx + offset, y + dy + offset)
//
// A block of the same type at ANOTHER anchor only overlaps the plan, so it is
// demolished like any other block in the way. A block that cannot be broken
// stops the whole plan - the rest is left alone, because such a plan could
// never be placed anyway.
//
// The demolition and the build are done by the player's unit, so the usual
// rules apply: the unit has to be in range, the resources have to be there and
// the build mode has to be on.

const logger = require('qol-control/core/logger');

const BindingClass = Packages.mindustry.input.Binding;
const BuildPlanClass = Packages.mindustry.entities.units.BuildPlan;

let enabled = true;
let timeout = 60000;

try {
	enabled = Core.settings.getBool('qol-buildover-enabled', true);
	timeout = Core.settings.getInt('qol-buildover-timeout', 60000);
} catch (e) {}

// Plans that wait for their footprint to be freed.
let pending = [];
// The select button state of the previous frame, to catch a press once.
let lastSelect = false;
// A press was caught on the previous frame; its plans are handled now.
let placement = false;

function now() {
	return Time.millis();
}

function reset() {
	pending.length = 0;
	lastSelect = false;
	placement = false;
}

// A tile is taken when a building stands on it or a wall blocks it.
function occupied(tile) {
	if (!tile) return false;
	if (tile.build) return true;
	let block = tile.block();
	return !!(block && block.solid);
}

// The block the plan wants, at the same anchor, is already placed and stays.
function sameBlock(plan, tile) {
	return !!(
		tile.build &&
		tile.build.block == plan.block &&
		tile.build.tileX() === plan.x &&
		tile.build.tileY() === plan.y
	);
}

function signature(plan) {
	return plan.x + ',' + plan.y + ',' + (plan.block ? plan.block.name : '');
}

// The plans the game already put into the queue: the valid ones were flushed
// on the click frame, so they must not be handled as blocked.
function queued(unit) {
	let out = {};
	if (!unit || !unit.plans) return out;
	for (let i = 0; i < unit.plans.size; i++) {
		let plan = unit.plans.get(i);
		if (plan && !plan.breaking && plan.block) {
			out[signature(plan)] = true;
		}
	}
	return out;
}

function hasPending(x, y) {
	for (let i = 0; i < pending.length; i++) {
		if (pending[i].x === x && pending[i].y === y) return true;
	}
	return false;
}

// The plans of the held schematic, already shifted to the cursor by the game.
function heldPlans(input) {
	let out = [];
	let plans = input.selectPlans;
	if (!plans) return out;
	for (let i = 0; i < plans.size; i++) {
		let plan = plans.get(i);
		if (!plan || !plan.block || plan.breaking) continue;
		out.push({
			x: plan.x,
			y: plan.y,
			rotation: plan.rotation,
			block: plan.block,
			config: plan.config,
		});
	}
	return out;
}

// Port of BuildOverModule.beforePlacement.
function beforePlacement(unit, input, plans) {
	let inQueue = queued(unit);

	for (let i = 0; i < plans.length; i++) {
		let plan = plans[i];
		if (inQueue[signature(plan)]) continue;

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
		if (fits) continue;

		let size = plan.block.size;
		let offset = -Math.floor((size - 1) / 2);
		let clear = [];
		let stuck = false;

		for (let dx = 0; dx < size && !stuck; dx++) {
			for (let dy = 0; dy < size; dy++) {
				let tile = Vars.world.tile(
					plan.x + dx + offset,
					plan.y + dy + offset
				);
				if (!occupied(tile)) continue;
				if (sameBlock(plan, tile)) continue;
				if (!input.validBreak(tile.x, tile.y)) {
					stuck = true;
					break;
				}
				clear.push({ x: tile.x, y: tile.y });
			}
		}

		// One block that can never be removed and the whole plan is dead:
		// clearing the rest would only destroy the base for nothing.
		if (stuck || !clear.length) continue;

		for (let c = 0; c < clear.length; c++) {
			let tile = Vars.world.tile(clear[c].x, clear[c].y);
			let bx = tile && tile.build ? tile.build.tileX() : clear[c].x;
			let by = tile && tile.build ? tile.build.tileY() : clear[c].y;
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

// Port of BuildOverModule.processPending.
function processPending(unit, input) {
	if (!pending.length) return;
	let time = now();

	for (let i = pending.length - 1; i >= 0; i--) {
		let plan = pending[i];
		let size = plan.block.size;
		let offset = -Math.floor((size - 1) / 2);
		let waiting = false;
		let stuck = false;

		for (let dx = 0; dx < size && !stuck; dx++) {
			for (let dy = 0; dy < size; dy++) {
				let tile = Vars.world.tile(
					plan.x + dx + offset,
					plan.y + dy + offset
				);
				if (!occupied(tile)) continue;
				if (sameBlock(plan, tile)) continue;
				if (!input.validBreak(tile.x, tile.y)) {
					stuck = true;
					break;
				}
				waiting = true;
			}
		}

		if (waiting) {
			if (time - plan.time > timeout) pending.splice(i, 1);
			continue;
		}
		if (stuck) {
			pending.splice(i, 1);
			continue;
		}

		let fits = false;
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
		reset();
		return;
	}
	if (!Vars.state || !Vars.state.isGame()) {
		reset();
		return;
	}

	let player = Vars.player;
	if (!player || player.dead()) {
		reset();
		return;
	}

	let unit = player.unit();
	let input = Vars.control ? Vars.control.input : null;
	if (!unit || !input || !input.selectPlans) return;

	processPending(unit, input);

	// The plans of the previous press are shifted to the cursor by now.
	if (placement) {
		placement = false;
		beforePlacement(unit, input, heldPlans(input));
	}

	// The game places the held schematic on the press of the select button and
	// only when the cursor is over the world. The press is tracked by the mouse
	// state, because keyTap is already consumed by the game by then.
	let down = false;
	try {
		down = Core.input.keyDown(BindingClass.select);
	} catch (e) {}

	let clicked = down && !lastSelect;
	lastSelect = down;

	if (clicked && input.selectPlans.size > 0) {
		let allowed = false;
		try {
			allowed =
				!Core.scene.hasMouse() &&
				!Core.input.keyDown(BindingClass.breakBlock);
		} catch (e) {}
		if (allowed) {
			placement = true;
		}
	}
}

Events.on(WorldLoadEvent, () => reset());

Events.run(Trigger.update, () => {
	try {
		tick();
	} catch (e) {
		logger.err('[buildover] ' + e);
	}
});
