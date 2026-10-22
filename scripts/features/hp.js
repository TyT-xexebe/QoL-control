// features/hp - floating damage numbers over everything that gets hit.
//
// The game fires two damage events: UnitDamageEvent for units and
// BuildDamageEvent for buildings. Both carry the bullet that did the hit, so
// the amount can be drawn right above the target and float away.
//
// The events fire on the client as well. The client simulates the bullets, so
// it sees every hit even though the server is the one that really applies the
// damage - which is why the numbers show up for the whole map and not only
// around the player.
//
// The amount of a unit hit is measured from its health (health + shield), so
// explosions and other indirect damage show their real value; the damage of
// the bullet is the fallback when there is nothing to compare with. Buildings
// do not change their health on the client, so their numbers come from the
// bullet.
//
// Performance:
//   - a hit only pushes a small record into a list, that is all the script
//     does per hit;
//   - the numbers are drawn in one pass per frame, the text layout and the
//     drawing itself are done by the engine;
//   - the number of records on screen is capped, so a huge spam cannot flood
//     the renderer - the oldest record is dropped instead;
//   - hits on the same target in a short time are merged into one number, so
//     a stream of bullets does not turn into a wall of digits.

const interceptor = require('qol-control/core/interceptor');
const logger = require('qol-control/core/logger');

let state = {
	enabled: true,
	// How many numbers may be on screen at the same time.
	max: 100,
	// How long a number lives (ms).
	lifetime: 1200,
	// Hits on the same target within this window (ms) are merged. 0 = off.
	merge: 350,
	// Damage below this is not shown.
	minDamage: 1,
};

try {
	state.enabled = Core.settings.getBool('qol-hp-enabled', true);
	state.max = Core.settings.getInt('qol-hp-max', 100);
	state.lifetime = Core.settings.getInt('qol-hp-lifetime', 1200);
	state.merge = Core.settings.getInt('qol-hp-merge', 350);
	state.minDamage = Core.settings.getInt('qol-hp-min-damage', 1);
} catch (e) {}

// The numbers that are currently on screen.
let numbers = [];
// The last number of a target, to merge further hits into it.
let byTarget = {};
// The last known health of the units we have seen, to measure the damage.
let hpCache = {};
let lastCleanup = 0;

const DamageClass = Packages.mindustry.entities.Damage;

// The damage a bullet really deals to a unit, exactly like Unit.damage does it:
// armor first (unless the bullet pierces it), then the health multipliers of the
// unit and of the rules.
function unitBulletDamage(unit, bullet) {
	if (!bullet) return 0;
	let type = bullet.type;
	let amount = bullet.damage;
	try {
		if (!type.pierceArmor) {
			let armor = unit.armorOverride >= 0 ? unit.armorOverride : unit.armor;
			if (type.armorMultiplier !== 1) armor *= type.armorMultiplier;
			amount = DamageClass.applyArmor(amount, armor);
		}
	} catch (e) {}
	try {
		let mult = unit.healthMultiplier || 1;
		amount = amount / mult / Vars.state.rules.unitHealth(unit.team);
	} catch (e) {}
	return amount;
}

// The damage a bullet really deals to a building, exactly like Building.collision:
// the building damage of the bullet, the armor of the block, then the block
// health rule of the rules and of the team.
function buildBulletDamage(build, bullet) {
	if (!bullet) return 0;
	let type = bullet.type;
	let amount = 0;
	try {
		amount = type.buildingDamage(bullet);
	} catch (e) {
		amount = bullet.damage;
	}
	try {
		if (!type.pierceArmor) {
			let armor =
				build.block.armor *
				type.armorMultiplier *
				type.blockArmorMultiplier;
			amount = DamageClass.applyArmor(amount, armor);
		}
	} catch (e) {}
	try {
		amount = amount / Vars.state.rules.blockHealth(build.team);
	} catch (e) {}
	return amount;
}

const colorSmall = Color.valueOf('ffffff');
const colorMedium = Color.valueOf('ffd37f');
const colorBig = Color.valueOf('ff5c5c');

function saveSettings() {
	try {
		Core.settings.put('qol-hp-enabled', new java.lang.Boolean(state.enabled));
		Core.settings.put('qol-hp-max', new java.lang.Integer(state.max));
		Core.settings.put('qol-hp-lifetime', new java.lang.Integer(state.lifetime));
		Core.settings.put('qol-hp-merge', new java.lang.Integer(state.merge));
		Core.settings.put('qol-hp-min-damage', new java.lang.Integer(state.minDamage));
		if (typeof Core.settings.forceSave === 'function') {
			Core.settings.forceSave();
		}
	} catch (e) {}
}

function clear() {
	numbers.length = 0;
	byTarget = {};
	hpCache = {};
}

function colorFor(amount) {
	if (amount >= 80) return colorBig;
	if (amount >= 25) return colorMedium;
	return colorSmall;
}

// The real damage of a unit: the difference to the health it had at the last
// hit. Explosions and other indirect damage are only visible this way.
function measureDamage(unit, bullet) {
	let now = Time.millis();
	let current = unit.health + unit.shield;
	let id = unit.id;
	let previous = hpCache[id];
	hpCache[id] = { hp: current, time: now };

	if (previous && now - previous.time < 1000) {
		let diff = previous.hp - current;
		if (diff > 0) return diff;
	}
	// no baseline yet - the health is already reduced, so the bullet's damage
	// has to be converted the way the game would have applied it
	return unitBulletDamage(unit, bullet);
}

function addNumber(x, y, amount, target) {
	let now = Time.millis();

	// Merge into the number that is already there for this target.
	if (state.merge > 0) {
		let other = byTarget[target];
		if (other && now - other.time < state.merge) {
			other.amount += amount;
			other.time = now;
			other.x = x;
			other.y = y;
			return;
		}
	}

	if (numbers.length >= state.max) {
		let dropped = numbers.shift();
		if (dropped && byTarget[dropped.target] === dropped) {
			delete byTarget[dropped.target];
		}
	}

	let number = { x: x, y: y, amount: amount, time: now, target: target };
	numbers.push(number);
	byTarget[target] = number;
}

Events.on(UnitDamageEvent, (e) => {
	if (!state.enabled) return;
	try {
		let unit = e.unit;
		if (!unit || !unit.isValid()) return;
		let amount = measureDamage(unit, e.bullet);
		if (amount < state.minDamage) return;
		addNumber(unit.x, unit.y + unit.hitSize * 0.7 + 4, amount, unit.id);
	} catch (err) {
		logger.err('[hp] ' + err);
	}
});

Events.on(BuildDamageEvent, (e) => {
	if (!state.enabled) return;
	try {
		let build = e.build;
		if (!build || !build.isValid()) return;
		// Buildings do not lose health on the client, so the bullet is the
		// only source of the amount - converted the way the game applies it.
		let amount = buildBulletDamage(build, e.source);
		if (amount < state.minDamage) return;
		let size = build.block ? build.block.size : 1;
		addNumber(build.x, build.y + size * 4, amount, build.id);
	} catch (err) {
		logger.err('[hp] ' + err);
	}
});

Events.on(WorldLoadEvent, () => {
	clear();
});

Events.run(Trigger.draw, () => {
	if (!state.enabled || !numbers.length) return;

	let now = Time.millis();
	let lifetime = Math.max(200, state.lifetime);

	Draw.z(Layer.overlayUI);
	for (let i = numbers.length - 1; i >= 0; i--) {
		let number = numbers[i];
		let age = now - number.time;
		if (age >= lifetime) {
			numbers.splice(i, 1);
			if (byTarget[number.target] === number) delete byTarget[number.target];
			continue;
		}

		let t = age / lifetime;
		// Fade in fast, fade out slow.
		let alpha = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85;
		// The number pops up and settles down to its size.
		let pop = age < 120 ? 1 + 0.45 * (1 - age / 120) : 1;

		Draw.color(colorFor(number.amount), alpha);
		Fonts.outline.draw(
			'-' + Math.round(number.amount),
			number.x,
			number.y + t * 16,
			colorFor(number.amount),
			0.3 * pop,
			true,
			Align.center
		);
	}
	Draw.reset();

	// Forget the health of the units that are not hit anymore.
	if (now - lastCleanup > 2000) {
		lastCleanup = now;
		for (let key in hpCache) {
			if (now - hpCache[key].time > 5000) delete hpCache[key];
		}
	}
});

function showSettingsDialog() {
	let d = new BaseDialog('Damage Numbers');
	d.addCloseButton();

	let root = new Table();
	root.top().left().margin(10);

	let rebuild = () => {
		root.clearChildren();

		root.check('[lightgray]Enabled[]', state.enabled, b => {
			state.enabled = b;
			saveSettings();
			rebuild();
		}).pad(3).left().row();

		let limits = new Table();
		limits.add('[lightgray]Max numbers:[]').padRight(8);
		limits.field(String(state.max), val => {
			let n = parseInt(val);
			if (!isNaN(n) && n > 0) {
				state.max = n;
				saveSettings();
			}
		}).width(90).padRight(16);
		limits.add('[lightgray]Lifetime (ms):[]').padRight(8);
		limits.field(String(state.lifetime), val => {
			let n = parseInt(val);
			if (!isNaN(n) && n >= 200) {
				state.lifetime = n;
				saveSettings();
			}
		}).width(90);
		root.add(limits).pad(3).left().row();

		let limits2 = new Table();
		limits2.add('[lightgray]Merge window (ms):[]').padRight(8);
		limits2.field(String(state.merge), val => {
			let n = parseInt(val);
			if (!isNaN(n) && n >= 0) {
				state.merge = n;
				saveSettings();
			}
		}).width(90).padRight(16);
		limits2.add('[lightgray]Min damage:[]').padRight(8);
		limits2.field(String(state.minDamage), val => {
			let n = parseInt(val);
			if (!isNaN(n) && n >= 0) {
				state.minDamage = n;
				saveSettings();
			}
		}).width(90);
		root.add(limits2).pad(3).left().row();

		root.add(
			'[lightgray]Hits on the same target within the merge window are added up into one number. 0 turns the merging off.[lightgray]'
		)
			.width(440)
			.wrap()
			.left()
			.pad(3)
			.row();
	};

	rebuild();
	let scroll = new ScrollPane(root);
	scroll.setScrollingDisabled(true, false);
	d.cont.add(scroll).width(480).height(260).row();
	d.show();
}

interceptor.add('hp', (args) => {
	if (args[1] && !interceptor.isBooleanArg(args[1])) {
		showSettingsDialog();
		return;
	}
	state.enabled = interceptor.parseToggle(state.enabled, args[1]);
	saveSettings();
	if (!state.enabled) clear();
	logger.notify(
		'[lightgrey]Damage numbers ' +
			(state.enabled ? '[green]ON' : '[scarlet]OFF')
	);
});

require('qol-control/core/settings-ui').register(
	'features/hp',
	'Damage Numbers',
	showSettingsDialog,
	{ menuSafe: true }
);

module.exports = {
	numbers: () => numbers,
	clear: clear,
};
