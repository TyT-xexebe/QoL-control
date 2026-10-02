const notify = require('qol-control/core/logger').notify;
const interceptor = require('qol-control/core/interceptor');

function formatNum(n) {
	let num = Number(n);
	let abs = Math.abs(num);
	if (abs >= 1000000) return (Math.round(num / 100000) / 10) + 'm';
	if (abs >= 1000) return (Math.round(num / 100) / 10) + 'k';
	return String(Math.floor(num));
}

// Cached Java classes and constants to avoid runtime reflection overhead
const JFloat = java.lang.Float;
const JInt = java.lang.Integer;
const JBool = java.lang.Boolean;
const AlignCenter = (typeof Align !== 'undefined' && Align && Align.center !== undefined) ? Align.center : (Packages.arc.util.Align ? Packages.arc.util.Align.center : 1);
const AlignBottomRight = (typeof Align !== 'undefined' && Align && Align.bottomRight !== undefined) ? Align.bottomRight : (Packages.arc.util.Align ? Packages.arc.util.Align.bottomRight : 18);
const TouchableDisabled = (typeof Touchable !== 'undefined' && Touchable && Touchable.disabled !== undefined) ? Touchable.disabled : (Packages.arc.scene.event.Touchable ? Packages.arc.scene.event.Touchable.disabled : null);
const TouchableEnabled = (typeof Touchable !== 'undefined' && Touchable && Touchable.enabled !== undefined) ? Touchable.enabled : (Packages.arc.scene.event.Touchable ? Packages.arc.scene.event.Touchable.enabled : null);
const ArcOrderedSet = (typeof OrderedSet !== 'undefined') ? OrderedSet : Packages.arc.struct.OrderedSet;

const ScalingFit = (typeof Scaling !== 'undefined' && Scaling && Scaling.fit)
	? Scaling.fit
	: (Packages.arc.util.Scaling ? Packages.arc.util.Scaling.fit : null);

let setup = false;
let corePanels = {};
let timer = 0;
let secondTicker = 0;
let powerScanTicker = 0;

let lastScreenWidth = -1;
let lastScreenHeight = -1;

const SNAP_DIST = 25;
const RATE_WINDOW = 10; // Fixed 10s rate window
const RECORDER_CAP = 60;
let itemRecorders = {}; // teamId -> itemId -> { buf, head, size }
let usedItems = {};     // teamId -> { itemId: true } (tracks items ever seen in core)
let cachedAllItems = null; // Pure JS array of ContentItem to avoid Java .each() callbacks
let cachedTeamPowerGraphs = {}; // teamId -> OrderedSet<PowerGraph> scanned once/sec

function safeGetInt(key, def) {
	try {
		if (typeof Core.settings.getInt === 'function') return Core.settings.getInt(key, def);
		let val = Core.settings.get(key, null);
		if (val == null) return def;
		let parsed = parseInt(val.toString());
		return isNaN(parsed) ? def : parsed;
	} catch (e) {
		return def;
	}
}

function safeGetFloat(key, def) {
	try {
		if (typeof Core.settings.getFloat === 'function') return Core.settings.getFloat(key, def);
		let val = Core.settings.get(key, null);
		if (val == null) return def;
		let parsed = parseFloat(val.toString());
		return isNaN(parsed) ? def : parsed;
	} catch (e) {
		return def;
	}
}

function safeGetBool(key, def) {
	try {
		if (typeof Core.settings.getBool === 'function') return Core.settings.getBool(key, def);
		let val = Core.settings.get(key, null);
		if (val == null) return def;
		return val.toString() === 'true';
	} catch (e) {
		return def;
	}
}

function safeGetString(key, def) {
	try {
		if (typeof Core.settings.getString === 'function') return Core.settings.getString(key, def);
		let val = Core.settings.get(key, null);
		return val == null ? def : val.toString();
	} catch (e) {
		return def;
	}
}

const cfg = {
	showCoreItems: safeGetBool('qol-core-items', true),
	showRates: safeGetBool('qol-core-rates', true),
	hideEmpty: safeGetBool('qol-core-hide-empty', false),
	showPower: safeGetBool('qol-core-power', true),
	splitPower: safeGetBool('qol-core-split-power', true),
	showBuildCost: safeGetBool('qol-core-buildcost', true),
	columns: safeGetInt('qol-core-cols', 4),
	uiScale: safeGetFloat('qol-core-scale', 1.0),
	bgOpacity: safeGetFloat('qol-core-opacity', 0.85),
	locked: safeGetBool('qol-core-locked', false),
};

function saveCfg() {
	Core.settings.put('qol-core-items', new JBool(cfg.showCoreItems));
	Core.settings.put('qol-core-rates', new JBool(cfg.showRates));
	Core.settings.put('qol-core-hide-empty', new JBool(cfg.hideEmpty));
	Core.settings.put('qol-core-power', new JBool(cfg.showPower));
	Core.settings.put('qol-core-split-power', new JBool(cfg.splitPower));
	Core.settings.put('qol-core-buildcost', new JBool(cfg.showBuildCost));
	Core.settings.put('qol-core-cols', new JInt(cfg.columns));
	Core.settings.put('qol-core-scale', new JFloat(cfg.uiScale));
	Core.settings.put('qol-core-opacity', new JFloat(cfg.bgOpacity));
	Core.settings.put('qol-core-locked', new JBool(cfg.locked));
	if (typeof Core.settings.forceSave === 'function') {
		Core.settings.forceSave();
	}
}

// Pure JS item array caching (avoids calling Vars.content.items().each(cons(...)) every frame)
function getAllItemsList() {
	if (cachedAllItems && cachedAllItems.length > 0) return cachedAllItems;
	if (!Vars.content || !Vars.content.items()) return [];

	let seq = Vars.content.items();
	let arr = [];
	for (let i = 0; i < seq.size; i++) {
		let it = seq.get(i);
		if (it && !it.hidden) arr.push(it);
	}
	cachedAllItems = arr;
	return cachedAllItems;
}

// ---------------- 10-Second Rate Recorder ----------------
function recordItemTick(teamId, itemId, count) {
	if (!itemRecorders[teamId]) itemRecorders[teamId] = {};
	if (!itemRecorders[teamId][itemId]) {
		itemRecorders[teamId][itemId] = {
			buf: new Float32Array(RECORDER_CAP),
			head: 0,
			size: 0
		};
	}
	let rec = itemRecorders[teamId][itemId];
	rec.head = (rec.head + 1) % RECORDER_CAP;
	rec.buf[rec.head] = count;
	if (rec.size < RECORDER_CAP) rec.size++;
}

function getItemDeltaRate(teamId, itemId) {
	if (!itemRecorders[teamId] || !itemRecorders[teamId][itemId]) return 0;
	let rec = itemRecorders[teamId][itemId];
	if (rec.size < 2) return 0;

	let w = Math.min(RATE_WINDOW, rec.size - 1);
	if (w < 1) return 0;

	let latest = rec.buf[rec.head];
	let oldIdx = (rec.head - w + RECORDER_CAP) % RECORDER_CAP;
	let oldest = rec.buf[oldIdx];

	let diff = latest - oldest;
	if (Math.abs(diff) < 0.1) return 0;

	return diff / w;
}

function formatRate(rate) {
	if (Math.abs(rate) < 0.1) return '';
	let isPos = rate > 0;
	let col = isPos ? '[#73d216]' : '[#ff4444]';
	let sign = isPos ? '+' : '-';
	let abs = Math.abs(rate);
	let str = abs >= 1000 ? formatNum(abs) : (abs >= 10 ? Math.round(abs).toString() : abs.toFixed(1));
	return col + sign + str + '[]';
}

// ---------------- Power & Plans Calculation (Real-Time) ----------------
function scanTeamPowerGraphs(team) {
	let teamData = Vars.state.teams ? Vars.state.teams.get(team) : null;
	if (!teamData) return null;

	let graphs = new ArcOrderedSet();
	let core = teamData.core();
	if (core && core.power && core.power.graph) {
		graphs.add(core.power.graph);
	}

	if (teamData.buildings) {
		let seq = teamData.buildings;
		let size = seq.size;
		for (let i = 0; i < size; i++) {
			let b = seq.get(i);
			if (b && b.block && b.block.hasPower && b.power && b.power.graph) {
				graphs.add(b.power.graph);
			}
		}
	}
	return graphs;
}

function getTeamPowerInfo(team) {
	let teamData = Vars.state.teams ? Vars.state.teams.get(team) : null;
	if (!teamData) return null;

	let graphs = scanTeamPowerGraphs(team);
	if (!graphs || graphs.size === 0) return null;

	let gridList = [];
	let totalProduced = 0;
	let totalNeeded = 0;
	let totalBalance = 0;
	let totalStored = 0;
	let totalCapacity = 0;

	let items = graphs.orderedItems();
	let gCount = items.size;
	for (let i = 0; i < gCount; i++) {
		let g = items.get(i);
		if (!g) continue;

		let p = (typeof g.getLastPowerProduced === 'function') ? g.getLastPowerProduced() * 60 : g.getPowerProduced() * 60;
		let n = (typeof g.getLastPowerNeeded === 'function') ? g.getLastPowerNeeded() * 60 : g.getPowerNeeded() * 60;
		let b = (typeof g.getPowerBalance === 'function') ? g.getPowerBalance() * 60 : (p - n);
		let s = (typeof g.getLastPowerStored === 'function') ? g.getLastPowerStored() : g.getBatteryStored();
		let c = (typeof g.getTotalBatteryCapacity === 'function') ? g.getTotalBatteryCapacity() : (typeof g.getLastCapacity === 'function' ? g.getLastCapacity() : 0);

		totalProduced += p;
		totalNeeded += n;
		totalBalance += b;
		totalStored += s;
		totalCapacity += c;

		let frac = c > 0 ? (s / c) : (p >= n && p > 0 ? 1.0 : 0.0);
		gridList.push({
			balance: Math.round(b),
			stored: Math.round(s),
			capacity: Math.round(c),
			fraction: frac
		});
	}

	if (gridList.length > 1) {
		gridList.sort((a, b) => (b.capacity + Math.abs(b.balance)) - (a.capacity + Math.abs(a.balance)));
	}

	let totalFraction = totalCapacity > 0 ? (totalStored / totalCapacity) : (totalProduced >= totalNeeded && totalProduced > 0 ? 1.0 : 0.0);

	return {
		totalBalance: Math.round(totalBalance),
		totalStored: Math.round(totalStored),
		totalCapacity: Math.round(totalCapacity),
		totalFraction: totalFraction,
		grids: gridList
	};
}

function getPlayerBuildPlanCosts() {
	let u = Vars.player ? Vars.player.unit() : null;
	if (!u || !u.plans || u.plans.size === 0) return null;

	let plans = u.plans;
	let plansSize = plans.size;
	if (plansSize === 0) return null;

	let costs = {};
	let costsCount = 0;
	let totalPlans = 0;
	let totalBuildTime = 0;
	let team = Vars.player.team();

	// 1. Player unit's base build speed
	let playerSpeed = (u.type ? u.type.buildSpeed : 1.0) * (u.buildSpeedMultiplier || 1.0);
	if (playerSpeed <= 0) playerSpeed = 0.5;

	// 2. Team build speed rule
	let ruleSpeed = 1.0;
	if (Vars.state.rules) {
		if (typeof Vars.state.rules.buildSpeed === 'function') {
			ruleSpeed = Vars.state.rules.buildSpeed(team);
		} else if (typeof Vars.state.rules.buildSpeedMultiplier === 'number') {
			ruleSpeed = Vars.state.rules.buildSpeedMultiplier;
		}
	}
	if (ruleSpeed <= 0) ruleSpeed = 1.0;

	// 3. Fast coordinate hash map for active plans to make helper detection O(1)
	let planCoordMap = {};
	for (let i = 0; i < plansSize; i++) {
		let p = plans.get(i);
		if (p && !p.breaking && p.block) {
			planCoordMap[p.x + '_' + p.y] = true;
		}
	}

	let helperSpeed = 0;
	let helpersCount = 0;
	if (team && team.data && team.data().units) {
		let units = team.data().units;
		let uCount = units.size;
		for (let i = 0; i < uCount; i++) {
			let other = units.get(i);
			if (!other || other === u || !other.isValid()) continue;

			let isBuilding = (typeof other.activelyBuilding === 'function' && other.activelyBuilding()) ||
				(typeof other.isBuilding === 'function' && other.isBuilding());
			if (isBuilding) {
				let bp = (typeof other.buildPlan === 'function') ? other.buildPlan() : null;
				if (bp && planCoordMap[bp.x + '_' + bp.y]) {
					let spd = (other.type ? other.type.buildSpeed : 1.0) * (other.buildSpeedMultiplier || 1.0);
					helperSpeed += spd;
					helpersCount++;
				}
			}
		}
	}

	let totalEffectiveSpeed = (playerSpeed + helperSpeed) * ruleSpeed;
	if (totalEffectiveSpeed <= 0) totalEffectiveSpeed = 1.0;

	let costMultiplier = (Vars.state.rules && typeof Vars.state.rules.buildCostMultiplier === 'number')
		? Vars.state.rules.buildCostMultiplier
		: 1.0;

	// 4. Exact build cost & time calculation
	for (let i = 0; i < plansSize; i++) {
		let plan = plans.get(i);
		if (!plan || plan.breaking || !plan.block) continue;
		totalPlans++;

		let cbhas = false;
		let cbprog = 0.0;
		let cbb = (plan.block.buildCost !== undefined ? plan.block.buildCost : (plan.block.buildTime || 60));

		let tile = Vars.world.tile(plan.x, plan.y);
		let build = tile ? tile.build : null;
		if (build && build.block && build.block.name && build.block.name.startsWith('build')) {
			cbhas = true;
			if (typeof build.progress === 'number') cbprog = build.progress;
			else if (typeof build.progress === 'function') cbprog = build.progress();
			if (build.buildCost !== undefined) cbb = build.buildCost;
		} else if (plan.progress !== undefined && plan.progress > 0) {
			cbprog = plan.progress;
		}

		cbprog = Mathf.clamp(cbprog, 0, 1);
		let remainingFraction = cbhas ? (1.0 - cbprog) : (plan.progress !== undefined ? (1.0 - cbprog) : 1.0);

		let planSeconds = (cbb * costMultiplier * remainingFraction) / (60.0 * totalEffectiveSpeed);
		totalBuildTime += planSeconds;

		let reqs = plan.block.requirements;
		if (reqs) {
			let reqLen = reqs.length;
			for (let r = 0; r < reqLen; r++) {
				let stack = reqs[r];
				let item = stack.item;
				let needed = Math.ceil(stack.amount * costMultiplier * remainingFraction);
				if (needed > 0) {
					if (!costs[item.id]) {
						costs[item.id] = { item: item, needed: 0 };
						costsCount++;
					}
					costs[item.id].needed += needed;
				}
			}
		}
	}

	if (totalPlans === 0) return null;

	return {
		totalPlans: totalPlans,
		costs: costs,
		costsCount: costsCount,
		estSeconds: totalBuildTime,
		playerSpeed: playerSpeed * ruleSpeed,
		helperSpeed: helperSpeed * ruleSpeed,
		helpersCount: helpersCount,
		totalSpeed: totalEffectiveSpeed
	};
}

function getPossibleItems(team) {
	let teamData = Vars.state.teams ? Vars.state.teams.get(team) : null;
	let core = teamData ? teamData.core() : null;
	let hidden = Vars.state.rules && Vars.state.rules.hiddenBuildItems ? Vars.state.rules.hiddenBuildItems : null;
	let isCamp = Vars.state.isCampaign && typeof Vars.state.isCampaign === 'function' ? Vars.state.isCampaign() : false;
	let items = [];

	let allItems = getAllItemsList();
	let allLen = allItems.length;
	let teamUsed = usedItems[team.id] || {};

	for (let i = 0; i < allLen; i++) {
		let item = allItems[i];
		if (!item) continue;
		if (hidden && hidden.contains(item)) continue;
		if (isCamp && !item.unlockedNow()) continue;

		// Smart hide: only hide if never stored once on this map
		if (cfg.hideEmpty) {
			if (!teamUsed[item.id]) {
				let amt = (core && core.items) ? core.items.get(item) : 0;
				if (amt > 0) {
					if (!usedItems[team.id]) usedItems[team.id] = {};
					usedItems[team.id][item.id] = true;
				} else {
					continue; // Never seen in core -> keep hidden
				}
			}
		}
		items.push(item);
	}
	return items;
}

// ---------------- Snapping & Position Management ----------------
function applyDragWithSnapping(pData, targetX, targetY) {
	let sw = Core.scene.getWidth();
	let sh = Core.scene.getHeight();
	let tw = pData.table.getWidth();
	let th = pData.table.getHeight();
	let clampedX = Mathf.clamp(targetX, 0, Math.max(0, sw - tw));
	let clampedY = Mathf.clamp(targetY, 0, Math.max(0, sh - th));
	let distLeft = clampedX;
	let distRight = sw - (clampedX + tw);
	let distBottom = clampedY;
	let distTop = sh - (clampedY + th);
	let anchorX = 'free';
	let offsetX = clampedX;
	if (distLeft <= SNAP_DIST && distLeft <= distRight) {
		anchorX = 'left';
		clampedX = 0;
		offsetX = 0;
	} else if (distRight <= SNAP_DIST) {
		anchorX = 'right';
		clampedX = Math.max(0, sw - tw);
		offsetX = 0;
	}
	let anchorY = 'free';
	let offsetY = clampedY;
	if (distTop <= SNAP_DIST && distTop <= distBottom) {
		anchorY = 'top';
		clampedY = Math.max(0, sh - th);
		offsetY = 0;
	} else if (distBottom <= SNAP_DIST) {
		anchorY = 'bottom';
		clampedY = 0;
		offsetY = 0;
	}
	pData.anchorX = anchorX;
	pData.anchorY = anchorY;
	pData.offsetX = offsetX;
	pData.offsetY = offsetY;
	pData.btnX = clampedX;
	pData.btnY = clampedY;
	pData.table.setPosition(clampedX, clampedY);
}

function savePanelPosition(pData, prefix) {
	Core.settings.put(prefix + '-x', new JFloat(pData.btnX));
	Core.settings.put(prefix + '-y', new JFloat(pData.btnY));
	Core.settings.put(prefix + '-anchorX', pData.anchorX);
	Core.settings.put(prefix + '-anchorY', pData.anchorY);
	Core.settings.put(prefix + '-offsetX', new JFloat(pData.offsetX));
	Core.settings.put(prefix + '-offsetY', new JFloat(pData.offsetY));
	if (typeof Core.settings.forceSave === 'function') {
		Core.settings.forceSave();
	}
}

function repositionPanel(pData) {
	if (pData.isDragging) return;
	let sw = (Core.scene && Core.scene.getWidth() > 0) ? Core.scene.getWidth() : Core.graphics.getWidth();
	let sh = (Core.scene && Core.scene.getHeight() > 0) ? Core.scene.getHeight() : Core.graphics.getHeight();
	let tw = pData.table.getWidth();
	let th = pData.table.getHeight();
	let x = pData.btnX;
	let y = pData.btnY;
	if (pData.anchorX === 'left') {
		x = pData.offsetX;
	} else if (pData.anchorX === 'right') {
		x = Math.max(0, sw - tw - pData.offsetX);
	} else {
		x = Mathf.clamp(x, 0, Math.max(0, sw - tw));
	}
	if (pData.anchorY === 'top') {
		y = Math.max(0, sh - th - pData.offsetY);
	} else if (pData.anchorY === 'bottom') {
		y = pData.offsetY;
	} else {
		y = Mathf.clamp(y, 0, Math.max(0, sh - th));
	}
	pData.btnX = x;
	pData.btnY = y;
	pData.table.setPosition(x, y);
}

function attachDraggable(table, pData, prefix) {
	let dragStartMouseX = 0;
	let dragStartMouseY = 0;
	let dragStartPanelX = 0;
	let dragStartPanelY = 0;

	let listener = extend(InputListener, {
		touchDown(event, x, y, pointer, button) {
			if (cfg.locked) return false;
			pData.isDragging = true;
			dragStartMouseX = Core.input.mouseX();
			dragStartMouseY = Core.input.mouseY();
			dragStartPanelX = pData.btnX;
			dragStartPanelY = pData.btnY;
			return true;
		},
		touchDragged(event, x, y, pointer) {
			if (!pData.isDragging || cfg.locked) return;
			let curMouseX = Core.input.mouseX();
			let curMouseY = Core.input.mouseY();
			let targetX = dragStartPanelX + (curMouseX - dragStartMouseX);
			let targetY = dragStartPanelY + (curMouseY - dragStartMouseY);
			applyDragWithSnapping(pData, targetX, targetY);
		},
		touchUp(event, x, y, pointer, button) {
			if (pData.isDragging) {
				pData.isDragging = false;
				savePanelPosition(pData, prefix);
			}
			return true;
		},
	});
	table.addListener(listener);
	pData.dragListener = listener;
}

// ---------------- Custom Progress Bar for Power ----------------
function createBarElement(barH) {
	let bar = extend(Element, {
		draw() {
			if (this.width <= 0 || this.height <= 0) return;
			let x = this.x;
			let y = this.y;
			let w = this.width;
			let h = this.height;

			let frac = Mathf.clamp(this.fraction !== undefined ? this.fraction : 0, 0, 1);

			// 1. Dark background bar
			Draw.color(Color.valueOf("18181c"));
			Draw.alpha(this.parentAlpha);
			if (Tex.bar) {
				Tex.bar.draw(x, y, w, h);
			} else {
				Fill.rect(x + w / 2, y + h / 2, w, h);
			}

			// 2. Bar fill (representing battery charge percentage)
			if (frac > 0.001) {
				let fw = Math.max(3, w * frac);
				let col = this.barColor || Pal.accent;
				Draw.color(col);
				Draw.alpha(this.parentAlpha * 0.90);
				if (Tex.barTop) {
					Tex.barTop.draw(x, y, fw, h);
				} else if (Tex.bar) {
					Tex.bar.draw(x, y, fw, h);
				} else {
					Fill.rect(x + fw / 2, y + h / 2, fw, h);
				}
			}

			// 3. Center Label (+16k / -500 directly on the bar)
			let text = this.centerText || '';
			if (text.length > 0) {
				let font = Fonts.outline;
				font.setColor(Color.white);
				let s = 0.68 * (cfg.uiScale || 1.0);
				font.getData().setScale(s);
				font.draw(text, x, y + h / 2 + font.getCapHeight() / 2, w, AlignCenter, false);
				font.getData().setScale(1.0);
			}

			Draw.reset();
		}
	});
	return bar;
}

// ---------------- Unified Panel Creation & Layout ----------------
function createCorePanel(team) {
	if (!Vars.ui || !Vars.ui.hudGroup) return;

	let s = cfg.uiScale || 1.0;
	let table = new Table(Styles.black5);
	table.margin(Math.max(2, Math.round(4 * s)));
	table.touchable = TouchableEnabled;
	if (cfg.bgOpacity !== undefined) {
		table.setColor(1, 1, 1, cfg.bgOpacity);
	}

	// Header row: [Team Core] + [Gear Settings]
	let headerTable = table.table().growX().padBottom(Math.max(1, Math.round(2 * s))).get();
	let titleLabel = headerTable.add('[#' + team.color.toString() + ']' + team.name + ' Core[]')
		.style(Styles.outlineLabel).fontScale(0.84 * s).left().growX().get();
	let gearSize = Math.max(14, Math.round(18 * s));
	headerTable.button(Icon.settings, Styles.clearNonei, () => {
		openSettingsDialog();
	}).size(gearSize, gearSize).right();
	table.row();

	// Core Items Container
	let coreContainer = table.table().left().get();
	let itemsGrid = coreContainer.table().left().get();
	coreContainer.visible = cfg.showCoreItems;
	table.row();

	// Power & Battery section (Bar with centered balance + battery numbers below)
	let powerContainer = table.table().growX().padTop(Math.max(1, Math.round(3 * s))).get();
	let powerBarTable = powerContainer.table().growX().get();
	powerContainer.row();
	let powerSubLabel = powerContainer.add('').style(Styles.outlineLabel).fontScale(0.68 * s).center().get();
	powerContainer.visible = cfg.showPower;
	table.row();

	// Build Plan section (auto-hides if empty or disabled)
	let buildContainer = table.table().left().padTop(Math.max(1, Math.round(2 * s))).get();
	let buildHeader = buildContainer.table().left().padBottom(1).get();
	let buildTitle = buildHeader.add('').style(Styles.outlineLabel).fontScale(0.80 * s).left().get();
	buildContainer.row();
	let buildGrid = buildContainer.table().left().get();
	buildContainer.visible = false;

	table.pack();

	let defaultX = 15;
	let defaultY = 260 - Object.keys(corePanels).length * 55;
	let prefix = 'coreinfo-' + team.id;
	let sx = safeGetFloat(prefix + '-x', defaultX);
	let sy = safeGetFloat(prefix + '-y', defaultY);
	let anchorX = safeGetString(prefix + '-anchorX', 'left');
	let anchorY = safeGetString(prefix + '-anchorY', 'top');
	let offsetX = safeGetFloat(prefix + '-offsetX', sx);
	let offsetY = safeGetFloat(prefix + '-offsetY', sy);

	table.setPosition(sx, sy);
	Vars.ui.hudGroup.addChild(table);

	let pData = {
		table: table,
		team: team,
		headerTable: headerTable,
		titleLabel: titleLabel,
		coreContainer: coreContainer,
		itemsGrid: itemsGrid,
		powerContainer: powerContainer,
		powerBarTable: powerBarTable,
		powerSubLabel: powerSubLabel,
		powerBars: [],
		powerBarCount: -1,
		buildContainer: buildContainer,
		buildTitle: buildTitle,
		buildGrid: buildGrid,
		itemCells: {},
		lastItemsCount: -1,
		lastFingerprint: '',
		lastBuildFp: '',
		btnX: sx,
		btnY: sy,
		anchorX: anchorX,
		anchorY: anchorY,
		offsetX: offsetX,
		offsetY: offsetY,
		isDragging: false,
	};

	attachDraggable(table, pData, prefix);
	repositionPanel(pData);
	corePanels[team.id] = pData;
}

function rebuildItemGrid(pData, possibleItems) {
	pData.itemsGrid.clearChildren();
	pData.itemCells = {};

	let s = cfg.uiScale || 1.0;
	let cols = cfg.columns || 4;
	let curCol = 0;

	let iconSize = Math.max(10, Math.round(14 * s));
	let cellWidth = Math.max(42, Math.round(60 * s));
	let padBottomAmt = Math.max(2, Math.round(4 * s));
	let pLen = possibleItems.length;

	for (let i = 0; i < pLen; i++) {
		let item = possibleItems[i];

		let stack = new Packages.arc.scene.ui.layout.Stack();

		// Base layer: Item icon + Quantity
		let baseTable = new Table();
		baseTable.left();

		let imgCell = baseTable.image(item.uiIcon).size(iconSize).padRight(Math.max(1, Math.round(2 * s)));
		if (ScalingFit) imgCell.scaling(ScalingFit);
		let img = imgCell.get();
		if (img && img.setColor) img.setColor(Color.white);

		let amtLabel = baseTable.add('0').style(Styles.outlineLabel).fontScale(0.72 * s).padBottom(padBottomAmt).left().get();
		stack.add(baseTable);

		// Overlay layer: Rate +/- in bottom-right corner
		let rateLabel = new Label('');
		rateLabel.setStyle(Styles.outlineLabel);
		rateLabel.setAlignment(AlignBottomRight);
		rateLabel.setFontScale(0.60 * s);
		rateLabel.setFillParent(true);
		rateLabel.touchable = TouchableDisabled;
		stack.add(rateLabel);

		pData.itemCells[item.id] = {
			stack: stack,
			baseTable: baseTable,
			amtLabel: amtLabel,
			rateLabel: rateLabel,
			item: item,
			lastAmt: -1,
			lastRateStr: ''
		};

		pData.itemsGrid.add(stack).width(cellWidth).pad(Math.max(1, Math.round(1 * s))).top().left();
		curCol++;
		if (curCol >= cols) {
			pData.itemsGrid.row();
			curCol = 0;
		}
	}
	pData.table.pack();
	repositionPanel(pData);
}

function updatePowerContainer(p, powerInfo) {
	if (!powerInfo || powerInfo.grids.length === 0) {
		p.powerBarTable.clearChildren();
		p.powerSubLabel.setText('[lightgray]No Power Grid[]');
		p.powerBarCount = 0;
		return;
	}

	let s = cfg.uiScale || 1.0;
	let barHeight = Math.max(12, Math.round(16 * s));
	let isSplit = cfg.splitPower && powerInfo.grids.length > 1;
	let barCount = isSplit ? Math.min(4, powerInfo.grids.length) : 1;

	// Rebuild bar elements only when structure/count changes
	if (p.powerBarCount !== barCount) {
		p.powerBarTable.clearChildren();
		p.powerBars = [];
		for (let i = 0; i < barCount; i++) {
			let bar = createBarElement(barHeight);
			p.powerBars.push(bar);
			let cell = p.powerBarTable.add(bar).growX().height(barHeight);
			if (i < barCount - 1) cell.padRight(2);
		}
		p.powerBarCount = barCount;
		p.table.pack();
		repositionPanel(p);
	}

	if (!isSplit) {
		// Single combined bar
		let bar = p.powerBars[0];
		if (bar) {
			let bal = powerInfo.totalBalance;
			let balSign = bal > 0 ? '+' : '';
			bar.fraction = powerInfo.totalFraction;
			bar.centerText = balSign + formatNum(bal);
			bar.barColor = bal < 0 ? Color.valueOf("e55454") : (powerInfo.totalStored > 0 ? Pal.accent : Pal.power);
		}
		if (powerInfo.totalCapacity > 0) {
			p.powerSubLabel.setText('[lightgray]' + formatNum(powerInfo.totalStored) + ' / ' + formatNum(powerInfo.totalCapacity) + '[]');
		} else {
			p.powerSubLabel.setText('');
		}
	} else {
		// Multiple split bars side by side
		let subStrs = [];
		for (let i = 0; i < barCount; i++) {
			let g = powerInfo.grids[i];
			let bar = p.powerBars[i];
			if (bar && g) {
				let bal = g.balance;
				let balSign = bal > 0 ? '+' : '';
				bar.fraction = g.fraction;
				bar.centerText = balSign + formatNum(bal);
				bar.barColor = bal < 0 ? Color.valueOf("e55454") : (g.stored > 0 ? Pal.accent : Pal.power);
			}
			if (g && g.capacity > 0) {
				subStrs.push(formatNum(g.stored) + '/' + formatNum(g.capacity));
			}
		}
		if (subStrs.length > 0) {
			p.powerSubLabel.setText('[lightgray]' + subStrs.join('  |  ') + '[]');
		} else {
			p.powerSubLabel.setText('');
		}
	}
}

function renderBuildPlanGrid(gridContainer, titleLabel, buildInfo, core) {
	if (!buildInfo || buildInfo.totalPlans === 0) {
		gridContainer.clearChildren();
		if (titleLabel) titleLabel.setText('[accent]🔨 Build Plans: 0[]');
		return;
	}

	let s = cfg.uiScale || 1.0;
	let timeStr = buildInfo.estSeconds.toFixed(1) + 's';
	let speedDesc = buildInfo.totalSpeed.toFixed(1) + 'x';
	if (buildInfo.helpersCount > 0) {
		speedDesc += ' [lightgray](+' + buildInfo.helpersCount + '👥)[]';
	}

	if (titleLabel) {
		titleLabel.setText('[accent]🔨 Plans (' + buildInfo.totalPlans + ')[] [lightgray]• ~' + timeStr + ' (' + speedDesc + ')[]');
	}

	gridContainer.clearChildren();
	gridContainer.top().left();

	let col = 0;
	let maxCols = cfg.columns || 4;
	let iconSize = Math.max(10, Math.round(14 * s));

	for (let itemId in buildInfo.costs) {
		let c = buildInfo.costs[itemId];
		let inCore = (core && core.items) ? core.items.get(c.item) : 0;
		let enough = inCore >= c.needed;
		let colTag = enough ? '[#73d216]' : '[#ff4444]';

		let cellTable = gridContainer.table().left().pad(Math.max(1, Math.round(1 * s))).get();
		let imgCell = cellTable.image(c.item.uiIcon).size(iconSize).padRight(Math.max(1, Math.round(2 * s)));
		if (ScalingFit) imgCell.scaling(ScalingFit);
		let img = imgCell.get();
		if (img && img.setColor) img.setColor(Color.white);
		cellTable.add(colTag + formatNum(c.needed) + '[]').style(Styles.outlineLabel).fontScale(0.72 * s);

		col++;
		if (col >= maxCols) {
			gridContainer.row();
			col = 0;
		}
	}
}

// ---------------- Panel Toggles ----------------
function recreateAllPanels() {
	let activeTeams = [];
	for (let id in corePanels) {
		if (corePanels[id] && corePanels[id].team) {
			activeTeams.push(corePanels[id].team);
		}
		if (corePanels[id] && corePanels[id].table) {
			corePanels[id].table.remove();
		}
	}
	corePanels = {};
	let tLen = activeTeams.length;
	for (let i = 0; i < tLen; i++) {
		createCorePanel(activeTeams[i]);
	}
}

function toggleCorePanel(team) {
	let nowOn;
	if (corePanels[team.id]) {
		corePanels[team.id].table.remove();
		delete corePanels[team.id];
		nowOn = false;
	} else {
		createCorePanel(team);
		nowOn = true;
	}
	notify('[lightgray]Core HUD [#' + team.color.toString() + ']' + team.name + (nowOn ? ' [green]ON' : ' [scarlet]OFF'));
}

function closeAllPanels() {
	let count = 0;
	for (let id in corePanels) {
		if (corePanels[id] && corePanels[id].table) corePanels[id].table.remove();
		delete corePanels[id];
		count++;
	}
	itemRecorders = {};
	cachedTeamPowerGraphs = {};
	if (count > 0) notify('[lightgray]All HUD panels [scarlet]closed');
	else notify('[lightgray]No HUD panels were open');
}

// ---------------- Settings Dialog ----------------
function openSettingsDialog() {
	let dialog = new BaseDialog('Core & Info HUD Config');
	dialog.addCloseButton();

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

	// 1. Core & Resources Card
	let c1 = createCard('📦 Core & Resources', '73d216');

	c1.check('Show Core Resources Grid', cfg.showCoreItems, (b) => {
		cfg.showCoreItems = b;
		saveCfg();
		for (let id in corePanels) {
			corePanels[id].coreContainer.visible = b;
			corePanels[id].table.pack();
			repositionPanel(corePanels[id]);
		}
	}).pad(3).left().row();

	c1.check('Show +/- Resource Rates (10s avg)', cfg.showRates, (b) => {
		cfg.showRates = b;
		saveCfg();
		for (let id in corePanels) {
			corePanels[id].lastItemsCount = -1;
		}
	}).pad(3).left().row();

	c1.check('Smart Hide (hide empty until stored, red if depleted)', cfg.hideEmpty, (b) => {
		cfg.hideEmpty = b;
		saveCfg();
		for (let id in corePanels) {
			corePanels[id].lastItemsCount = -1;
		}
	}).pad(3).left().row();

	root.row();

	// 2. Power & Construction Card
	let c2 = createCard('⚡ Power & Construction', 'ffd37f');

	c2.check('Show Power & Battery Bar', cfg.showPower, (b) => {
		cfg.showPower = b;
		saveCfg();
		for (let id in corePanels) {
			corePanels[id].powerContainer.visible = b;
			corePanels[id].table.pack();
			repositionPanel(corePanels[id]);
		}
	}).pad(3).left().row();

	c2.check('Split Disconnected Power Grids into separate bars', cfg.splitPower, (b) => {
		cfg.splitPower = b;
		saveCfg();
		for (let id in corePanels) {
			corePanels[id].powerBarCount = -1;
			corePanels[id].table.pack();
			repositionPanel(corePanels[id]);
		}
	}).pad(3).left().row();

	c2.check('Show Build Plan Cost (auto-hides when no plans)', cfg.showBuildCost, (b) => {
		cfg.showBuildCost = b;
		saveCfg();
		for (let id in corePanels) {
			if (!b) corePanels[id].buildContainer.visible = false;
			corePanels[id].table.pack();
			repositionPanel(corePanels[id]);
		}
	}).pad(3).left().row();

	root.row();

	// 3. Layout & Appearance Card (Smooth Interactive Sliders)
	let c3 = createCard('🎨 Layout & Appearance', '84c8ff');

	// Grid Columns slider
	let colLabel = c3.add('[lightgray]Grid Columns: [accent]' + cfg.columns + '[]').growX().left().pad(2).get();
	c3.row();
	c3.slider(2, 8, 1, cfg.columns, (v) => {
		let val = Math.round(v);
		if (val !== cfg.columns) {
			cfg.columns = val;
			colLabel.setText('[lightgray]Grid Columns: [accent]' + val + '[]');
			saveCfg();
			for (let id in corePanels) {
				corePanels[id].lastItemsCount = -1;
			}
		}
	}).growX().padBottom(6).row();

	// UI Scale slider
	let scaleLabel = c3.add('[lightgray]UI Scale: [accent]' + Math.round(cfg.uiScale * 100) + '%[]').growX().left().pad(2).get();
	c3.row();
	c3.slider(0.65, 1.40, 0.05, cfg.uiScale, (v) => {
		let val = Math.round(v * 100) / 100;
		if (Math.abs(val - cfg.uiScale) >= 0.04) {
			cfg.uiScale = val;
			scaleLabel.setText('[lightgray]UI Scale: [accent]' + Math.round(val * 100) + '%[]');
			saveCfg();
			recreateAllPanels();
		}
	}).growX().padBottom(6).row();

	// Background Opacity slider
	let curOp = cfg.bgOpacity !== undefined ? cfg.bgOpacity : 0.85;
	let opLabel = c3.add('[lightgray]BG Opacity: [accent]' + Math.round(curOp * 100) + '%[]').growX().left().pad(2).get();
	c3.row();
	c3.slider(0.30, 1.00, 0.05, curOp, (v) => {
		let val = Math.round(v * 100) / 100;
		cfg.bgOpacity = val;
		opLabel.setText('[lightgray]BG Opacity: [accent]' + Math.round(val * 100) + '%[]');
		saveCfg();
		for (let id in corePanels) {
			corePanels[id].table.setColor(1, 1, 1, val);
		}
	}).growX().padBottom(6).row();

	// Lock dragging
	c3.check('🔒 Lock HUD Positions (prevent accidental drag)', cfg.locked, (b) => {
		cfg.locked = b;
		saveCfg();
	}).pad(3).left().row();

	root.row();

	// 4. Quick Actions Card
	let actCard = root.table(Styles.black6).growX().padBottom(2).get();
	actCard.margin(8);
	let actRow = actCard.table().center().get();

	actRow.button('[#73d216]Enable All Teams[]', Styles.defaultt, () => {
		if (Vars.state && Vars.state.teams) {
			Vars.state.teams.getActive().each((t) => {
				if (t.hasCore() || t.core() != null) {
					if (!corePanels[t.team.id]) createCorePanel(t.team);
				}
			});
		}
		notify('[green]Enabled HUDs for all active teams');
	}).size(160, 36).padRight(8);

	actRow.button('[accent]Reset Positions[]', Styles.defaultt, () => {
		for (let id in corePanels) {
			Core.settings.remove('coreinfo-' + id + '-x');
			Core.settings.remove('coreinfo-' + id + '-y');
			Core.settings.remove('coreinfo-' + id + '-anchorX');
			Core.settings.remove('coreinfo-' + id + '-anchorY');
			Core.settings.remove('coreinfo-' + id + '-offsetX');
			Core.settings.remove('coreinfo-' + id + '-offsetY');
		}
		recreateAllPanels();
		notify('[lightgray]HUD positions reset');
	}).size(150, 36).padRight(8);

	actRow.button('[#ff5555]Close All HUDs[]', Styles.defaultt, () => {
		closeAllPanels();
	}).size(150, 36);

	root.row();

	let pane = new ScrollPane(root);
	pane.setScrollingDisabled(true, false);
	pane.setOverscroll(false, true);

	let dw = Math.min(Core.scene.getWidth() * 0.90, 680);
	let dh = Math.min(Core.scene.getHeight() * 0.85, 520);
	dialog.cont.add(pane).width(dw).height(dh);
	dialog.show();
}

// ---------------- Lifecycle & Update Loop ----------------
const initUI = () => {
	if (setup || !Vars.ui || !Vars.ui.hudGroup) return;
	setup = true;
	cachedAllItems = null;
	if (Vars.player && Vars.player.team()) {
		createCorePanel(Vars.player.team());
	}
};

if (Vars.ui && Vars.ui.hudGroup) initUI();
else Events.on(ClientLoadEvent, initUI);

Events.on(WorldLoadEvent, () => {
	for (let id in corePanels) {
		if (corePanels[id] && corePanels[id].table) corePanels[id].table.remove();
	}
	corePanels = {};
	itemRecorders = {};
	usedItems = {};
	cachedAllItems = null;
	cachedTeamPowerGraphs = {};
	setup = false;
	secondTicker = 0;
	powerScanTicker = 0;
	initUI();
});

// Interceptor: ONLY !core, !core <team>, !core all, !core clear
interceptor.add('core', (args) => {
	let sub = args[1] ? args[1].toLowerCase() : '';

	if (!sub || sub === 's' || sub === 'settings' || sub === 'menu' || sub === 'ui' || sub === 'config') {
		openSettingsDialog();
		return;
	}

	if (sub === 'clear' || sub === 'close' || sub === 'hide' || sub === 'c' || sub === 'off') {
		closeAllPanels();
		return;
	}

	if (sub === 'all') {
		let teamsWithCores = {};
		Vars.state.teams.getActive().each((t) => {
			if (t.hasCore() || t.core() != null) {
				teamsWithCores[t.team.id] = true;
				if (!corePanels[t.team.id]) createCorePanel(t.team);
			}
		});
		for (let id in corePanels) {
			if (!teamsWithCores[id]) {
				corePanels[id].table.remove();
				delete corePanels[id];
			}
		}
		notify('[lightgray]Core info enabled for [green]all active cores');
		return;
	}

	let found = null;
	Vars.state.teams.getActive().each((t) => {
		if (t.team.name.toLowerCase().includes(sub)) found = t.team;
	});
	if (!found) {
		let id = parseInt(sub);
		if (!isNaN(id) && id >= 0 && id < 256) found = Team.get(id);
	}
	if (found) {
		toggleCorePanel(found);
	} else {
		notify('[scarlet]Unknown command or team: [white]' + args[1] + '[lightgray]. Type !core for UI');
	}
});

Events.run(Trigger.update, () => {
	if (!setup) return;
	let isGame = Vars.state.isGame() && Vars.ui.hudfrag && Vars.ui.hudfrag.shown;

	let curSw = Core.scene.getWidth();
	let curSh = Core.scene.getHeight();
	let screenResized = (curSw !== lastScreenWidth || curSh !== lastScreenHeight);
	if (screenResized) {
		lastScreenWidth = curSw;
		lastScreenHeight = curSh;
	}

	timer += Time.delta;
	let doUpdate = timer >= 2; // Refresh UI numbers and power stats live every ~2 ticks
	if (doUpdate) timer = 0;

	// Record item samples once per second (60 ticks)
	secondTicker += Time.delta;
	if (secondTicker >= 60) {
		secondTicker = 0;
		if (isGame && Vars.state.teams) {
			let allItems = getAllItemsList();
			let allLen = allItems.length;

			Vars.state.teams.getActive().each((tData) => {
				let team = tData.team;
				let core = tData.core();
				if (core && core.items) {
					for (let i = 0; i < allLen; i++) {
						let item = allItems[i];
						let amt = core.items.get(item);
						recordItemTick(team.id, item.id, amt);
					}
				}
			});
		}
	}

	for (let id in corePanels) {
		let p = corePanels[id];
		if (!isGame) {
			p.table.visible = false;
			continue;
		}
		p.table.visible = true;

		// Only run repositionPanel if screen resized or panel was marked dirty
		if (screenResized) {
			repositionPanel(p);
		}

		if (doUpdate) {
			let teamData = Vars.state.teams ? Vars.state.teams.get(p.team) : null;
			let core = teamData ? teamData.core() : null;
			let possible = getPossibleItems(p.team);
			let possibleLen = possible.length;
			let isLocalPlayerTeam = Vars.player && Vars.player.team() && p.team.id === Vars.player.team().id;

			// Rebuild item grid if items count changed
			if (possibleLen !== p.lastItemsCount) {
				p.lastItemsCount = possibleLen;
				rebuildItemGrid(p, possible);
			}

			// Update Item amounts and bottom-right Rate overlay
			if (cfg.showCoreItems && core && core.items) {
				for (let i = 0; i < possibleLen; i++) {
					let item = possible[i];
					let cellInfo = p.itemCells[item.id];
					if (!cellInfo) continue;

					let amt = core.items.get(item);

					// Track used items if amt > 0
					if (amt > 0) {
						if (!usedItems[p.team.id]) usedItems[p.team.id] = {};
						if (!usedItems[p.team.id][item.id]) {
							usedItems[p.team.id][item.id] = true;
							p.lastItemsCount = -1; // triggers rebuild
						}
					}

					if (amt !== cellInfo.lastAmt) {
						if (amt === 0) {
							// Highlight red when resource is 0 but was previously stored!
							cellInfo.amtLabel.setText('[#ff4444]0[]');
						} else {
							cellInfo.amtLabel.setText(formatNum(amt));
						}
						cellInfo.lastAmt = amt;
					}

					let rate = cfg.showRates ? getItemDeltaRate(p.team.id, item.id) : 0;
					let rateStr = cfg.showRates ? formatRate(rate) : '';
					if (rateStr !== cellInfo.lastRateStr) {
						cellInfo.rateLabel.setText(rateStr);
						cellInfo.lastRateStr = rateStr;
					}
				}
			}

			// Power & Battery section (Bar + centered balance + optional split) - Instant Real-Time
			if (cfg.showPower) {
				p.powerContainer.visible = true;
				let powerInfo = getTeamPowerInfo(p.team);
				updatePowerContainer(p, powerInfo);
			} else {
				p.powerContainer.visible = false;
			}

			// Build Plan section (ONLY for player team and ONLY if plans exist)
			if (cfg.showBuildCost && isLocalPlayerTeam) {
				let buildInfo = getPlayerBuildPlanCosts();
				if (!buildInfo || buildInfo.totalPlans === 0) {
					if (p.buildContainer.visible) {
						p.buildContainer.visible = false;
						p.buildGrid.clearChildren();
						p.lastBuildFp = 'none';
						p.table.pack();
						repositionPanel(p);
					}
				} else {
					if (!p.buildContainer.visible) {
						p.buildContainer.visible = true;
						p.table.pack();
						repositionPanel(p);
					}
					let fp = buildInfo.totalPlans + ':' + buildInfo.estSeconds.toFixed(1) + ':' + buildInfo.totalSpeed.toFixed(1) + ':' + buildInfo.costsCount;
					if (p.lastBuildFp !== fp) {
						p.lastBuildFp = fp;
						renderBuildPlanGrid(p.buildGrid, p.buildTitle, buildInfo, core);
						p.table.pack();
						repositionPanel(p);
					}
				}
			} else {
				p.buildContainer.visible = false;
			}
		}
	}
});
