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
	if (assistState.enabled) startAssistTimer();
	else stopAssistTimer();
});

function startAssistTimer() {
	if (assistTimer) return;
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

function stopAssistTimer() {
	if (assistTimer) assistTimer.cancel();
	assistTimer = null;
}

function saveAssistSettings() {
	Core.settings.put('qol-assist-units', JSON.stringify(assistState.units));
	Core.settings.put('qol-assist-max', JSON.stringify(assistState.max));
	Core.settings.put(
		'qol-assist-range',
		new java.lang.Float(assistState.range)
	);
	if (typeof Core.settings.forceSave === 'function') {
		Core.settings.forceSave();
	}
}

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

function showAssistSettingsDialog() {
	let d = new BaseDialog('Builder Assist Config');
	d.addCloseButton();

	let root = new Table();
	root.top().left().margin(10);

	function createCard(title, titleColor) {
		let card = root.table(Styles.black6).growX().padBottom(8).get();
		card.margin(8);
		card.top().left();
		card.add('[#' + (titleColor || 'ffd37f') + ']' + title + '[]').style(Styles.outlineLabel).fontScale(0.90).left().padBottom(4).row();
		card.image().color(Color.valueOf('3a3a46')).height(1.5).growX().padBottom(6).row();
		return card;
	}

	function render() {
		root.clearChildren();

		// 1. General Assist Core Card
		let c1 = createCard('Assist Core & Range', '50fa7b');

		c1.check('Enable Builder Assist', assistState.enabled, (b) => {
			assistState.enabled = b;
			Core.settings.put('qol-assist-enabled', b);
			if (b) {
				startAssistTimer();
				notify('[lightgrey]Assist [green]ON');
			} else {
				stopAssistTimer();
				releaseAssistUnits();
				notify('[lightgrey]Assist [scarlet]OFF');
			}
		}).pad(3).left().row();

		let curBlocks = Math.round(assistState.range / 8);
		let rangeLabel = c1.add('[lightgray]Assist Range: [accent]' + curBlocks + ' blocks (' + Math.round(assistState.range) + ' px)[]').left().pad(2).get();
		c1.row();
		c1.slider(4, 120, 2, curBlocks, (v) => {
			let val = Math.round(v);
			assistState.range = val * 8;
			rangeLabel.setText('[lightgray]Assist Range: [accent]' + val + ' blocks (' + (val * 8) + ' px)[]');
			saveAssistSettings();
		}).growX().padBottom(6).row();

		root.row();

		// 2. Drone Fleet Card
		let c2 = createCard('Builder Drone Fleet', '8be9fd');

		for (let name in assistState.units) {
			let uName = name;
			let row = c2.table().growX().pad(2).get();
			let uObj = Vars.content ? Vars.content.unit(uName) : null;
			if (uObj && uObj.uiIcon) {
				row.image(uObj.uiIcon).size(24).padRight(6);
			}

			row.check(uName.toUpperCase(), assistState.units[uName], (b) => {
				assistState.units[uName] = b;
				saveAssistSettings();
			}).left().growX().minWidth(120);

			row.add('[lightgray]max: []').padRight(4);

			let maxVal = assistState.max[uName] || 0;
			let maxLabel = row.add(String(maxVal)).color(Pal.accent).width(30).center().get();

			row.button('-', Styles.grayt, () => {
				assistState.max[uName] = Math.max(0, (assistState.max[uName] || 0) - 1);
				maxLabel.setText(String(assistState.max[uName]));
				saveAssistSettings();
			}).size(32, 32).padRight(4);

			row.button('+', Styles.grayt, () => {
				assistState.max[uName] = (assistState.max[uName] || 0) + 1;
				maxLabel.setText(String(assistState.max[uName]));
				saveAssistSettings();
			}).size(32, 32);

			c2.row();
		}

		let fleetActRow = c2.table().left().padTop(6).get();
		fleetActRow.button('Enable All', Styles.grayt, () => {
			for (let u in assistState.units) assistState.units[u] = true;
			saveAssistSettings();
			render();
		}).size(120, 32).padRight(8);
		fleetActRow.button('Disable All', Styles.grayt, () => {
			for (let u in assistState.units) assistState.units[u] = false;
			saveAssistSettings();
			render();
		}).size(120, 32);

		root.row();

		// 3. Information Card
		let c3 = createCard('Behavior Guidelines', 'ffd37f');
		c3.add('[lightgray]• Only builder drones within the configured [accent]Range[] assist your construction.[]').left().padBottom(3).row();
		c3.add('[lightgray]• Units with [accent]max: 0[] or unchecked are never recruited.[]').left().padBottom(3).row();
		c3.add('[lightgray]• Nova units automatically assist whenever available in range.[]').left().padBottom(3).row();

		root.row();

		// 4. Quick Actions & Save Card
		let actCard = root.table(Styles.black6).growX().padBottom(2).get();
		actCard.margin(8);
		let actRow = actCard.table().center().get();

		actRow.button('[#73d216]Save Defaults[]', Icon.save, Styles.grayt, () => {
			saveAssistSettings();
			notify('[green]Assist settings saved');
		}).size(170, 38).padRight(10);

		actRow.button('Close', Icon.cancel, Styles.grayt, () => {
			d.hide();
		}).size(140, 38);
	}

	let pane = new ScrollPane(root);
	pane.setScrollingDisabled(true, false);
	pane.setOverscroll(false, true);

	let dw = Math.min(Core.scene.getWidth() * 0.95, 680);
	let dh = Math.min(Core.scene.getHeight() * 0.85, 520);
	d.cont.add(pane).width(dw).height(dh);

	render();
	d.show();
}

const assistHandler = (args) => {
	let sub = args[1] ? args[1].toLowerCase() : '';

	if (sub === 'save') {
		saveAssistSettings();
		notify('[green]Assist settings saved');
		return;
	}

	if (sub === 'ui' || sub === 'settings') {
		showAssistSettingsDialog();
		return;
	}

	if (sub === 'max' || sub === 'm') {
		let type = args[2] ? args[2].toLowerCase() : '';
		let val = parseInt(args[3]);
		if (assistState.max.hasOwnProperty(type) && !isNaN(val) && val >= 0) {
			assistState.max[type] = val;
			saveAssistSettings();
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
			saveAssistSettings();
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
				uStr +
				'\n[lightgrey]Tip: [accent]!assist ui[lightgrey] for the full settings window'
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
		notify('[lightgray]Usage: !assist ui | !assist <1/0?> | !assist <unit> <1/0?> | !assist max <unit> <val> | !assist range <blocks>');
		return;
	}

	// Otherwise, toggle the main assist state!
	assistState.enabled = interceptor.parseToggle(
		assistState.enabled,
		args[1]
	);
	Core.settings.put('qol-assist-enabled', assistState.enabled);

	if (assistState.enabled) {
		startAssistTimer();
		notify('[lightgrey]Assist [green]ON');
	} else {
		stopAssistTimer();
		releaseAssistUnits();
		notify('[lightgrey]Assist [scarlet]OFF');
	}
};

interceptor.add('assist', assistHandler);
interceptor.add('as', assistHandler);

// Expose this module's config dialog to the mod settings screen (gear button).
require('qol-control/core/settings-ui').register(
	'features/assist',
	'Assist',
	showAssistSettingsDialog,
	{ menuSafe: true }
);
