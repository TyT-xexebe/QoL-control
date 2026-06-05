const notify = require('qol-control/core/logger').notify;
const interceptor = require('qol-control/core/interceptor');

const defaultPriority = [
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
];

const trace = {
	enabled: false,
	mode: null,
	target: null,
	priority: [],
	lastTry: 0,
};

let rawConfig = String(Core.settings.getString('qol-trace-priority', ''));
if (rawConfig) {
	trace.priority = rawConfig
		.split(',')
		.map((s) => s.trim())
		.filter((s) => s);
} else {
	trace.priority = defaultPriority.slice();
	Core.settings.put('qol-trace-priority', trace.priority.join(','));
}

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
		let currentUnit = Vars.player.unit();
		let currentIdx = Infinity;
		if (currentUnit && !currentUnit.dead) {
			currentIdx = trace.priority.indexOf(currentUnit.type.name);
			if (currentIdx === -1) currentIdx = Infinity;
		}

		let best = currentIdx;
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
		notify('[lightgrey]Possess [accent]' + unit.type.name);
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
	else if (trace.mode === 'find') {
		let currentUnit = Vars.player.unit();
		let currentIdx = Infinity;
		if (currentUnit && !currentUnit.dead) {
			currentIdx = trace.priority.indexOf(currentUnit.type.name);
			if (currentIdx === -1) currentIdx = Infinity;
		}
		let newIdx = trace.priority.indexOf(e.unit.type.name);
		if (newIdx !== -1 && newIdx < currentIdx) possess(e.unit);
	}
});

Events.on(WorldLoadEvent, () => {
	trace.enabled = false;
});

const traceHandler = (args) => {
	let sub = args[1] ? args[1].toLowerCase() : '';
	if (sub === 'toggle' || sub === 't') {
		trace.enabled = interceptor.parseToggle(trace.enabled, args[2]);
		notify(
			'[lightgrey]Trace ' + (trace.enabled ? '[green]ON' : '[scarlet]OFF')
		);
	} else if ((sub === 'set' && args[2]) || (sub === 's' && args[2])) {
		let found = Vars.content.getByName(ContentType.unit, args[2]);
		if (found) {
			trace.mode = 'set';
			trace.target = args[2].toLowerCase();
			notify(
				'[lightgrey]Mode [green]SET [lightgrey]([accent]' +
					trace.target +
					'[lightgrey])'
			);
		} else notify('[scarlet]Unit ' + args[2] + ' [scarlet]not found');
	} else if (sub === 'find' || sub === 'f') {
		trace.mode = 'find';
		notify('[lightgrey]Mode [green]FIND');
	} else if (sub === 'fconfig') {
		let newConfig = args.slice(2).join(' ');
		if (newConfig) {
			let list = newConfig
				.split(',')
				.map((s) => s.trim())
				.filter((s) => s);
			let validList = list.filter((s) =>
				Vars.content.getByName(ContentType.unit, s)
			);

			if (validList.length > 0) {
				trace.priority = validList;
				Core.settings.put('qol-trace-priority', validList.join(','));
				if (validList.length !== list.length) {
					notify(
						'[orange]Saved, but some invalid units were skipped.'
					);
				}
				notify(
					'[lightgrey]Priority updated:\n[accent]' +
						trace.priority.join('[lightgrey] > [accent]')
				);
			} else {
				notify(
					'[scarlet]No valid units provided for priority configuration.'
				);
			}
		} else {
			let pd = new BaseDialog('Priority list');
			pd.addCloseButton();
			pd.cont
				.add('Enter units (e.g. zenith, antumbra, eclipse):')
				.left()
				.padBottom(10)
				.row();
			let field = new Packages.arc.scene.ui.TextArea(
				trace.priority.join(', ')
			);
			field.setMaxLength(5000);
			pd.cont.add(field).width(500).height(100).row();
			pd.buttons
				.button('@ok', Icon.ok, () => {
					let newText = field.getText();
					if (newText) {
						let list = String(newText)
							.split(',')
							.map((s) => s.trim())
							.filter((s) => s);
						let validList = list.filter((s) =>
							Vars.content.getByName(ContentType.unit, s)
						);

						if (validList.length > 0) {
							trace.priority = validList;
							Core.settings.put(
								'qol-trace-priority',
								validList.join(',')
							);
							if (validList.length !== list.length) {
								notify(
									'[orange]Saved, but some invalid units were skipped.'
								);
							}
							notify(
								'[lightgrey]Priority updated:\n[accent]' +
									trace.priority.join(
										'[lightgrey] > [accent]'
									)
							);
						} else {
							notify(
								'[scarlet]No valid units provided for priority configuration.'
							);
						}
					}
					pd.hide();
				})
				.size(200, 50)
				.pad(2);
			pd.show();
		}
	} else if (sub === 'status' || sub === 'st') {
		notify(
			'\n[lightgrey]State ' +
				(trace.enabled ? '[green]ON' : '[scarlet]OFF') +
				'\n[lightgrey]Mode [accent]' +
				(trace.mode || 'none') +
				'\n[lightgrey]Target [accent]' +
				(trace.target || 'none') +
				'\n[lightgrey]Priority [accent]' +
				trace.priority.join('[lightgrey] > [accent]')
		);
	} else {
		notify(
			'[lightgray]!trace toggle <1/0?>\n!trace set <unit>\n!trace find\n!trace fconfig [units...]\n!trace status\n\n!tr t <1/0?>\n!tr s <unit>\n!tr f\n!tr st'
		);
	}
};

interceptor.add('trace', traceHandler);
interceptor.add('tr', traceHandler);
