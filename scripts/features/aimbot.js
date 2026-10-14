const uiUtils = require('qol-control/ui/utils');
const notify = require('qol-control/core/logger').notify;
const interceptor = require('qol-control/core/interceptor');

let active = Core.settings.getBool('qol-aim-active', false);
let showUI = Core.settings.getBool('qol-aim-showui', false);
let ignoredTargets = Core.settings.getString(
	'qol-aim-ignored',
	'world-processor,world-cell,world-message,missile,quell-missile,disrupt-missile'
);

let ignoredMap = {};
function updateIgnored() {
	ignoredMap = {};
	if (ignoredTargets) {
		ignoredTargets.split(',').forEach(function (s) {
			let trim = s.trim();
			if (trim) ignoredMap[trim] = true;
		});
	}
}
updateIgnored();

let presets = [];
try {
	let raw = Core.settings.getString('qol-aim-presets', '[]');
	presets = JSON.parse(raw);
} catch (e) {
	presets = [];
}

if (!presets || !presets.length) {
	presets = [
		{
			name: 'Default',
			units: ['all'],
			attackEnemyUnits: true,
			attackEnemyBlocks: true,
			healFriendlyBlocks: false,
			priorities: ['units', 'blocks', 'heal'],
			predictFire: true,
			predictTiles: 20,
			constantFire: false,
			targetPriority: 'Nearest',
			disableShootingOnReload: false,
			targetTypeFilter: 'Default',
		},
	];
}

function save() {
	Core.settings.put('qol-aim-active', new java.lang.Boolean(active));
	Core.settings.put('qol-aim-showui', new java.lang.Boolean(showUI));
	Core.settings.put('qol-aim-presets', JSON.stringify(presets));
	if (typeof predictLineMode !== 'undefined') {
		Core.settings.put(
			'qol-predict-line-mode',
			new java.lang.Integer(predictLineMode)
		);
	}
	Core.settings.put('qol-aim-ignored', ignoredTargets);
}

let uiTable = null;
let dragHandler = null;

let tableX = Core.settings.getFloat('qol-aim-x', Core.graphics.getWidth() / 2);
let tableY = Core.settings.getFloat('qol-aim-y', Core.graphics.getHeight() / 2);

let setup = false;
let innerTable = null;

function initUI() {
	if (setup || !Vars.ui || !Vars.ui.hudGroup) return;
	setup = true;

	uiTable = new Table(Styles.black5);
	uiTable.margin(4);

	dragHandler = uiUtils.setupDrag(
		'qol-aim-x',
		'qol-aim-y',
		tableX,
		tableY,
		function (x, y) {
			tableX = Mathf.clamp(
				x,
				0,
				Core.graphics.getWidth() - uiTable.getWidth() - 2
			);
			tableY = Mathf.clamp(
				y,
				0,
				Core.graphics.getHeight() - uiTable.getHeight() - 2
			);
			uiTable.setPosition(tableX, tableY);
		}
	);
	dragHandler.attach(uiTable);

	innerTable = new Table();
	uiTable.add(innerTable);
	Vars.ui.hudGroup.addChild(uiTable);
	rebuildUI();
}

if (Vars.ui && Vars.ui.hudGroup) initUI();
else Events.on(ClientLoadEvent, initUI);

Events.on(WorldLoadEvent, function () {
	setup = false;
	initUI();
});

function rebuildUI() {
	if (!innerTable) return;
	innerTable.clear();

	innerTable
		.button(
			active ? Icon.pause : Icon.play,
			Styles.clearNonei,
			40,
			function () {
				if (dragHandler && dragHandler.state.isDragging) return;
				active = !active;
				save();
				rebuildUI();
			}
		)
		.size(40);

	innerTable
		.button(Icon.settings, Styles.clearNonei, 40, function () {
			if (dragHandler && dragHandler.state.isDragging) return;
			openSettings();
		})
		.size(40);

	uiTable.pack();
}

var prioritiesArr = [
	'Nearest',
	'Farthest',
	'Min Current HP',
	'Max Current HP',
	'Min Max HP',
	'Max Max HP',
];
var targetFilters = [
	'Default',
	'Ground / Air',
	'Air / Ground',
	'Ground Only',
	'Air Only',
];

function openSettings() {
	let dialog = new BaseDialog('Aimbot Config & Presets');
	dialog.addCloseButton();

	let build = function () {
		dialog.cont.clear();

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

		// 1. Global Settings Card
		let c1 = createCard('Global Targeting & Prediction', '50fa7b');

		let modeNames = ['[red]Off', '[green]Unit Center', '[cyan]Each Gun'];
		let modeRow = c1.table().growX().pad(2).get();
		modeRow.add('[lightgray]Prediction Style: []').left().padRight(8);
		let modeBtn = modeRow.button(modeNames[predictLineMode], Styles.grayt, function () {
			predictLineMode = (predictLineMode + 1) % 3;
			save();
			modeBtn.setText(modeNames[predictLineMode]);
		}).size(180, 36).get();
		c1.row();

		let ignoreRow = c1.table().growX().pad(2).get();
		ignoreRow.add('[lightgray]Ignored (CSV): []').left().padRight(8);
		let ignoreField = new TextField(ignoredTargets);
		ignoreField.changed(function () {
			ignoredTargets = ignoreField.getText();
			updateIgnored();
			save();
		});
		ignoreRow.add(ignoreField).growX().height(36).get();
		c1.row();

		root.row();

		// 2. Presets Card
		let c2 = createCard('Unit Presets (' + presets.length + ')', 'ffd37f');

		let addRow = c2.table().growX().padBottom(6).get();
		addRow.button('[#73d216]Add New Preset[]', Icon.add, Styles.grayt, function () {
			presets.push({
				name: 'New Preset',
				units: [],
				attackEnemyUnits: true,
				attackEnemyBlocks: true,
				healFriendlyBlocks: false,
				priorities: ['heal', 'units', 'blocks'],
				predictFire: true,
				predictTiles: 20,
				constantFire: false,
				targetPriority: 'Nearest',
				disableShootingOnReload: false,
				targetTypeFilter: 'Default',
			});
			save();
			openPreset(
				presets[presets.length - 1],
				presets.length - 1,
				dialog,
				build
			);
		}).size(220, 38).left();
		c2.row();

		if (presets.length === 0) {
			c2.add('[lightgray]No presets created yet.[]').pad(6).left().row();
		} else {
			presets.forEach(function (p, i) {
				let tr = c2.table().growX().pad(2).get();
				tr.add('[white]' + p.name).left().growX().padLeft(4).minWidth(0).get().setEllipsis(true);
				tr.button(Icon.edit, Styles.cleari, function () {
					openPreset(p, i, dialog, build);
				}).size(40, 40).padRight(4);
				tr.button(Icon.cancel, Styles.cleari, function () {
					presets.splice(i, 1);
					save();
					build();
				}).size(40, 40);
				c2.row();
			});
		}

		root.row();

		let pane = new ScrollPane(root);
		pane.setScrollingDisabled(true, false);
		pane.setOverscroll(false, true);

		let dw = Math.min(Core.scene.getWidth() * 0.95, 680);
		let dh = Math.min(Core.scene.getHeight() * 0.85, 500);
		dialog.cont.add(pane).width(dw).height(dh);
	};

	build();
	dialog.show();
}

function openPreset(pre, id, parentDialog, parentRebuild) {
	let pd = new BaseDialog('Edit Aimbot Preset');
	pd.addCloseButton();

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

		// 1. Identity Card
		let c1 = createCard('Preset Identity', '50fa7b');

		let nameRow = c1.table().growX().pad(2).get();
		nameRow.add('[lightgray]Preset Name: []').left().padRight(8);
		let nameField = nameRow.field(pre.name, function (t) {
			pre.name = t;
			save();
		}).height(36).growX().get();
		c1.row();

		let unitsRow = c1.table().growX().pad(2).get();
		unitsRow.add('[lightgray]Assigned Units (CSV): []').left().padRight(8);
		let unitsField = unitsRow.field(pre.units.join(','), function (t) {
			pre.units = t.split(',').map(function (s) { return s.trim(); }).filter(function (s) { return s.length > 0; });
			save();
		}).height(36).growX().get();
		c1.row();
		c1.add('[gray]Leave blank for default/all units, or specify unit IDs (e.g. flare, zenith)[]').fontScale(0.85).left().padTop(2).row();

		root.row();

		// 2. Targets Card
		let c2 = createCard('Target Types', 'ff79c6');
		c2.check('Attack Enemy Units', pre.attackEnemyUnits, function (b) {
			pre.attackEnemyUnits = b;
			save();
		}).left().pad(3).row();

		c2.check('Attack Enemy Blocks / Buildings', pre.attackEnemyBlocks, function (b) {
			pre.attackEnemyBlocks = b;
			save();
		}).left().pad(3).row();

		c2.check('Heal Friendly Damaged Blocks', pre.healFriendlyBlocks, function (b) {
			pre.healFriendlyBlocks = b;
			save();
		}).left().pad(3).row();

		root.row();

		// 3. Ballistics Card
		let c3 = createCard('Ballistics & Firing', '8be9fd');

		c3.check('Predictive Aim (Lead Target)', pre.predictFire, function (b) {
			pre.predictFire = b;
			save();
		}).left().pad(3).row();

		let predTiles = pre.predictTiles || 20;
		let predLbl = c3.add('[lightgray]Predict Distance: [accent]' + predTiles + ' tiles[]').left().pad(2).get();
		c3.row();
		c3.slider(5, 50, 1, predTiles, function (v) {
			pre.predictTiles = Math.round(v);
			predLbl.setText('[lightgray]Predict Distance: [accent]' + pre.predictTiles + ' tiles[]');
			save();
		}).growX().padBottom(6).row();

		c3.check('Constant Fire (Hold Trigger Continuously)', pre.constantFire, function (b) {
			pre.constantFire = b;
			if (b) pre.disableShootingOnReload = false;
			save();
			render();
		}).left().pad(3).row();

		c3.check('Disable Shooting While Reloading', pre.disableShootingOnReload !== undefined ? pre.disableShootingOnReload : false, function (b) {
			pre.disableShootingOnReload = b;
			if (b) pre.constantFire = false;
			save();
			render();
		}).left().pad(3).row();

		root.row();

		// 4. Priorities & Filters Card
		let c4 = createCard('Priorities & Filters', 'ffd37f');

		let priRow = c4.table().growX().pad(2).get();
		priRow.add('[lightgray]Target Priority: []').left().padRight(8);
		let priorityBtn = priRow.button(pre.targetPriority, Styles.grayt, function () {
			let nextIdx = (prioritiesArr.indexOf(pre.targetPriority) + 1) % prioritiesArr.length;
			pre.targetPriority = prioritiesArr[nextIdx];
			save();
			priorityBtn.setText(pre.targetPriority);
		}).size(180, 36).get();
		c4.row();

		let orderRow = c4.table().growX().pad(2).get();
		orderRow.add('[lightgray]Target Order: []').left().padRight(8);
		let orderBtn = orderRow.button(pre.priorities.join(' > '), Styles.grayt, function () {
			let p0 = pre.priorities[0];
			pre.priorities[0] = pre.priorities[1];
			pre.priorities[1] = pre.priorities[2];
			pre.priorities[2] = p0;
			save();
			orderBtn.setText(pre.priorities.join(' > '));
		}).size(220, 36).get();
		c4.row();

		let filterRow = c4.table().growX().pad(2).get();
		filterRow.add('[lightgray]Target Filter: []').left().padRight(8);
		let typeFilterBtn = filterRow.button(pre.targetTypeFilter || 'Default', Styles.grayt, function () {
			let idx = targetFilters.indexOf(pre.targetTypeFilter || 'Default');
			let nextIdx = (idx + 1) % targetFilters.length;
			pre.targetTypeFilter = targetFilters[nextIdx];
			save();
			typeFilterBtn.setText(pre.targetTypeFilter);
		}).size(180, 36).get();
		c4.row();

		root.row();

		// 5. Done Action Card
		let actCard = root.table(Styles.black6).growX().padBottom(2).get();
		actCard.margin(8);
		let actRow = actCard.table().center().get();
		actRow.button('[#73d216]Done & Save[]', Icon.ok, Styles.grayt, function () {
			pd.hide();
			parentRebuild();
		}).size(180, 38);
	}

	let pane = new ScrollPane(root);
	pane.setScrollingDisabled(true, false);
	pane.setOverscroll(false, true);

	let dw = Math.min(Core.scene.getWidth() * 0.95, 680);
	let dh = Math.min(Core.scene.getHeight() * 0.85, 520);
	pd.cont.add(pane).width(dw).height(dh);

	render();
	pd.show();
}

let updateCounter = 0;
let currentTarget = null;
let currentTargetType = null;
let aimX = 0;
let aimY = 0;
let aimAngle = 0;
let hasAimbotTarget = false;
let touchTimer = 0;
let touchStartX = 0;
let touchStartY = 0;
let isDraggingTouch = false;
let manualPriorityTarget = null;
let predictLineMode = Core.settings.getInt('qol-predict-line-mode', 1);

var targetVelCache = {};
var prevVelCache = {};
var targetAccelCache = {};

let lastUnitType = null;
let cachedPreset = null;
function getCurrentPreset(u) {
	if (!u) return null;
	let typeName = String(u.type.name);
	if (typeName === lastUnitType && cachedPreset) return cachedPreset;
	let p = presets.find(function (pr) {
		return pr.units.includes(typeName);
	});
	if (!p)
		p = presets.find(function (pr) {
			return pr.units.includes('all');
		});
	lastUnitType = typeName;
	cachedPreset = p;
	return p;
}

function getPing() {
	try {
		let con = Vars.net.getConnection();
		if (con) return con.ping;
	} catch (e) {}
	return 0;
}

function manualIntercept(sx, sy, tx, ty, tvx, tvy, speed) {
	var dx = tx - sx;
	var dy = ty - sy;
	var a = tvx * tvx + tvy * tvy - speed * speed;
	var b = 2.0 * (dx * tvx + dy * tvy);
	var c = dx * dx + dy * dy;

	if (Math.abs(a) < 0.001) {
		if (Math.abs(b) < 0.001) return { x: tx, y: ty };
		var t0 = -c / b;
		return t0 >= 0
			? { x: tx + tvx * t0, y: ty + tvy * t0 }
			: { x: tx, y: ty };
	}

	var disc = b * b - 4.0 * a * c;
	if (disc < 0) return { x: tx, y: ty };

	var sq = Math.sqrt(disc);
	var t1 = (-b - sq) / (2.0 * a);
	var t2 = (-b + sq) / (2.0 * a);
	var t;
	if (t1 >= 0 && (t2 < 0 || t1 <= t2)) t = t1;
	else if (t2 >= 0) t = t2;
	else return { x: tx, y: ty };

	return { x: tx + tvx * t, y: ty + tvy * t };
}

function canUnitFire(u, p) {
	if (!p || !p.disableShootingOnReload) return true;
	if (!u || !u.mounts || u.mounts.length === 0) return true;
	try {
		let hasReadyWeapon = false;
		let hasCombatWeapon = false;
		for (let i = 0; i < u.mounts.length; i++) {
			let mount = u.mounts[i];
			if (!mount || !mount.weapon) continue;
			if (mount.weapon.bullet && mount.weapon.reload > 0.1) {
				hasCombatWeapon = true;
				if (mount.reload <= 0.1) {
					hasReadyWeapon = true;
					break;
				}
			}
		}
		if (hasCombatWeapon && !hasReadyWeapon) return false;
	} catch (e) {}
	return true;
}

function isPlayerBreakingOrPlacing() {
	if (!Vars.control || !Vars.control.input) return false;
	let input = Vars.control.input;
	try {
		if (
			input.isPlacing &&
			typeof input.isPlacing === 'function' &&
			input.isPlacing()
		)
			return true;
	} catch (e) {}
	if (input.block !== undefined && input.block !== null) return true;
	try {
		if (
			input.isBreaking &&
			typeof input.isBreaking === 'function' &&
			input.isBreaking()
		)
			return true;
	} catch (e) {}
	try {
		if (input.breaking === true) return true;
	} catch (e) {}
	try {
		if (typeof Binding !== 'undefined' && Binding.values) {
			let vals = Binding.values();
			for (let i = 0; i < vals.length; i++) {
				let name = String(vals[i].name());
				if (
					name.indexOf('break') !== -1 ||
					name.indexOf('dismantle') !== -1 ||
					name.indexOf('deconstruct') !== -1 ||
					name.indexOf('clear') !== -1
				) {
					if (Core.input.keyDown(vals[i])) return true;
				}
			}
		}
	} catch (e) {}
	try {
		if (Core.input.keyDown(Packages.arc.input.KeyCode.mouseRight))
			return true;
	} catch (e) {}
	return false;
}

Events.on(ClientLoadEvent, function () {
	if (showUI) rebuildUI();
});

Events.run(Trigger.update, function () {
	if (uiTable) {
		uiTable.visible =
			showUI && Vars.state.isGame() && Vars.ui.hudfrag.shown;
		if (uiTable.visible) {
			tableX = Mathf.clamp(
				tableX,
				0,
				Core.graphics.getWidth() - uiTable.getWidth() - 2
			);
			tableY = Mathf.clamp(
				tableY,
				0,
				Core.graphics.getHeight() - uiTable.getHeight() - 2
			);
			uiTable.setPosition(tableX, tableY);
		}
	}

	if (!Vars.state.isGame() || !active) {
		hasAimbotTarget = false;
		return;
	}

	try {
		if (
			Vars.control &&
			Vars.control.input &&
			Vars.control.input.target !== undefined &&
			Vars.control.input.target !== null
		) {
			Vars.control.input.target = null;
		}
	} catch (e) {}

	if (isPlayerBreakingOrPlacing()) {
		hasAimbotTarget = false;
		currentTarget = null;
		return;
	}

	let u = Vars.player.unit();
	if (!u || u.dead) {
		hasAimbotTarget = false;
		currentTarget = null;
		return;
	}

	let p = getCurrentPreset(u);
	if (!p) {
		hasAimbotTarget = false;
		currentTarget = null;
		aimAngle = u.rotation;
		return;
	}
	aimAngle = u.rotation;

	if (Core.input.isTouched() && !isPlayerBreakingOrPlacing()) {
		touchTimer++;
		if (touchTimer === 1) {
			touchStartX = Core.input.mouseX();
			touchStartY = Core.input.mouseY();
			isDraggingTouch = false;
		} else if (touchTimer > 1) {
			let dragDist = Mathf.dst(
				touchStartX,
				touchStartY,
				Core.input.mouseX(),
				Core.input.mouseY()
			);
			if (dragDist > 25) isDraggingTouch = true;
		}
		if (touchTimer === 5) {
			if (!isDraggingTouch) {
				let cursorX = Core.input.mouseWorldX();
				let cursorY = Core.input.mouseWorldY();
				let hit = findTargetUnderCursor(cursorX, cursorY);
				if (hit) {
					manualPriorityTarget = hit.target;
					currentTargetType = hit.type;
				} else {
					if (manualPriorityTarget !== null) {
						manualPriorityTarget = null;
					}
				}
			}
		}
	} else {
		touchTimer = 0;
		isDraggingTouch = false;
	}

	let target = null;
	if (manualPriorityTarget) {
		let isValid = true;
		if (
			!manualPriorityTarget.isValid() ||
			(manualPriorityTarget.dead !== undefined &&
				manualPriorityTarget.dead)
		) {
			isValid = false;
		} else {
			let dist = Mathf.dst(
				u.x,
				u.y,
				manualPriorityTarget.x,
				manualPriorityTarget.y
			);
			let range = u.hasWeapons() ? u.type.maxRange : 300;
			let searchRange = range + (p.predictTiles || 20) * 8;
			if (dist > searchRange) isValid = false;
		}
		if (isValid && currentTargetType === 'heal') {
			if (
				!manualPriorityTarget.damaged() ||
				manualPriorityTarget.health >= manualPriorityTarget.maxHealth
			)
				isValid = false;
		}
		if (isValid) target = manualPriorityTarget;
		else manualPriorityTarget = null;
	}

	if (!target) target = findTarget(u, p);
	currentTarget = target;

	updateCounter++;

	if (updateCounter % 600 === 0) {
		var activeTid = currentTarget ? String(currentTarget.id) : null;
		var nv = {},
			na = {},
			npv = {};
		if (activeTid) {
			if (targetVelCache[activeTid])
				nv[activeTid] = targetVelCache[activeTid];
			if (targetAccelCache[activeTid])
				na[activeTid] = targetAccelCache[activeTid];
			if (prevVelCache[activeTid])
				npv[activeTid] = prevVelCache[activeTid];
		}
		targetVelCache = nv;
		targetAccelCache = na;
		prevVelCache = npv;
	}

	if (currentTarget) {
		var _tid = String(currentTarget.id);
		var _cvx = 0,
			_cvy = 0;

		if (currentTarget.vel) {
			_cvx = currentTarget.vel.x;
			_cvy = currentTarget.vel.y;
		} else {
			var _pp = prevVelCache[_tid] ? prevVelCache[_tid]._pos : null;
			if (_pp) {
				var _pvc = targetVelCache[_tid] || { vx: 0, vy: 0 };
				_cvx = 0.6 * (currentTarget.x - _pp.x) + 0.4 * _pvc.vx;
				_cvy = 0.6 * (currentTarget.y - _pp.y) + 0.4 * _pvc.vy;
			}

			if (!prevVelCache[_tid]) prevVelCache[_tid] = {};
			prevVelCache[_tid]._pos = {
				x: currentTarget.x,
				y: currentTarget.y,
			};
		}

		var _pvc2 =
			prevVelCache[_tid] && prevVelCache[_tid].vx !== undefined
				? prevVelCache[_tid]
				: null;
		var _pa = targetAccelCache[_tid] || { ax: 0, ay: 0 };
		if (_pvc2) {
			var _rawAx = _cvx - _pvc2.vx;
			var _rawAy = _cvy - _pvc2.vy;

			var _raMag = Math.sqrt(_rawAx * _rawAx + _rawAy * _rawAy);
			var _raMax = 0.5;
			if (_raMag > _raMax) {
				_rawAx *= _raMax / _raMag;
				_rawAy *= _raMax / _raMag;
			}
			targetAccelCache[_tid] = {
				ax: 0.12 * _rawAx + 0.88 * _pa.ax,
				ay: 0.12 * _rawAy + 0.88 * _pa.ay,
			};
		} else {
			targetAccelCache[_tid] = _pa;
		}

		if (!prevVelCache[_tid]) prevVelCache[_tid] = {};
		prevVelCache[_tid].vx = _cvx;
		prevVelCache[_tid].vy = _cvy;
		targetVelCache[_tid] = { vx: _cvx, vy: _cvy };
	}

	if (target) {
		let shootX = target.x;
		let shootY = target.y;

		let weapon = null;
		let mounts = u.mounts;

		if (mounts && mounts.length > 0) {
			// Pick the best offensive weapon, ignoring:
			//  - repair/heal beams (Cyerce, Vela, Retusa repair turrets)
			//  - point-defense / interceptor weapons (Cleroi segments)
			//  - any weapon whose bullet cannot hit enemies
			function isUtilityWeapon(w) {
				if (!w || !w.bullet) return true;
				let b = w.bullet;
				let bClass = String(b.getClass().getSimpleName());
				// Explicit class name check
				if (bClass.indexOf('RepairBeam') !== -1) return true;
				if (bClass.indexOf('HealBullet') !== -1) return true;
				if (bClass.indexOf('PointDefense') !== -1) return true;
				if (bClass.indexOf('Interceptor') !== -1) return true;
				// Weapon name check — catches "segment", "repair", "mend" etc.
				let wName = String(w.name || '').toLowerCase();
				if (wName.indexOf('repair') !== -1) return true;
				if (wName.indexOf('heal') !== -1) return true;
				if (wName.indexOf('mend') !== -1) return true;
				if (wName.indexOf('segment') !== -1) return true;
				if (wName.indexOf('point') !== -1 && wName.indexOf('defense') !== -1) return true;
				// Bullet cannot hit any enemy — pure utility/interceptor
				try {
					let hitsAir    = b.collidesAir    !== undefined ? b.collidesAir    : true;
					let hitsGround = b.collidesGround !== undefined ? b.collidesGround : true;
					let hitsTeam   = b.collidesTeam   !== undefined ? b.collidesTeam   : false;
					// If it hits neither air nor ground enemies, skip it
					if (!hitsAir && !hitsGround) return true;
					// If it only hits own team (heal/repair), skip it
					if (hitsTeam && b.damage !== undefined && b.damage <= 0) return true;
				} catch(e) {}
				// Speed = 0 with no lifetime usually means beam/repair
				try {
					if (b.speed <= 0 && (b.lifetime === undefined || b.lifetime <= 0)) return true;
				} catch(e) {}
				return false;
			}

			// Score a weapon: prefer higher DPS (damage * speed proxy), then splash
			function weaponScore(w) {
				let b = w.bullet;
				let dmg = b.damage !== undefined ? b.damage : 0;
				let splash = b.splashDamage !== undefined ? b.splashDamage * 0.5 : 0;
				let spd = b.speed !== undefined && b.speed > 0 ? b.speed : 999;
				// Faster bullet = better prediction accuracy, slight tie-break bonus
				return dmg + splash + spd * 0.001;
			}

			let bestScore = -1;
			let fallbackWeapon = null;
			for (let i = 0; i < mounts.length; i++) {
				let m = mounts[i];
				if (!m || !m.weapon || !m.weapon.bullet) continue;
				let w = m.weapon;
				if (isUtilityWeapon(w)) continue;
				if (fallbackWeapon === null) fallbackWeapon = w;
				let score = weaponScore(w);
				if (score > bestScore) {
					bestScore = score;
					weapon = w;
				}
			}

			if (!weapon) weapon = fallbackWeapon;
			if (!weapon && mounts[0]) weapon = mounts[0].weapon;
		}

		if (!weapon && u.type.weapons && u.type.weapons.size > 0) {
			weapon = u.type.weapons.first();
		}

		let isInstant = false;
		if (weapon && weapon.bullet) {
			let className = String(weapon.bullet.getClass().getSimpleName());
			if (
				(className.indexOf('Laser') !== -1 &&
					className.indexOf('LaserBolt') === -1) ||
				className.indexOf('Rail') !== -1 ||
				className.indexOf('Lightning') !== -1 ||
				className.indexOf('Shrapnel') !== -1
			) {
				isInstant = true;
			}
		}

		if (p.predictFire) {
			try {
				var _tid2 = String(currentTarget.id);
				var _cv = targetVelCache[_tid2] || { vx: 0, vy: 0 };
				var _tvx = _cv.vx;
				var _tvy = _cv.vy;

				var _accel = targetAccelCache[_tid2] || { ax: 0, ay: 0 };
				var _tax = _accel.ax;
				var _tay = _accel.ay;

				var _aMag = Math.sqrt(_tax * _tax + _tay * _tay);
				var _aMax = 0.25;
				if (_aMag > _aMax) {
					_tax *= _aMax / _aMag;
					_tay *= _aMax / _aMag;
				}

				var _ping = getPing();

				var _oneWayTicks = _ping * 0.06;

				if (
					isInstant ||
					!weapon ||
					!weapon.bullet ||
					weapon.bullet.speed <= 0.1
				) {
					var _extraCharge = 0;
					if (weapon && weapon.chargeTime > 0 && mounts) {
						for (let i = 0; i < mounts.length; i++) {
							let m = mounts[i];
							if (m && m.weapon === weapon) {
								var _chargePct =
									m.charge !== undefined && m.charge !== null
										? m.charge
										: 0;
								if (
									Vars.player.shooting &&
									_chargePct > 0.01 &&
									_chargePct < 0.99
								) {
									_extraCharge =
										(1.0 - _chargePct) * weapon.chargeTime;
								}
								break;
							}
						}
					}
					var _dt = _oneWayTicks + _extraCharge;
					shootX =
						currentTarget.x + _tvx * _dt + 0.5 * _tax * _dt * _dt;
					shootY =
						currentTarget.y + _tvy * _dt + 0.5 * _tay * _dt * _dt;
				} else {
					var _bspeed = weapon.bullet.speed;
					var _keepVel =
						weapon.bullet.keepVelocity !== undefined
							? weapon.bullet.keepVelocity
							: true;
					var _velInherit =
						weapon.bullet.velInherit !== undefined
							? weapon.bullet.velInherit
							: 1.0;
					var _vInherit = _keepVel ? _velInherit : 0.0;

					var _uvx = u.vel ? u.vel.x : 0;
					var _uvy = u.vel ? u.vel.y : 0;

					var _ddx = _tvx - _uvx * _vInherit;
					var _ddy = _tvy - _uvy * _vInherit;

					var _targetX =
						currentTarget.x +
						_tvx * _oneWayTicks +
						0.5 * _tax * _oneWayTicks * _oneWayTicks;
					var _targetY =
						currentTarget.y +
						_tvy * _oneWayTicks +
						0.5 * _tay * _oneWayTicks * _oneWayTicks;

					var _pred1 = manualIntercept(
						u.x,
						u.y,
						_targetX,
						_targetY,
						_ddx,
						_ddy,
						_bspeed
					);

					var _fdx = _pred1.x - u.x;
					var _fdy = _pred1.y - u.y;
					var _tFlight =
						Math.sqrt(_fdx * _fdx + _fdy * _fdy) / _bspeed;

					var _targetX2 = _targetX + 0.5 * _tax * _tFlight * _tFlight;
					var _targetY2 = _targetY + 0.5 * _tay * _tFlight * _tFlight;
					var _pred2 = manualIntercept(
						u.x,
						u.y,
						_targetX2,
						_targetY2,
						_ddx,
						_ddy,
						_bspeed
					);

					shootX = _pred2.x;
					shootY = _pred2.y;
				}
			} catch (err) {
				shootX = target.x;
				shootY = target.y;
			}
		}

		aimX = shootX;
		aimY = shootY;
		hasAimbotTarget = true;

		Vars.player.mouseX = shootX;
		Vars.player.mouseY = shootY;
		let fire = canUnitFire(u, p);
		Vars.player.shooting = fire;
		u.aim(shootX, shootY);
		u.isShooting = fire;
		u.controlWeapons(true, fire);

		let targetAngle = u.angleTo(shootX, shootY);
		let spd = u.speedMultiplier;
		if (typeof spd === 'function') spd = spd();
		if (spd === undefined || spd === null) spd = 1;
		u.rotation = Angles.moveToward(
			u.rotation,
			targetAngle,
			u.type.rotateSpeed * Time.delta * spd
		);
		aimAngle = u.rotation;
	} else if (p.constantFire) {
		hasAimbotTarget = true;
		let rotRad = u.rotation * Mathf.degRad;
		aimX = u.x + Math.cos(rotRad) * 100;
		aimY = u.y + Math.sin(rotRad) * 100;
		Vars.player.mouseX = aimX;
		Vars.player.mouseY = aimY;
		let fire = canUnitFire(u, p);
		Vars.player.shooting = fire;
		u.aim(aimX, aimY);
		u.isShooting = fire;
		u.controlWeapons(true, fire);
		aimAngle = u.rotation;
	} else {
		hasAimbotTarget = false;
		aimAngle = u.rotation;
	}
});

var aimbotDpsData = {};

function updateAimbotUnitDps(unit) {
	if (!unit || !unit.isValid() || unit.health <= 0) return;
	let id = unit.id;
	let now = Date.now();
	let currentTotal = unit.health + (unit.shield || 0);
	let data = aimbotDpsData[id];
	if (!data) {
		aimbotDpsData[id] = {
			accHp: currentTotal,
			accDamage: 0,
			lastTime: now,
			dps: 0,
		};
		return;
	}
	let diff = data.accHp - currentTotal;
	if (diff > 0) data.accDamage += diff;
	else if (diff < 0) data.accDamage = Math.max(0, data.accDamage + diff);
	data.accHp = currentTotal;
	if (now - data.lastTime >= 1000) {
		data.dps = Math.floor(data.accDamage);
		data.accDamage = 0;
		data.lastTime = now;
	}
}

Events.run(Trigger.draw, function () {
	if (!active || !Vars.state.isGame()) return;

	let pu = Vars.player.unit();
	if (pu && !pu.dead) {
		let p = getCurrentPreset(pu);
		if (p) {
			let range = pu.hasWeapons() ? pu.type.maxRange : 300;
			Draw.color(Color.sky);
			Draw.alpha(0.3);
			Lines.stroke(1.0);
			Lines.circle(pu.x, pu.y, range);
			if (p.predictFire) {
				let searchRange = range + (p.predictTiles || 20) * 8;
				Draw.color(Color.gold);
				Draw.alpha(0.2);
				Lines.stroke(0.8);
				Lines.circle(pu.x, pu.y, searchRange);
			}
		}
	}

	if (currentTarget && currentTarget.isValid()) {
		let size = currentTarget.hitSize || 10;
		let r = size / 2 + 3;

		let targetColor = Color.orange;
		if (currentTargetType === 'units') {
			targetColor =
				manualPriorityTarget && currentTarget === manualPriorityTarget
					? Color.magenta
					: Color.red;
		} else if (currentTargetType === 'heal') {
			targetColor = Color.green;
		}

		Draw.color(targetColor);
		Draw.alpha(0.85);
		Lines.stroke(0.8);

		let L = Math.max(3, Math.min(6, r / 2));
		let cx = currentTarget.x;
		let cy = currentTarget.y;

		Lines.line(cx - r, cy + r, cx - r + L, cy + r);
		Lines.line(cx - r, cy + r, cx - r, cy + r - L);
		Lines.line(cx + r, cy + r, cx + r - L, cy + r);
		Lines.line(cx + r, cy + r, cx + r, cy + r - L);
		Lines.line(cx - r, cy - r, cx - r + L, cy - r);
		Lines.line(cx - r, cy - r, cx - r, cy - r + L);
		Lines.line(cx + r, cy - r, cx + r - L, cy - r);
		Lines.line(cx + r, cy - r, cx + r, cy - r + L);

		if (manualPriorityTarget && currentTarget === manualPriorityTarget) {
			Draw.alpha(0.5);
			Lines.stroke(0.6);
			Lines.square(cx, cy, r - 2, Time.time * 1.5);
			Draw.color(Color.gold);
			Draw.alpha(0.35);
			Lines.stroke(0.5);
			Lines.circle(cx, cy, r + 4);
		} else {
			Draw.alpha(0.4);
			Lines.circle(cx, cy, 1);
		}

		if (
			currentTargetType === 'units' ||
			currentTarget.health !== undefined
		) {
			updateAimbotUnitDps(currentTarget);
			let dData = aimbotDpsData[currentTarget.id];
			let dps = dData ? dData.dps : 0;
			let hpText =
				Math.floor(currentTarget.health) +
				'/' +
				Math.floor(currentTarget.maxHealth);
			if (currentTarget.shield > 0)
				hpText += ' [accent](' + Math.floor(currentTarget.shield) + ')';
			if (dps > 0) hpText += ' [scarlet]-' + dps;
			let hpOffset = r + 8;
			Draw.z(Layer.max);
			Fonts.outline.draw(
				hpText,
				cx,
				cy + hpOffset,
				Color.white,
				0.22,
				true,
				Align.center
			);
		}

		let pu2 = Vars.player.unit();
		if (pu2) {
			let lineColor =
				manualPriorityTarget && currentTarget === manualPriorityTarget
					? Color.magenta
					: Color.green;
			if (predictLineMode === 1) {
				Draw.color(lineColor);
				Draw.alpha(0.6);
				Lines.stroke(0.5);
				Lines.line(
					pu2.x,
					pu2.y,
					Vars.player.mouseX,
					Vars.player.mouseY
				);
			} else if (predictLineMode === 2) {
				Draw.color(lineColor);
				Draw.alpha(0.6);
				Lines.stroke(0.5);
				if (pu2.mounts && pu2.mounts.length > 0) {
					for (let i = 0; i < pu2.mounts.length; i++) {
						let mount = pu2.mounts[i];
						if (!mount || !mount.weapon) continue;
						let wx = mount.weapon.x;
						let wy = mount.weapon.y;
						let mountX =
							pu2.x + Angles.trnsx(pu2.rotation - 90, wx, wy);
						let mountY =
							pu2.y + Angles.trnsy(pu2.rotation - 90, wx, wy);
						Lines.line(
							mountX,
							mountY,
							Vars.player.mouseX,
							Vars.player.mouseY
						);
					}
				} else {
					Lines.line(
						pu2.x,
						pu2.y,
						Vars.player.mouseX,
						Vars.player.mouseY
					);
				}
			}
			Draw.color(Color.white);
			Draw.alpha(0.6);
			Lines.stroke(0.5);
			Lines.line(
				currentTarget.x,
				currentTarget.y,
				Vars.player.mouseX,
				Vars.player.mouseY
			);
			Lines.circle(Vars.player.mouseX, Vars.player.mouseY, 1.2);
		}

		Draw.reset();
	}
});

function isIgnored(target) {
	if (!ignoredTargets || ignoredTargets.trim() === '') return false;
	let targetName = '';
	if (target.type && target.type.name) targetName = String(target.type.name);
	else if (target.block && target.block.name)
		targetName = String(target.block.name);
	if (!targetName) return false;
	if (ignoredMap[targetName] === true) return true;
	for (let key in ignoredMap) {
		if (targetName.indexOf(key) !== -1) return true;
	}
	return false;
}

function findTargetUnderCursor(mx, my) {
	let radius = 24.0;
	let found = null;
	let u = Vars.player.unit();
	if (!u) return null;

	try {
		Units.nearbyEnemies(
			u.team,
			mx - radius,
			my - radius,
			radius * 2,
			radius * 2,
			function (e) {
				if (e.dead || !e.isValid() || isIgnored(e)) return;
				let dst = Mathf.dst(mx, my, e.x, e.y);
				if (dst < radius) {
					found = e;
					radius = dst;
				}
			}
		);
	} catch (e) {}
	if (found) return { target: found, type: 'units' };

	try {
		let b = Vars.world.buildWorld(mx, my);
		if (b && b.team != u.team && b.team != Team.derelict && !isIgnored(b)) {
			found = b;
		} else {
			Vars.indexer.allBuildings(mx, my, radius, function (otherB) {
				if (
					otherB.team != u.team &&
					otherB.team != Team.derelict &&
					!isIgnored(otherB)
				) {
					let dst = Mathf.dst(mx, my, otherB.x, otherB.y);
					if (dst < radius) {
						found = otherB;
						radius = dst;
					}
				}
			});
		}
	} catch (e) {}
	if (found) return { target: found, type: 'blocks' };

	try {
		let b = Vars.world.buildWorld(mx, my);
		if (
			b &&
			b.team == u.team &&
			b.damaged() &&
			b.block.destructible &&
			!isIgnored(b)
		) {
			found = b;
		} else {
			Vars.indexer.allBuildings(mx, my, radius, function (otherB) {
				if (
					otherB.team == u.team &&
					otherB.damaged() &&
					otherB.block.destructible &&
					!isIgnored(otherB)
				) {
					let dst = Mathf.dst(mx, my, otherB.x, otherB.y);
					if (dst < radius) {
						found = otherB;
						radius = dst;
					}
				}
			});
		}
	} catch (e) {}
	if (found) return { target: found, type: 'heal' };

	return null;
}

function evalScore(target, p, cx, cy, searchRange) {
	if (isIgnored(target)) return -Infinity;
	let dist = Mathf.dst(cx, cy, target.x, target.y);
	if (dist > searchRange) return -Infinity;

	let baseScore = 0;
	let priority = p.targetPriority;
	if (priority === 'Nearest') baseScore = -dist;
	else if (priority === 'Farthest') baseScore = dist;
	else if (priority === 'Min Current HP') baseScore = -target.health;
	else if (priority === 'Max Current HP') baseScore = target.health;
	else if (priority === 'Min Max HP') baseScore = -target.maxHealth;
	else if (priority === 'Max Max HP') baseScore = target.maxHealth;
	else baseScore = -dist;

	let filter = p.targetTypeFilter || 'Default';
	if (filter !== 'Default') {
		let flying = false;
		if (target.isFlying !== undefined) {
			flying =
				typeof target.isFlying === 'function'
					? target.isFlying()
					: target.isFlying;
		}
		if (filter === 'Ground Only' && flying) return -Infinity;
		if (filter === 'Air Only' && !flying) return -Infinity;
		if (filter === 'Ground / Air' && flying) baseScore -= 10000000;
		if (filter === 'Air / Ground' && !flying) baseScore -= 10000000;
	}
	return baseScore;
}

function findTarget(u, p) {
	let range = u.hasWeapons() ? u.type.maxRange : 300;
	let searchRange = range + (p.predictTiles || 20) * 8;

	let possibleTargets = { units: null, blocks: null, heal: null };
	let bestUnitsScore = -Infinity;
	let bestBlocksScore = -Infinity;
	let bestHealScore = -Infinity;
	let cx = u.x,
		cy = u.y;

	let priorities = p.priorities;
	for (let i = 0; i < priorities.length; i++) {
		let type = priorities[i];
		if (type === 'units' && p.attackEnemyUnits) {
			Units.nearbyEnemies(
				u.team,
				cx - searchRange,
				cy - searchRange,
				searchRange * 2,
				searchRange * 2,
				function (e) {
					if (
						e.dead ||
						!e.checkTarget(u.type.targetAir, u.type.targetGround)
					)
						return;
					let score = evalScore(e, p, cx, cy, searchRange);
					if (score > bestUnitsScore) {
						bestUnitsScore = score;
						possibleTargets['units'] = e;
					}
				}
			);
		} else if (type === 'blocks' && p.attackEnemyBlocks) {
			Vars.indexer.allBuildings(cx, cy, searchRange, function (b) {
				if (b.team != u.team && b.team != Team.derelict) {
					let score = evalScore(b, p, cx, cy, searchRange);
					if (score > bestBlocksScore) {
						bestBlocksScore = score;
						possibleTargets['blocks'] = b;
					}
				}
			});
		} else if (type === 'heal' && p.healFriendlyBlocks) {
			Vars.indexer.allBuildings(cx, cy, searchRange, function (b) {
				if (b.team == u.team && b.damaged() && b.block.destructible) {
					let score = evalScore(b, p, cx, cy, searchRange);
					if (score > bestHealScore) {
						bestHealScore = score;
						possibleTargets['heal'] = b;
					}
				}
			});
		}
	}

	for (let i = 0; i < priorities.length; i++) {
		let t = priorities[i];
		if (possibleTargets[t]) {
			currentTargetType = t;
			return possibleTargets[t];
		}
	}
	return null;
}

function setFieldValue(field, packet, value) {
	try {
		let type = String(field.getType().getName());
		if (type === 'float' || type === 'java.lang.Float') {
			field.set(packet, new java.lang.Float(value));
		} else if (type === 'boolean' || type === 'java.lang.Boolean') {
			field.set(
				packet,
				value ? java.lang.Boolean.TRUE : java.lang.Boolean.FALSE
			);
		} else if (type === 'int' || type === 'java.lang.Integer') {
			field.set(packet, new java.lang.Integer(Math.round(value)));
		}
	} catch (e) {}
}

function modifyPacketFieldsReflectively(packet, xVal, yVal, shootVal) {
	try {
		let u = Vars.player.unit();
		let targetAngle = 0;
		if (u && !u.dead) targetAngle = Angles.angle(u.x, u.y, xVal, yVal);

		let clazz = packet.getClass();
		let fields = clazz.getDeclaredFields();
		for (let i = 0; i < fields.length; i++) {
			let f = fields[i];
			f.setAccessible(true);
			let name = String(f.getName());
			let type = String(f.getType().getName());

			if (
				(name === 'pointerX' || name === 'aimX' || name === 'mouseX') &&
				(type === 'float' || type === 'java.lang.Float')
			) {
				setFieldValue(f, packet, xVal);
			} else if (
				(name === 'pointerY' || name === 'aimY' || name === 'mouseY') &&
				(type === 'float' || type === 'java.lang.Float')
			) {
				setFieldValue(f, packet, yVal);
			} else if (
				(name === 'shooting' || name === 'isShooting') &&
				(type === 'boolean' || type === 'java.lang.Boolean')
			) {
				setFieldValue(f, packet, shootVal);
			} else if (
				(name === 'rotation' ||
					name === 'baseRotation' ||
					name === 'angle' ||
					name === 'dir') &&
				(type === 'float' || type === 'java.lang.Float')
			) {
				if (u && !u.dead) setFieldValue(f, packet, aimAngle);
			}
		}
	} catch (err) {}
}

interceptor.addPacketModifier(function (object) {
	if (!active || !Vars.state.isGame() || !hasAimbotTarget) return;
	if (isPlayerBreakingOrPlacing()) return;

	try {
		let clazz = object.getClass();
		let simpleName = String(clazz.getSimpleName());

		if (
			simpleName.indexOf('Snapshot') !== -1 ||
			simpleName.indexOf('Position') !== -1 ||
			simpleName.indexOf('Control') !== -1 ||
			simpleName.indexOf('Move') !== -1
		) {
			let u = Vars.player.unit();
			let p = getCurrentPreset(u);
			let uCanFire = p && !canUnitFire(u, p) ? false : true;
			modifyPacketFieldsReflectively(object, aimX, aimY, uCanFire);
		} else if (simpleName.indexOf('InvokePacket') !== -1) {
			if (object.args) {
				let u = Vars.player.unit();
				if (u && !u.dead) {
					let p = getCurrentPreset(u);
					let uCanFire = p && !canUnitFire(u, p) ? false : true;
					let args = object.args;
					let len = args.length;

					let unitIdx = -1;
					for (let i = 0; i < len; i++) {
						let arg = args[i];
						if (
							arg &&
							(arg instanceof Packages.mindustry.gen.Unit ||
								String(arg.getClass().getName()).indexOf(
									'Unit'
								) !== -1)
						) {
							if (arg.id === u.id) {
								unitIdx = i;
								break;
							}
						}
					}

					if (unitIdx !== -1) {
						let floatIndices = [];
						let boolIndices = [];
						for (let i = 0; i < len; i++) {
							let arg = args[i];
							if (arg !== null) {
								let tName = String(arg.getClass().getName());
								if (
									arg instanceof java.lang.Float ||
									tName === 'java.lang.Float' ||
									tName === 'float'
								) {
									floatIndices.push(i);
								} else if (
									arg instanceof java.lang.Boolean ||
									tName === 'java.lang.Boolean' ||
									tName === 'boolean'
								) {
									boolIndices.push(i);
								}
							}
						}

						if (unitIdx === len - 1 && floatIndices.length >= 5) {
							args[floatIndices[2]] = new java.lang.Float(aimX);
							args[floatIndices[3]] = new java.lang.Float(aimY);
							args[floatIndices[4]] = new java.lang.Float(
								aimAngle
							);
							if (boolIndices.length >= 1)
								args[boolIndices[0]] = uCanFire
									? java.lang.Boolean.TRUE
									: java.lang.Boolean.FALSE;
						} else if (unitIdx === 1 && len === 10) {
							args[4] = new java.lang.Float(aimX);
							args[5] = new java.lang.Float(aimY);
							args[6] = new java.lang.Float(aimAngle);
							args[7] = uCanFire
								? java.lang.Boolean.TRUE
								: java.lang.Boolean.FALSE;
						} else if (unitIdx === 2 && len === 10) {
							args[5] = new java.lang.Float(aimX);
							args[6] = new java.lang.Float(aimY);
							args[7] = new java.lang.Float(aimAngle);
							args[8] = uCanFire
								? java.lang.Boolean.TRUE
								: java.lang.Boolean.FALSE;
						}
					}
				}
			}
		}
	} catch (e) {}
});

interceptor.add('aim', function (args) {
	showUI = !showUI;
	save();
	rebuildUI();
	notify('Aimbot UI ' + (showUI ? '[green]enabled' : '[red]disabled'));
});

// Expose this module's config dialog to the mod settings screen (gear button).
require('qol-control/core/settings-ui').register(
	'features/aimbot',
	'Aimbot',
	openSettings,
	{ menuSafe: true }
);
