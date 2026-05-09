const notify = require('qol-control/core/logger').notify;
const interceptor = require('qol-control/core/interceptor');

const trace = {
	enabled: false,
	mode: null,
	target: null,
	priority: [
		'vanquish',
		'reign',
		'vela',
		'arkyid',
		'scepter',
		'obviate',
		'precept',
		'avert',
		'quasar',
		'cleroi',
	],
	lastTry: 0,
};

function isFree(u) {
	return (
		u && !u.dead && u.player == null && !(u.controller() instanceof LogicAI)
	);
}

function possess(u) {
	if (!u) return false;
	if (typeof Call.unitControl === 'function')
		Call.unitControl(Vars.player, u);
	else if (typeof Vars.player.setUnit === 'function') Vars.player.setUnit(u);
	Core.camera.position.set(u.x, u.y);
	return true;
}

function findTrace() {
	if (!trace.enabled || Time.millis() < trace.lastTry) return;
	const team = Vars.player.team();
	let unit = null;

	if (trace.mode === 'set' && trace.target) {
		if (Vars.player.unit() && Vars.player.unit().type.name === trace.target)
			return;
		Groups.unit.each((u) => {
			if (
				!unit &&
				u.team == team &&
				u.type.name === trace.target &&
				isFree(u)
			)
				unit = u;
		});
	} else if (trace.mode === 'find') {
		if (Vars.player.unit() && !Vars.player.unit().dead) return;
		let best = Infinity;
		Groups.unit.each((u) => {
			if (u.team != team || !isFree(u)) return;
			let idx = trace.priority.indexOf(u.type.name);
			if (idx !== -1 && idx < best) {
				unit = u;
				best = idx;
			}
		});
	}

	if (unit && possess(unit)) {
		trace.lastTry = Time.millis() + 250;
		notify('[lightgray]Possess [accent]' + unit.type.name);
	}
}

Events.run(Trigger.update, () => {
	if (trace.enabled) findTrace();
});

Events.on(UnitCreateEvent, (e) => {
	if (!trace.enabled || e.unit.team != Vars.player.team() || !isFree(e.unit))
		return;
	if (trace.mode === 'set' && e.unit.type.name === trace.target)
		possess(e.unit);
	else if (
		trace.mode === 'find' &&
		!Vars.player.unit() &&
		trace.priority.includes(e.unit.type.name)
	)
		possess(e.unit);
});

Events.on(WorldLoadEvent, () => {
	trace.enabled = false;
});

const traceHandler = (args) => {
	let sub = args[1] ? args[1].toLowerCase() : '';
	if (sub === 'toggle' || sub === 't') {
		trace.enabled = interceptor.parseToggle(trace.enabled, args[2]);
		notify(
			'[lightgray]Trace ' + (trace.enabled ? '[green]ON' : '[scarlet]OFF')
		);
	} else if ((sub === 'set' && args[2]) || (sub === 's' && args[2])) {
		let found = Vars.content.getByName(ContentType.unit, args[2]);
		if (found) {
			trace.mode = 'set';
			trace.target = args[2].toLowerCase();
			notify(
				'[lightgray]Mode [green]SET [lightgray]([accent]' +
					trace.target +
					'[lightgray])'
			);
		} else notify('[scarlet]Unit ' + args[2] + ' [scarlet]not found');
	} else if (sub === 'find' || sub === 'f') {
		trace.mode = 'find';
		notify('[lightgray]Mode [green]FIND');
	} else if (sub === 'status' || sub === 'st') {
		notify(
			'\n[lightgray]State ' +
				(trace.enabled ? '[green]ON' : '[scarlet]OFF') +
				'\n[lightgray]Mode [accent]' +
				(trace.mode || 'none') +
				'\n[lightgray]Target [accent]' +
				(trace.target || 'none') +
				'\n[lightgray]Priority [accent]' +
				trace.priority.join('[lightgray] > [accent]')
		);
	} else {
		notify(
			'[lightgray]!trace toggle <1/0?>\n!trace set <unit>\n!trace find\n!trace status\n\n!tr t <1/0?>\n!tr s <unit>\n!tr f\n!tr st'
		);
	}
};

interceptor.add('trace', traceHandler);
interceptor.add('tr', traceHandler);
