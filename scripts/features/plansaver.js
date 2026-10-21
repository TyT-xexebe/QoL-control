// features/plansaver - keep the build plan when the player dies and respawns.
//
// The build plan lives on the unit, so a dead unit takes its plan with it. The
// unit that spawns at the core starts with an empty plan and a queued layout
// is simply gone. Sometimes only half of it is gone: the game can hand the
// player a different unit after the death (a nearby unit of the same type it
// is allowed to control) and that unit still carries a plan of its own.
//
// This module keeps a snapshot of the plan and writes it back onto the unit the
// player controls after the respawn.
//
// The snapshot is refreshed every tick while the player is alive. While the
// player is dead it is frozen, so it still holds the plan of the unit that
// died. As soon as a new unit shows up, the saved plans are pushed back onto
// it, replacing whatever plan it came with.
//
// The restore only fires for a unit that actually replaced the old one, so a
// plan that the player edits by hand is never touched.
//
// No command and no chat message: the module is controlled by its on/off toggle.

const logger = require('qol-control/core/logger');

const BindingClass = Packages.mindustry.input.Binding;
const QueueClass = Packages.arc.struct.Queue;

let enabled = true;
// Snapshot of the plan of the unit the player is currently controlling.
let saved = [];
// The unit the snapshot belongs to. A different unit means the old one died.
let lastUnit = null;
// Set while the player has no unit, so the next unit is a respawn.
let respawnPending = false;

function copyPlans(queue) {
	let out = [];
	if (!queue) return out;
	try {
		for (let i = 0; i < queue.size; i++) {
			let plan = queue.get(i);
			if (plan) out.push(plan);
		}
	} catch (e) {}
	return out;
}

function samePlans(a, b) {
	if (!a || !b) return false;
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return false;
	}
	return true;
}

function restorePlans(unit) {
	try {
		let queue = new QueueClass();
		for (let i = 0; i < saved.length; i++) queue.add(saved[i]);
		unit.plans = queue;
		logger.info('[plansaver] restored ' + saved.length + ' build plans');
	} catch (e) {
		logger.err('[plansaver] ' + e);
	}
}

function tick() {
	if (!enabled) return;
	if (!Vars.state || !Vars.state.isGame()) return;

	let player = Vars.player;
	let dead = !player || player.dead();

	if (dead) {
		// The unit is gone and so is its plan. The snapshot stays frozen until
		// the player is back, then it goes onto the new unit.
		respawnPending = true;
		return;
	}

	// The respawn key can be handled in the same frame as the respawn itself,
	// so the dead state is not always seen.
	try {
		if (Core.input.keyTap(BindingClass.respawn)) respawnPending = true;
	} catch (e) {}

	let unit = player.unit();
	if (unit && unit !== lastUnit) {
		let old = lastUnit;
		lastUnit = unit;

		// The old unit died instead of being handed over: that is a respawn.
		if (old && isGone(old)) respawnPending = true;

		if (respawnPending && saved.length > 0 && unit.plans) {
			let current = copyPlans(unit.plans);
			if (current.length === 0 || !samePlans(current, saved)) {
				restorePlans(unit);
			}
		}
		respawnPending = false;
	}

	if (unit && unit.plans) saved = copyPlans(unit.plans);
}

// A unit that is dead or no longer in the world.
function isGone(unit) {
	try {
		if (unit.dead) return true;
		if (typeof unit.isValid === 'function') return !unit.isValid();
	} catch (e) {}
	return false;
}

Events.run(Trigger.update, () => {
	try {
		tick();
	} catch (e) {
		logger.err('[plansaver] ' + e);
	}
});

module.exports = {
	tick: tick,
	saved: () => saved,
	reset: () => {
		saved = [];
		lastUnit = null;
		respawnPending = false;
	},
};
