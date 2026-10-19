// features/pumpfix - keep a schematic alive when it lands on water.
//
// A water extractor (2x2 SolidPump) needs dry ground under it. Over open water it
// cannot be built and the plan is dropped silently. The replacement depends on how
// much of the footprint is flooded:
//
//   0 cells wet  -> leave the water extractor alone
//   1 cell  wet  -> rotary-pump (2x2) on the same footprint
//   2+ cells wet -> mechanical-pump (1x1) on every wet cell
//
// Tracking the footprint across rotation
//   InputHandler.rotatePlans()/flipPlans() transform every plan in place, and each
//   block is rotated around its OWN block.offset. A 2x2 block therefore moves
//   differently from a 1x1 one, and mixing the two sizes in a group made the
//   reconstruction of the footprint drift by a tile every turn.
//
//   In pump mode every plan the group owns is a 1x1 pump, so they all share the
//   same offset and their motion is a rigid transform: a rotation by a multiple of
//   90 degrees plus a translation. Each frame that transform is solved from the
//   previous and current positions and applied to the stored footprint origin; the
//   wet cells are then recomputed from that origin. Nothing is inferred from a
//   single plan, so nothing can accumulate an error.
//
//   The rotary and "untouched" cases hold a single 2x2 block, and for those the
//   block's own position is the footprint origin - no tracking needed.
//
// No command and no chat message: the module is controlled by its on/off toggle.

const logger = require('qol-control/core/logger');

const EXTRACTOR = 'water-extractor';
const ROTARY = 'rotary-pump';
const PUMP = 'mechanical-pump';

const BuildPlanClass = Packages.mindustry.entities.units.BuildPlan;

// One entry per converted extractor:
//   origin - {x,y} top-left of the footprint
//   size   - footprint edge length
//   kind   - 'none' | 'rotary' | 'pumps'
//   anchor - the plan carrying the extractor/rotary block, or the first pump
//   extras - additional pump plans
//   prev   - [{x,y}] positions from the previous frame, aligned with the plans
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

function cellOffset(index, size) {
	return {dx: index % size, dy: Math.floor(index / size)};
}

function wetCells(origin, size) {
	let out = [];
	for (let i = 0; i < size * size; i++) {
		let o = cellOffset(i, size);
		let x = origin.x + o.dx;
		let y = origin.y + o.dy;
		if (isLiquidAt(x, y)) out.push({x: x, y: y});
	}
	return out;
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

function allPlans(group) {
	let list = [group.anchor];
	for (let i = 0; i < group.extras.length; i++) list.push(group.extras[i]);
	return list;
}

// cur = R(prev) + t, with R a rotation by k * 90 degrees.
function solveRigid(prev, cur) {
	if (!prev || prev.length !== cur.length || prev.length < 2) return null;
	for (let k = 0; k < 4; k++) {
		let p0 = rot(prev[0], k);
		let tx = cur[0].x - p0.x;
		let ty = cur[0].y - p0.y;
		let ok = true;
		for (let i = 1; i < prev.length; i++) {
			let p = rot(prev[i], k);
			if (p.x + tx !== cur[i].x || p.y + ty !== cur[i].y) {
				ok = false;
				break;
			}
		}
		if (ok) return {k: k, tx: tx, ty: ty};
	}
	return null;
}

function rot(p, k) {
	let x = p.x;
	let y = p.y;
	for (let i = 0; i < k; i++) {
		let nx = -y;
		let ny = x;
		x = nx;
		y = ny;
	}
	return {x: x, y: y};
}

// A group of 1x1 pumps rotates like the cells it is made of, but the footprint
// origin is the top-left OF THE WHOLE 2x2, and rotating a 2x2 square about a point
// does not send its top-left corner to the rotation of that corner. For a
// footprint of even size s the corner correction is:
//
//   k=0 -> (0,0)          k=1 -> (-(s-1), 0)
//   k=2 -> (-(s-1),-(s-1)) k=3 -> (0, -(s-1))
//
// Without it the block lands one tile off after every quarter turn - exactly the
// drift that appeared when rotating a schematic on water.
function cornerCorrection(size, k) {
	if (size % 2 === 0) {
		let d = size - 1;
		if (k === 1) return {x: -d, y: 0};
		if (k === 2) return {x: -d, y: -d};
		if (k === 3) return {x: 0, y: -d};
	}
	return {x: 0, y: 0};
}

// Fold the game's own rotation/drag into the stored origin.
function trackOrigin(group) {
	let list = allPlans(group);
	let cur = [];
	for (let i = 0; i < list.length; i++) cur.push({x: list[i].x, y: list[i].y});

	if (!group.prev || group.prev.length !== cur.length) {
		group.prev = cur;
		return;
	}

	let t = solveRigid(group.prev, cur);
	if (t) {
		let r = rot(group.origin, t.k);
		let d = cornerCorrection(group.size, t.k);
		group.origin = {x: r.x + t.tx + d.x, y: r.y + t.ty + d.y};
	}
	group.prev = cur;
}

function remember(group) {
	let list = allPlans(group);
	let cur = [];
	for (let i = 0; i < list.length; i++) cur.push({x: list[i].x, y: list[i].y});
	group.prev = cur;
}

function dropExtras(group, plans) {
	for (let i = 0; i < group.extras.length; i++) dropPlan(plans, group.extras[i]);
	group.extras = [];
	group.prev = null;
}

function apply(group, plans, rotaryBlock, pumpBlock) {
	let size = group.size;

	// In pump mode every plan is 1x1, so the origin was tracked through the game's
	// rigid transform and is authoritative. A single 2x2 block carries its
	// footprint in its own position instead.
	if (group.kind === 'rotary' || group.kind === 'none') {
		group.origin = {x: group.anchor.x, y: group.anchor.y};
	}

	let wet = wetCells(group.origin, size);

	if (wet.length === 0) {
		if (group.kind !== 'none') dropExtras(group, plans);
		group.anchor.block = group.original;
		// A 2x2 block sits on the footprint corner; the anchor may currently be any
		// cell of the former pump set, so pin it to the origin we tracked. Writing
		// the position is what keeps a rotation from shifting the block by a tile.
		group.anchor.x = group.origin.x;
		group.anchor.y = group.origin.y;
		group.anchor.cachedValid = false;
		group.kind = 'none';
		group.prev = null;
		return;
	}

	if (wet.length === 1) {
		if (group.kind !== 'rotary') {
			dropExtras(group, plans);
			group.anchor.block = rotaryBlock;
			group.anchor.x = group.origin.x;
			group.anchor.y = group.origin.y;
			group.anchor.cachedValid = false;
			group.kind = 'rotary';
			group.prev = null;
		}
		return;
	}

	// Pump mode: the anchor covers the first wet cell, extras cover the rest.
	// Every plan here is 1x1, so the whole group rotates as one rigid body.
	if (group.kind !== 'pumps') {
		group.anchor.block = pumpBlock;
		group.kind = 'pumps';
		group.prev = null;
	}
	group.anchor.cachedValid = false;

	let needed = wet.length - 1;
	while (group.extras.length > needed) {
		dropPlan(plans, group.extras.pop());
		group.prev = null;
	}
	while (group.extras.length < needed) {
		let plan = new BuildPlanClass(0, 0, 0, pumpBlock);
		plans.add(plan);
		group.extras.push(plan);
		group.prev = null;
	}

	for (let i = 0; i < wet.length; i++) {
		let plan = i === 0 ? group.anchor : group.extras[i - 1];
		plan.x = wet[i].x;
		plan.y = wet[i].y;
		plan.cachedValid = false;
	}
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

	let rotaryBlock = Vars.content.block(ROTARY);
	let pumpBlock = Vars.content.block(PUMP);
	if (!rotaryBlock || !pumpBlock) return;

	try {
		let kept = [];
		for (let i = 0; i < groups.length; i++) {
			let group = groups[i];

			// The layout was regenerated; the group no longer belongs to it.
			if (!hasPlan(plans, group.anchor)) {
				dropExtras(group, plans);
				continue;
			}

			// In pump mode the game's rotation is folded into the origin first.
			if (group.kind === 'pumps') trackOrigin(group);

			apply(group, plans, rotaryBlock, pumpBlock);
			remember(group);
			kept.push(group);
		}
		groups = kept;

		// Take over extractors the game would refuse to place.
		let known = {};
		for (let i = 0; i < groups.length; i++) known[groups[i].anchor] = true;

		let current = [];
		for (let i = 0; i < plans.size; i++) current.push(plans.get(i));

		for (let i = 0; i < current.length; i++) {
			let plan = current[i];
			if (!plan || !plan.block || plan.block.name !== EXTRACTOR) continue;
			if (plan.breaking || known[plan]) continue;

			let size = plan.block.size || 2;
			let origin = {x: plan.x, y: plan.y};
			if (wetCells(origin, size).length === 0) continue;

			let group = {
				origin: origin,
				size: size,
				kind: 'none',
				anchor: plan,
				original: plan.block,
				extras: [],
				prev: null,
			};
			apply(group, plans, rotaryBlock, pumpBlock);
			remember(group);
			groups.push(group);
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
