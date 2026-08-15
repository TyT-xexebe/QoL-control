const notify = require('qol-control/core/logger').notify;

const grab = {
	active: Core.settings.getBool('qol-grab-active', false),
	item: null,
	min: Core.settings.getInt('qol-grab-min', 10),
	targets: [],
	index: 0,
	lastGrab: 0,
	lastSearch: 0,
	range: 216,
	effects: Core.settings.getBool('qol-grab-effects', true),
};

try {
	let itemName = Core.settings.getString('qol-grab-item', '');
	if (itemName) {
		grab.item = Vars.content.getByName(ContentType.item, itemName);
	}
} catch (e) {}

function findTargets() {
	grab.targets = [];
	let u = Vars.player.unit();
	if (!u) return;
	Vars.indexer.allBuildings(u.x, u.y, grab.range, (b) => {
		if (b.team === Vars.player.team() && b.items) grab.targets.push(b);
	});
}

Events.on(WorldLoadEvent, () => {
	grab.targets = [];
});

Events.run(Trigger.draw, () => {
	if (
		!grab.active ||
		!grab.item ||
		grab.targets.length === 0 ||
		!grab.effects
	)
		return;

	Draw.color(Pal.accent);
	Draw.alpha(Math.abs(Math.sin(Time.time / 15)));

	for (let b of grab.targets) {
		if (b.isValid() && b.items.get(grab.item) >= grab.min) {
			Drawf.select(b.x, b.y, b.block.size * 4, Pal.accent);
		}
	}
	Draw.reset();
});

Events.run(Trigger.update, () => {
	let u = Vars.player.unit();
	if (!u || !grab.active || !grab.item) return;

	let now = Time.millis();

	if (now > grab.lastSearch) {
		findTargets();
		grab.lastSearch = now + 1000;
	}

	if (grab.targets.length === 0 || now - grab.lastGrab < 250) return;

	let space = u.type.itemCapacity - u.stack.amount;
	if (u.stack.amount > 0 && u.stack.item !== grab.item) space = 0;

	if (space > 0) {
		let checked = 0;
		let r2 = grab.range * grab.range;

		while (checked < grab.targets.length) {
			grab.index = (grab.index + 1) % grab.targets.length;
			let b = grab.targets[grab.index];

			if (b && b.isValid() && b.team === Vars.player.team()) {
				if (u.dst2(b) <= r2) {
					let has = b.items.get(grab.item);
					if (has >= grab.min) {
						Call.requestItem(
							Vars.player,
							b,
							grab.item,
							Math.min(has, space)
						);
						grab.lastGrab = now;
						return;
					}
				}
			} else if (b) {
				grab.targets.splice(grab.index, 1);
				continue;
			}
			checked++;
		}
	}
});

const interceptor = require('qol-control/core/interceptor');

const grabHandler = (args) => {
	let sub = args[1] ? args[1].toLowerCase() : '';

	if (sub === 'effects' || sub === 'e') {
		grab.effects = interceptor.parseToggle(grab.effects, args[2]);
		Core.settings.put('qol-grab-effects', grab.effects);
		return notify(
			'[lightgrey]Effects ' +
				(grab.effects ? '[green]ON' : '[scarlet]OFF')
		);
	}

	if (sub === 'min' && args[2]) {
		let val = parseInt(args[2]);
		if (isNaN(val) || val < 1) return notify('[scarlet]<min> invalid');
		grab.min = val;
		Core.settings.put('qol-grab-min', new java.lang.Integer(grab.min));
		return notify('[lightgrey]Grab <min> [accent]' + val);
	}

	if (sub === 'status' || sub === 's') {
		return notify(
			'[lightgrey]State ' +
				(grab.active ? '[green]ON' : '[scarlet]OFF') +
				'\n[lightgrey]Item ' +
				(grab.item ? '[accent]' + grab.item.name : 'none') +
				'\n[lightgrey]Min [accent]' +
				grab.min +
				'\n[lightgrey]Effects ' +
				(grab.effects ? '[green]ON' : '[scarlet]OFF')
		);
	}

	let found = sub ? Vars.content.getByName(ContentType.item, sub) : null;
	if (found) {
		grab.item = found;
		grab.active = true;
		Core.settings.put('qol-grab-item', found.name);
		Core.settings.put('qol-grab-active', grab.active);
		return notify(
			'[lightgrey]Grab [green]ON [lightgrey]([accent]' +
				found.name +
				'[lightgrey])'
		);
	}

	let toggleArg = args[1];
	if (sub && !interceptor.isBooleanArg(sub)) {
		return notify(
			'[lightgray]Usage: !grab <item> or !grab <1/0?> or !grab min <val> or !grab effects <1/0?>'
		);
	}

	grab.active = interceptor.parseToggle(grab.active, toggleArg);
	Core.settings.put('qol-grab-active', grab.active);
	return notify(
		'[lightgrey]Grab ' + (grab.active ? '[green]ON' : '[scarlet]OFF')
	);
};

interceptor.add('grab', grabHandler);
interceptor.add('gr', grabHandler);
