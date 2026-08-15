const notify = require('qol-control/core/logger').notify;
const interceptor = require('qol-control/core/interceptor');

const assistState = {
	enabled: Core.settings.getBool('qol-assist-enabled', false),
	range: 400,
	units: { poly: true, mega: true, pulsar: true, quasar: false },
	max: { poly: 3, mega: 10, pulsar: 5, quasar: 0 },
};

try {
	let u = Core.settings.getString('qol-assist-units', '');
	if (u) Object.assign(assistState.units, JSON.parse(u));
	let m = Core.settings.getString('qol-assist-max', '');
	if (m) Object.assign(assistState.max, JSON.parse(m));
	let r = Core.settings.getFloat('qol-assist-range', -1);
	if (r > 0) assistState.range = r;
} catch (e) {}

let assistTimer = null;
global.qolAssistingUnits = {};
let assistingUnits = global.qolAssistingUnits;

Events.on(WorldLoadEvent, () => {
	if (assistState.enabled) {
		if (!assistTimer) {
			assistTimer = Timer.schedule(
				() => {
					try {
						runAssist();
					} catch (err) {
						notify('[scarlet]Assist Error: ' + err);
						if (assistTimer) assistTimer.cancel();
						assistTimer = null;
					}
				},
				0,
				0.5
			);
		}
	} else {
		if (assistTimer) assistTimer.cancel();
		assistTimer = null;
	}
});

function releaseSingleUnit(u) {
	try {
		u.clearCommand();
	} catch (e) {}
	try {
		u.resetController();
	} catch (e) {}
}

function releaseAssistUnits() {
	Groups.unit.each((u) => {
		if (assistingUnits[u.id]) {
			releaseSingleUnit(u);
		}
	});
	assistingUnits = {};
}

function runAssist() {
	const player = Vars.player;
	if (!player || !player.team() || !Vars.state.isGame()) {
		releaseAssistUnits();
		return;
	}

	const pUnit = player.unit();
	if (!pUnit || pUnit.dead) {
		releaseAssistUnits();
		return;
	}

	const plans = pUnit.plans;
	let isBuildingNear = false;

	if (plans.size > 0) {
		let bRange = pUnit.type.buildRange + 8;
		for (let i = 0; i < plans.size; i++) {
			let plan = plans.get(i);
			if (pUnit.dst(plan.x * 8, plan.y * 8) <= bRange) {
				isBuildingNear = true;
				break;
			}
		}
	}

	let counts = { poly: 0, mega: 0, pulsar: 0, quasar: 0 };
	let needsCommandUpdate = new IntSeq();
	let px = new java.lang.Float(pUnit.x);
	let py = new java.lang.Float(pUnit.y);

	Groups.unit.each((u) => {
		if (assistingUnits[u.id]) {
			let stolen = u.player != null || u.controller() instanceof LogicAI;
			let type = u.type.name;

			if (u.team === player.team() && !u.dead && !stolen) {
				if (type === 'nova') {
					let cmd = null;
					try {
						cmd = u.command();
					} catch (e) {}
					if (cmd !== UnitCommand.assistCommand)
						needsCommandUpdate.add(u.id);
				} else if (isBuildingNear && assistState.units[type]) {
					counts[type]++;
					let cmd = null;
					try {
						cmd = u.command();
					} catch (e) {}
					if (cmd !== UnitCommand.assistCommand)
						needsCommandUpdate.add(u.id);
				} else {
					delete assistingUnits[u.id];
					releaseSingleUnit(u);
				}
			} else {
				delete assistingUnits[u.id];
				releaseSingleUnit(u);
			}
		}
	});

	Groups.unit.each((u) => {
		if (
			!assistingUnits[u.id] &&
			u.team === player.team() &&
			!u.dead &&
			u.player == null &&
			!(u.controller() instanceof LogicAI)
		) {
			let type = u.type.name;
			if (type === 'nova') {
				assistingUnits[u.id] = true;
				needsCommandUpdate.add(u.id);
			} else if (
				isBuildingNear &&
				u.canBuild() &&
				assistState.units[type] &&
				counts[type] < assistState.max[type]
			) {
				if (u.dst(pUnit) <= assistState.range) {
					counts[type]++;
					assistingUnits[u.id] = true;
					needsCommandUpdate.add(u.id);
				}
			}
		}
	});

	if (needsCommandUpdate.size > 0) {
		try {
			Call.setUnitCommand(
				player,
				needsCommandUpdate.toArray(),
				UnitCommand.assistCommand,
				px,
				py
			);
		} catch (e) {
			try {
				Call.setUnitCommand(
					player,
					needsCommandUpdate.toArray(),
					UnitCommand.assistCommand
				);
			} catch (e2) {}
		}
	}
}

const assistHandler = (args) => {
	let sub = args[1] ? args[1].toLowerCase() : '';

	if (sub === 'save') {
		Core.settings.put(
			'qol-assist-units',
			JSON.stringify(assistState.units)
		);
		Core.settings.put('qol-assist-max', JSON.stringify(assistState.max));
		Core.settings.put(
			'qol-assist-range',
			new java.lang.Float(assistState.range)
		);
		notify('[green]Assist settings saved');
		return;
	}

	if (sub === 'max' || sub === 'm') {
		let type = args[2] ? args[2].toLowerCase() : '';
		let val = parseInt(args[3]);
		if (assistState.max.hasOwnProperty(type) && !isNaN(val) && val >= 0) {
			assistState.max[type] = val;
			notify('[lightgrey]Max ' + type + ' set to [accent]' + val);
		} else {
			notify(
				'[scarlet]Invalid unit type or value\n[lightgrey]!assist max <unit> <val>'
			);
		}
		return;
	}

	if (sub === 'range' || sub === 'r') {
		let val = parseFloat(args[2]);
		if (!isNaN(val) && val > 0) {
			assistState.range = val * 8;
			notify(
				'[lightgrey]Assist range set to [accent]' +
					val +
					'[lightgrey] blocks'
			);
		} else {
			notify('[scarlet]Invalid range\n[lightgrey]!assist range <val>');
		}
		return;
	}

	if (sub === 'status' || sub === 's') {
		let uStr = '';
		for (let k in assistState.units) {
			uStr +=
				(assistState.units[k] ? '[green]' : '[scarlet]') +
				k +
				'[lightgrey](' +
				assistState.max[k] +
				') ';
		}
		notify(
			'\n[lightgrey]Assist ' +
				(assistState.enabled ? '[green]ON' : '[scarlet]OFF') +
				'\n[lightgrey]Range [accent]' +
				assistState.range / 8 +
				' blocks' +
				'\n[lightgrey]Units ' +
				uStr
		);
		return;
	}

	if (assistState.units.hasOwnProperty(sub)) {
		let toggleArg = args[2];
		assistState.units[sub] = interceptor.parseToggle(
			assistState.units[sub],
			toggleArg
		);
		notify(
			'[lightgrey]Assist for ' +
				sub +
				' is now ' +
				(assistState.units[sub] ? '[green]ON' : '[scarlet]OFF')
		);
		Core.settings.put('qol-assist-units', JSON.stringify(assistState.units));
		return;
	}

	if (sub && !interceptor.isBooleanArg(sub)) {
		notify('[lightgray]Usage: !assist <1/0?> or !assist <unit> <1/0?> or !assist max <unit> <val>');
		return;
	}

	// Otherwise, toggle the main assist state!
	assistState.enabled = interceptor.parseToggle(
		assistState.enabled,
		args[1]
	);
	Core.settings.put('qol-assist-enabled', assistState.enabled);

	if (assistState.enabled) {
		if (!assistTimer) {
			assistTimer = Timer.schedule(
				() => {
					try {
						runAssist();
					} catch (err) {
						notify('[scarlet]Assist Error: ' + err);
						if (assistTimer) assistTimer.cancel();
						assistTimer = null;
					}
				},
				0,
				0.5
			);
		}
		notify('[lightgrey]Assist [green]ON');
	} else {
		if (assistTimer) assistTimer.cancel();
		assistTimer = null;
		releaseAssistUnits();
		notify('[lightgrey]Assist [scarlet]OFF');
	}
};

interceptor.add('assist', assistHandler);
interceptor.add('as', assistHandler);
