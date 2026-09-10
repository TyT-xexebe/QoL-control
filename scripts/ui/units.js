const notify = require('qol-control/core/logger').notify;
const interceptor = require('qol-control/core/interceptor');

let setup = false;
let hudTable = null;
let contentTable = null;
let headerTable = null;

let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let dragStageOffsetX = 0;
let dragStageOffsetY = 0;

let lastFingerprint = '';
let updateTimer = 0;

let activeHighlight = null;
let deltas = {};
let previousCounts = {};
let lastClickTime = 0;
let lastClickedKey = '';

var cfg = {
	enabled: Core.settings.getBool('qol-units-enabled', true),
	locked: Core.settings.getBool('qol-units-locked', false),
	iconSize: Core.settings.getInt('qol-units-icon-size', 22),
	fontScale: Core.settings.getFloat('qol-units-font-scale', 0.85),
	maxCols: Core.settings.getInt('qol-units-max-cols', 6),
	hideEmpty: Core.settings.getBool('qol-units-hide-empty', true),
	sortBy: Core.settings.getString('qol-units-sort', 'threat'),
	interval: Core.settings.getInt('qol-units-interval', 60),
	x: Core.settings.getFloat('qol-units-x', 20),
	y: Core.settings.getFloat('qol-units-y', 360),
	showLines: Core.settings.getBool('qol-units-lines', true),
	showDeltas: Core.settings.getBool('qol-units-deltas', true),
	rtsOnClick: Core.settings.getBool('qol-units-rts-click', true),
	doubleClickPossess: Core.settings.getBool('qol-units-dc-possess', true),
	ignored: {}
};

try {
	let rawIgnored = Core.settings.getString('qol-units-ignored', '{}');
	cfg.ignored = JSON.parse(rawIgnored) || {};
} catch (e) {
	cfg.ignored = {};
}

function saveCfg() {
	Core.settings.put('qol-units-enabled', new java.lang.Boolean(cfg.enabled));
	Core.settings.put('qol-units-locked', new java.lang.Boolean(cfg.locked));
	Core.settings.put('qol-units-icon-size', new java.lang.Integer(cfg.iconSize));
	Core.settings.put('qol-units-font-scale', new java.lang.Float(cfg.fontScale));
	Core.settings.put('qol-units-max-cols', new java.lang.Integer(cfg.maxCols));
	Core.settings.put('qol-units-hide-empty', new java.lang.Boolean(cfg.hideEmpty));
	Core.settings.put('qol-units-sort', new java.lang.String(cfg.sortBy));
	Core.settings.put('qol-units-interval', new java.lang.Integer(cfg.interval));
	Core.settings.put('qol-units-x', new java.lang.Float(cfg.x));
	Core.settings.put('qol-units-y', new java.lang.Float(cfg.y));
	Core.settings.put('qol-units-lines', new java.lang.Boolean(cfg.showLines));
	Core.settings.put('qol-units-deltas', new java.lang.Boolean(cfg.showDeltas));
	Core.settings.put('qol-units-rts-click', new java.lang.Boolean(cfg.rtsOnClick));
	Core.settings.put('qol-units-dc-possess', new java.lang.Boolean(cfg.doubleClickPossess));
	Core.settings.put('qol-units-ignored', new java.lang.String(JSON.stringify(cfg.ignored)));
	if (typeof Core.settings.forceSave === 'function') {
		Core.settings.forceSave();
	}
}

function formatNum(n) {
	let num = Number(n);
	let abs = Math.abs(num);
	if (abs >= 1000000) return (Math.round(num / 100000) / 10) + 'm';
	if (abs >= 1000) return (Math.round(num / 100) / 10) + 'k';
	return String(Math.floor(num));
}

function selectUnitsRTS(uType, team) {
	if (!Vars.control || !Vars.control.input) return;
	if (!Vars.control.input.selectedUnits) {
		notify('[scarlet]RTS selection not available in this client.');
		return;
	}

	Vars.control.input.selectedUnits.clear();
	let count = 0;
	Groups.unit.each(cons((u) => {
		if (u && !u.dead && u.team === team && u.type.name === uType.name) {
			Vars.control.input.selectedUnits.add(u);
			count++;
		}
	}));

	if (count > 0) {
		if ('commandMode' in Vars.control.input) {
			Vars.control.input.commandMode = true;
		}
		notify('[lightgray]Selected [accent]' + count + ' ' + uType.localizedName + '[lightgray] (RTS)');
	}
}

function possessNearest(uType, team) {
	if (!Vars.player) return;
	let myTeam = Vars.player.team();
	let px = Vars.player.x;
	let py = Vars.player.y;
	let bestUnit = null;
	let minDist = Infinity;

	Groups.unit.each(cons((u) => {
		if (!u || u.dead || !u.type) return;
		if (u.team === myTeam && u.type.name === uType.name && u.player == null) {
			let d = Mathf.dst2(px, py, u.x, u.y);
			if (d < minDist) {
				minDist = d;
				bestUnit = u;
			}
		}
	}));

	if (!bestUnit) {
		Groups.unit.each(cons((u) => {
			if (!u || u.dead || !u.type) return;
			if (u.team === myTeam && u.type.name === uType.name) {
				let d = Mathf.dst2(px, py, u.x, u.y);
				if (d < minDist) {
					minDist = d;
					bestUnit = u;
				}
			}
		}));
	}

	if (bestUnit) {
		if (typeof Call.unitControl === 'function') {
			Call.unitControl(Vars.player, bestUnit);
		} else if (typeof Vars.player.setUnit === 'function') {
			Vars.player.setUnit(bestUnit);
		}
		Core.camera.position.set(bestUnit.x, bestUnit.y);
		notify('[green]Possessed [accent]' + uType.localizedName);
	} else {
		notify('[scarlet]No ' + uType.localizedName + ' available');
	}
}

function jumpCameraToNearest(uType, team) {
	let candidates = [];
	let px = Core.camera.position.x;
	let py = Core.camera.position.y;

	Groups.unit.each(cons((u) => {
		if (!u || u.dead || !u.type) return;
		if (u.team === team && u.type.name === uType.name) {
			candidates.push(u);
		}
	}));

	if (candidates.length === 0) return;

	candidates.sort((a, b) => Mathf.dst2(px, py, a.x, a.y) - Mathf.dst2(px, py, b.x, b.y));

	let target = candidates[0];
	if (candidates.length > 1 && Mathf.dst2(px, py, target.x, target.y) < 32 * 32) {
		target = candidates[1];
	}

	Core.camera.position.set(target.x, target.y);
}

function updateDeltas(data) {
	let now = Time.millis();
	let currentCounts = {};

	for (let i = 0; i < data.teams.length; i++) {
		let t = data.teams[i];
		let tid = t.team.id;
		for (let j = 0; j < t.units.length; j++) {
			let u = t.units[j];
			let key = tid + ':' + u.name;
			currentCounts[key] = u.count;

			if (previousCounts[key] !== undefined) {
				let diff = u.count - previousCounts[key];
				if (diff !== 0) {
					let prevDelta = (deltas[key] && (now - deltas[key].time < 3500)) ? deltas[key].delta : 0;
					deltas[key] = {
						delta: prevDelta + diff,
						time: now
					};
				}
			}
		}
	}
	previousCounts = currentCounts;
}

function getTeamsUnitsData() {
	let teamsMap = {};
	let grandTotal = 0;

	if (!Vars.state || !Vars.state.isGame() || !Groups.unit) {
		return { teams: [], grandTotal: 0 };
	}

	Groups.unit.each(cons((u) => {
		if (!u || u.dead || !u.type) return;
		let typeName = String(u.type.name);
		if (cfg.ignored[typeName]) return;

		let team = u.team;
		if (!team) return;

		grandTotal++;
		let tid = team.id;
		if (!teamsMap[tid]) {
			teamsMap[tid] = {
				team: team,
				total: 0,
				unitMap: {}
			};
		}

		let tEntry = teamsMap[tid];
		tEntry.total++;
		if (!tEntry.unitMap[typeName]) {
			tEntry.unitMap[typeName] = {
				type: u.type,
				name: typeName,
				count: 1,
				maxHp: u.maxHealth || u.type.health || 0
			};
		} else {
			tEntry.unitMap[typeName].count++;
		}
	}));

	let teamList = [];
	for (let tid in teamsMap) {
		let entry = teamsMap[tid];
		let unitsArray = [];
		for (let uName in entry.unitMap) {
			unitsArray.push(entry.unitMap[uName]);
		}

		if (cfg.sortBy === 'count') {
			unitsArray.sort((a, b) => b.count - a.count);
		} else if (cfg.sortBy === 'name') {
			unitsArray.sort((a, b) =>
				String(a.type.localizedName).localeCompare(String(b.type.localizedName))
			);
		} else {
			unitsArray.sort((a, b) => b.maxHp - a.maxHp || b.count - a.count);
		}

		entry.units = unitsArray;
		teamList.push(entry);
	}

	let myTeamId = Vars.player && Vars.player.team() ? Vars.player.team().id : -1;
	teamList.sort((a, b) => {
		if (a.team.id === myTeamId) return -1;
		if (b.team.id === myTeamId) return 1;
		return b.total - a.total;
	});

	return { teams: teamList, grandTotal: grandTotal };
}

function computeFingerprint(data) {
	let now = Time.millis();
	let str = '';
	for (let i = 0; i < data.teams.length; i++) {
		let t = data.teams[i];
		str += t.team.id + ':';
		for (let j = 0; j < t.units.length; j++) {
			let u = t.units[j];
			let key = t.team.id + ':' + u.name;
			let d = (cfg.showDeltas && deltas[key] && (now - deltas[key].time < 3500)) ? deltas[key].delta : 0;
			str += u.name + ':' + u.count + '(' + d + '),';
		}
		str += '|';
	}
	return str;
}

function rebuildContent(data) {
	if (!contentTable) return;
	contentTable.clearChildren();

	if (data.teams.length === 0) {
		let emptyRow = contentTable.table().pad(2).growX().get();
		emptyRow.add('[lightgray]No units[]').pad(4);
		contentTable.row();
		if (hudTable) hudTable.pack();
		return;
	}

	for (let i = 0; i < data.teams.length; i++) {
		let tEntry = data.teams[i];
		let team = tEntry.team;
		let hex = team.color.toString().substring(0, 6);

		let grid = contentTable.table().left().padTop(i === 0 ? 0 : 3).get();
		grid.margin(0);

		let cols = 0;
		for (let j = 0; j < tEntry.units.length; j++) {
			let uEntry = tEntry.units[j];
			let uType = uEntry.type;

			let unitCell = grid.table().pad(2).get();
			unitCell.margin(0);
			unitCell.touchable = Packages.arc.scene.event.Touchable.enabled;

			if (uType.uiIcon) {
				unitCell.image(new Packages.arc.scene.style.TextureRegionDrawable(uType.uiIcon))
					.size(cfg.iconSize)
					.padRight(2);
			}

			let deltaText = '';
			let key = team.id + ':' + uType.name;
			if (cfg.showDeltas && deltas[key] && (Time.millis() - deltas[key].time < 3500) && deltas[key].delta !== 0) {
				let d = deltas[key].delta;
				deltaText = d > 0 ? ' [green]+' + d + '[]' : ' [scarlet]' + d + '[]';
			}

			let countLbl = unitCell.add('[#' + hex + ']' + formatNum(uEntry.count) + '[]' + deltaText)
				.style(Styles.outlineLabel)
				.get();
			countLbl.setFontScale(cfg.fontScale);

			let cellListener = extend(InputListener, {
				enter(event, x, y, pointer, fromActor) {
					if (pointer === -1 && cfg.showLines) {
						activeHighlight = { typeName: uType.name, team: team };
					}
				},
				exit(event, x, y, pointer, toActor) {
					if (pointer === -1) {
						if (activeHighlight && activeHighlight.typeName === uType.name && activeHighlight.team === team) {
							activeHighlight = null;
						}
					}
				},
				touchDown(event, x, y, pointer, button) {
					let now = Time.millis();
					let isFriendly = Vars.player && Vars.player.team() && (team === Vars.player.team());
					let isRightClick = (button === 1 || (Packages.arc.input.KeyCode && Packages.arc.input.KeyCode.mouseRight && button === Packages.arc.input.KeyCode.mouseRight.ordinal()));

					let clickKey = team.id + ':' + uType.name;
					let isDoubleClick = (now - lastClickTime < 380) && (lastClickedKey === clickKey);
					lastClickTime = now;
					lastClickedKey = clickKey;

					if (isFriendly) {
						if (isDoubleClick && cfg.doubleClickPossess) {
							possessNearest(uType, team);
							return true;
						}
						if (isRightClick || cfg.rtsOnClick) {
							selectUnitsRTS(uType, team);
							return true;
						}
					} else {
						jumpCameraToNearest(uType, team);
						return true;
					}

					return true;
				}
			});

			unitCell.addListener(cellListener);

			cols++;
			if (cols >= cfg.maxCols) {
				grid.row();
				cols = 0;
			}
		}
		contentTable.row();
	}

	if (hudTable) hudTable.pack();
}

function initUI() {
	if (setup || !Vars.ui || !Vars.ui.hudGroup) return;
	setup = true;

	hudTable = new Table(Styles.black5);
	hudTable.margin(4);
	hudTable.touchable = Packages.arc.scene.event.Touchable.enabled;

	headerTable = new Table();
	headerTable.touchable = Packages.arc.scene.event.Touchable.enabled;

	let titleLabel = headerTable.add('[accent]Units[]').left().get();
	titleLabel.touchable = Packages.arc.scene.event.Touchable.disabled;

	hudTable.add(headerTable).growX().padBottom(2).row();

	contentTable = new Table();
	contentTable.touchable = Packages.arc.scene.event.Touchable.enabled;
	hudTable.add(contentTable).growX().row();

	let dragListener = extend(InputListener, {
		touchDown(event, x, y, pointer, button) {
			if (cfg.locked) return false;
			isDragging = false;
			dragStartX = x;
			dragStartY = y;
			dragStageOffsetX = event.stageX - hudTable.x;
			dragStageOffsetY = event.stageY - hudTable.y;
			return true;
		},
		touchDragged(event, x, y, pointer) {
			if (cfg.locked) return false;
			if (!isDragging && (Math.abs(x - dragStartX) > 4 || Math.abs(y - dragStartY) > 4)) {
				isDragging = true;
			}
			if (isDragging) {
				let sw = Core.scene.getWidth();
				let sh = Core.scene.getHeight();
				let tw = hudTable.getWidth();
				let th = hudTable.getHeight();

				let targetX = event.stageX - dragStageOffsetX;
				let targetY = event.stageY - dragStageOffsetY;

				let nx = Mathf.clamp(targetX, 0, Math.max(0, sw - tw));
				let ny = Mathf.clamp(targetY, 0, Math.max(0, sh - th));

				let snap = 16;
				if (nx < snap) nx = 0;
				else if (nx > sw - tw - snap) nx = sw - tw;
				if (ny < snap) ny = 0;
				else if (ny > sh - th - snap) ny = sh - th;

				cfg.x = nx;
				cfg.y = ny;
				hudTable.setPosition(nx, ny);
			}
			return true;
		},
		touchUp(event, x, y, pointer) {
			if (isDragging) {
				saveCfg();
				Timer.schedule(run(() => { isDragging = false; }), 0.1);
			} else {
				isDragging = false;
			}
			return true;
		}
	});

	headerTable.addListener(dragListener);

	hudTable.pack();
	Vars.ui.hudGroup.addChild(hudTable);

	let sw = Core.scene.getWidth();
	let sh = Core.scene.getHeight();
	let tw = hudTable.getWidth();
	let th = hudTable.getHeight();
	cfg.x = Mathf.clamp(cfg.x, 0, Math.max(0, sw - tw));
	cfg.y = Mathf.clamp(cfg.y, 0, Math.max(0, sh - th));
	hudTable.setPosition(cfg.x, cfg.y);

	lastFingerprint = '';
	let data = getTeamsUnitsData();
	updateDeltas(data);
	rebuildContent(data);
}

function openSettingsDialog(defaultTab) {
	let dialog = new BaseDialog('Units HUD Settings');
	dialog.addCloseButton();

	let container = new Table();
	container.top().left();

	let activeTab = (defaultTab === 'filter' || defaultTab === 'blacklist') ? 'filter' : 'general';
	let tabPane = new Table();

	let renderTabs = () => {
		tabPane.clearChildren();
		if (activeTab === 'general') {
			buildGeneralSettings(tabPane, dialog);
		} else {
			buildFilterSettings(tabPane, dialog);
		}
	};

	let topBar = container.table().growX().padBottom(10).get();

	let genBtn, filterBtn;
	genBtn = topBar.button('General & Layout', Styles.clearTogglet, () => {
		activeTab = 'general';
		genBtn.setChecked(true);
		filterBtn.setChecked(false);
		renderTabs();
	}).size(180, 42).padRight(6).get();

	filterBtn = topBar.button('Blacklist (Units)', Styles.clearTogglet, () => {
		activeTab = 'filter';
		genBtn.setChecked(false);
		filterBtn.setChecked(true);
		renderTabs();
	}).size(200, 42).get();

	if (activeTab === 'general') {
		genBtn.setChecked(true);
		filterBtn.setChecked(false);
	} else {
		genBtn.setChecked(false);
		filterBtn.setChecked(true);
	}
	container.row();

	tabPane.top().left();
	container.add(tabPane).grow().row();

	dialog.cont.add(new ScrollPane(container)).width(550).height(460);

	renderTabs();
	dialog.show();
}

function buildGeneralSettings(table, dialog) {
	table.top().left();

	table.check('Show Units HUD', cfg.enabled, (b) => {
		cfg.enabled = b;
		saveCfg();
		if (hudTable) hudTable.visible = b;
	}).left().padBottom(6).row();

	table.check('Lock Position (Disable Dragging)', cfg.locked, (b) => {
		cfg.locked = b;
		saveCfg();
	}).left().padBottom(6).row();

	table.check('Hide Empty Teams', cfg.hideEmpty, (b) => {
		cfg.hideEmpty = b;
		saveCfg();
		lastFingerprint = '';
		rebuildContent(getTeamsUnitsData());
	}).left().padBottom(6).row();

	table.check('Draw Lines to Units on Hover', cfg.showLines, (b) => {
		cfg.showLines = b;
		saveCfg();
	}).left().padBottom(6).row();

	table.check('Show +/- Count Changes (Deltas)', cfg.showDeltas, (b) => {
		cfg.showDeltas = b;
		saveCfg();
		lastFingerprint = '';
		rebuildContent(getTeamsUnitsData());
	}).left().padBottom(6).row();

	table.check('Select in RTS on Click (Friendly)', cfg.rtsOnClick, (b) => {
		cfg.rtsOnClick = b;
		saveCfg();
	}).left().padBottom(6).row();

	table.check('Possess Unit on Double-Click', cfg.doubleClickPossess, (b) => {
		cfg.doubleClickPossess = b;
		saveCfg();
	}).left().padBottom(10).row();

	let sortBtn;
	let getSortLabel = () => {
		if (cfg.sortBy === 'count') return 'Sort Units: [accent]By Count[]';
		if (cfg.sortBy === 'name') return 'Sort Units: [accent]Alphabetical[]';
		return 'Sort Units: [accent]Threat (Max HP)[]';
	};
	sortBtn = table.button(getSortLabel(), Styles.cleart, () => {
		if (cfg.sortBy === 'threat') cfg.sortBy = 'count';
		else if (cfg.sortBy === 'count') cfg.sortBy = 'name';
		else cfg.sortBy = 'threat';
		saveCfg();
		sortBtn.setText(getSortLabel());
		lastFingerprint = '';
		rebuildContent(getTeamsUnitsData());
	}).size(280, 40).left().padBottom(12).get();
	table.row();

	let iconSizeLbl = table.add('Icon Size: [accent]' + cfg.iconSize + 'px[]').left().get();
	table.row();
	table.slider(14, 40, 2, cfg.iconSize, (v) => {
		cfg.iconSize = Math.round(v);
		iconSizeLbl.setText('Icon Size: [accent]' + cfg.iconSize + 'px[]');
		saveCfg();
		lastFingerprint = '';
		rebuildContent(getTeamsUnitsData());
	}).width(280).left().padBottom(10).row();

	let fontScaleLbl = table.add('Font Scale: [accent]' + cfg.fontScale.toFixed(2) + '[]').left().get();
	table.row();
	table.slider(0.5, 1.4, 0.05, cfg.fontScale, (v) => {
		cfg.fontScale = Math.round(v * 100) / 100;
		fontScaleLbl.setText('Font Scale: [accent]' + cfg.fontScale.toFixed(2) + '[]');
		saveCfg();
		lastFingerprint = '';
		rebuildContent(getTeamsUnitsData());
	}).width(280).left().padBottom(10).row();

	let colsLbl = table.add('Max Columns (per row): [accent]' + cfg.maxCols + '[]').left().get();
	table.row();
	table.slider(3, 12, 1, cfg.maxCols, (v) => {
		cfg.maxCols = Math.round(v);
		colsLbl.setText('Max Columns (per row): [accent]' + cfg.maxCols + '[]');
		saveCfg();
		lastFingerprint = '';
		rebuildContent(getTeamsUnitsData());
	}).width(280).left().padBottom(10).row();

	let intervalSec = (cfg.interval / 60).toFixed(1);
	let intervalLbl = table.add('Update Interval: [accent]' + cfg.interval + ' ticks (' + intervalSec + 's)[]').left().get();
	table.row();
	table.slider(15, 180, 15, cfg.interval, (v) => {
		cfg.interval = Math.round(v);
		let s = (cfg.interval / 60).toFixed(1);
		intervalLbl.setText('Update Interval: [accent]' + cfg.interval + ' ticks (' + s + 's)[]');
		saveCfg();
	}).width(280).left().padBottom(14).row();

	table.button('Reset Window Position', Styles.cleart, () => {
		let sw = Core.scene.getWidth();
		let sh = Core.scene.getHeight();
		cfg.x = Math.max(0, (sw - (hudTable ? hudTable.getWidth() : 200)) / 2);
		cfg.y = Math.max(0, (sh - (hudTable ? hudTable.getHeight() : 200)) / 2);
		saveCfg();
		if (hudTable) hudTable.setPosition(cfg.x, cfg.y);
		notify('[lightgray]Window position [green]reset');
	}).size(220, 38).left().row();
}

function buildFilterSettings(table, dialog) {
	table.top().left();

	table.add('[lightgray]Click unit to toggle blacklist: [green]Active[] / [scarlet]Disabled[]').left().padBottom(8).row();

	let gridTable = new Table();
	gridTable.top().left();

	let allUnits = [];
	Vars.content.getBy(ContentType.unit).each(cons((u) => {
		if (!u || !u.uiIcon || u.uiIcon === Core.atlas.find('error') || u.uiIcon === Core.atlas.find('clear')) return;
		allUnits.push(u);
	}));

	allUnits.sort((a, b) => (b.health || 0) - (a.health || 0));

	let cols = 8;
	for (let i = 0; i < allUnits.length; i++) {
		let u = allUnits[i];
		let uName = String(u.name);

		let slot = gridTable.table().size(46, 46).pad(2).get();
		slot.touchable = Packages.arc.scene.event.Touchable.enabled;

		let borderTable = slot.table(Packages.mindustry.gen.Tex.whiteui).size(44, 44).center().get();
		let inner = borderTable.table(Styles.black5).size(38, 38).center().get();
		let img = inner.image(new Packages.arc.scene.style.TextureRegionDrawable(u.uiIcon)).size(30).get();

		let updateSlotVisual = () => {
			let hidden = !!cfg.ignored[uName];
			borderTable.setColor(hidden ? Packages.arc.graphics.Color.valueOf('e55454') : Packages.arc.graphics.Color.valueOf('54e565'));
			img.setColor(hidden ? Packages.arc.graphics.Color.valueOf('e55454') : Packages.arc.graphics.Color.white);
		};

		updateSlotVisual();

		slot.clicked(run(() => {
			if (cfg.ignored[uName]) {
				delete cfg.ignored[uName];
			} else {
				cfg.ignored[uName] = true;
			}
			saveCfg();
			lastFingerprint = '';
			rebuildContent(getTeamsUnitsData());
			updateSlotVisual();
		}));

		if ((i + 1) % cols === 0) {
			gridTable.row();
		}
	}

	table.add(new ScrollPane(gridTable)).width(510).height(380).row();
}

if (Vars.ui && Vars.ui.hudGroup) initUI();
else Events.on(ClientLoadEvent, initUI);

Events.on(WorldLoadEvent, () => {
	if (hudTable) {
		hudTable.remove();
		hudTable = null;
		setup = false;
	}
	lastFingerprint = '';
	activeHighlight = null;
	deltas = {};
	previousCounts = {};
	initUI();
});

Events.run(Trigger.update, () => {
	if (!setup || !hudTable) return;

	let isGame = Vars.state.isGame() && Vars.ui.hudfrag && Vars.ui.hudfrag.shown;
	if (!isGame || !cfg.enabled) {
		hudTable.visible = false;
		return;
	}

	hudTable.visible = true;

	updateTimer += Time.delta;
	let interval = cfg.interval || 60;
	if (updateTimer >= interval) {
		updateTimer = 0;
		let data = getTeamsUnitsData();
		updateDeltas(data);
		let fp = computeFingerprint(data);
		if (fp !== lastFingerprint) {
			lastFingerprint = fp;
			rebuildContent(data);
		}
	}
});

Events.run(Trigger.draw, () => {
	if (!Vars.state.isGame() || !Vars.ui.hudfrag || !Vars.ui.hudfrag.shown || !cfg.enabled || !cfg.showLines) return;

	let target = activeHighlight;
	if (!target) return;

	let originX = Core.camera.position.x;
	let originY = Core.camera.position.y;
	let myUnit = Vars.player ? Vars.player.unit() : null;
	if (myUnit && !myUnit.dead) {
		originX = myUnit.x;
		originY = myUnit.y;
	}

	let teamColor = target.team && target.team.color ? target.team.color : Pal.accent;

	Draw.z(Layer.max);
	Lines.stroke(0.75);
	Draw.color(teamColor, 0.35);

	Groups.unit.each(cons((u) => {
		if (!u || u.dead || !u.type) return;
		if (u.type.name === target.typeName && u.team === target.team) {
			Lines.line(originX, originY, u.x, u.y);
		}
	}));

	Draw.reset();
});

interceptor.add('units', (args) => {
	let sub = args[1] ? args[1].toLowerCase() : '';

	if (sub === 'settings' || sub === 'config' || sub === 'cfg' || sub === 'menu' || sub === 'ui' || sub === 's') {
		openSettingsDialog('general');
	} else if (sub === 'close' || sub === 'hide' || sub === 'off' || sub === '0') {
		cfg.enabled = false;
		saveCfg();
		if (hudTable) hudTable.visible = false;
		notify('[lightgray]Units HUD [scarlet]OFF');
	} else if (sub === 'open' || sub === 'show' || sub === 'on' || sub === '1') {
		cfg.enabled = true;
		saveCfg();
		if (hudTable) hudTable.visible = true;
		notify('[lightgray]Units HUD [green]ON');
	} else if (sub === 'help') {
		notify(
			'[lightgray]!units <1/0?>\n' +
			'[accent]!units settings[lightgray] (or !units s)'
		);
	} else {
		cfg.enabled = !cfg.enabled;
		saveCfg();
		if (hudTable) hudTable.visible = cfg.enabled;
		notify('[lightgray]Units HUD ' + (cfg.enabled ? '[green]ON' : '[scarlet]OFF'));
	}
});
