const notify = require('qol-control/core/logger').notify;
const interceptor = require('qol-control/core/interceptor');

let setup = false;
let panels = {};
let timer = 0;

const SNAP_DIST = 25;

const formatNum = (n) => {
	let num = Number(n);
	let abs = Math.abs(num);
	if (abs >= 1000000) return Math.round(num / 100000) / 10 + 'm';
	if (abs >= 1000) return Math.round(num / 100) / 10 + 'k';
	return Math.floor(num).toString();
};

function getPossibleItems(team) {
	let teamData = Vars.state.teams ? Vars.state.teams.get(team) : null;
	let core = teamData ? teamData.core() : null;
	let hidden =
		Vars.state.rules && Vars.state.rules.hiddenBuildItems
			? Vars.state.rules.hiddenBuildItems
			: null;
	let isCamp =
		Vars.state.isCampaign && typeof Vars.state.isCampaign === 'function'
			? Vars.state.isCampaign()
			: false;

	let items = [];
	let seen = {};

	Vars.content.items().each(
		cons((item) => {
			if (!item || item.hidden) return;
			if (hidden && hidden.contains(item)) return;
			if (isCamp && !item.unlockedNow()) return;

			items.push(item);
			seen[item.id] = true;
		})
	);

	if (core && core.items) {
		Vars.content.items().each(
			cons((item) => {
				if (!item) return;
				if (!seen[item.id] && core.items.get(item) > 0) {
					items.push(item);
					seen[item.id] = true;
				}
			})
		);
	}

	return items;
}

function computeDimensions(itemCount) {
	let count = Math.max(1, itemCount);
	let width = 210;
	let itemsPerLine = 3.2;

	if (count > 20) {
		width = 280;
		itemsPerLine = 4.5;
	}

	let lines = Math.ceil(count / itemsPerLine);
	// 20px header, 18px per item line, 8px padding
	let height = Math.ceil(20 + lines * 18 + 8);

	let maxH = Core.scene ? Core.scene.getHeight() * 0.7 : 400;
	if (height > maxH) height = maxH;

	return { width: width, height: height };
}

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

function savePanelPosition(pData, teamId) {
	Core.settings.put('coreinfo-x-' + teamId, new java.lang.Float(pData.btnX));
	Core.settings.put('coreinfo-y-' + teamId, new java.lang.Float(pData.btnY));
	Core.settings.put('coreinfo-anchorX-' + teamId, pData.anchorX);
	Core.settings.put('coreinfo-anchorY-' + teamId, pData.anchorY);
	Core.settings.put(
		'coreinfo-offsetX-' + teamId,
		new java.lang.Float(pData.offsetX)
	);
	Core.settings.put(
		'coreinfo-offsetY-' + teamId,
		new java.lang.Float(pData.offsetY)
	);
	if (typeof Core.settings.forceSave === 'function') {
		Core.settings.forceSave();
	}
}

function repositionPanel(pData) {
	if (pData.isDragging) return;

	let sw = Core.scene.getWidth();
	let sh = Core.scene.getHeight();
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

function togglePanel(team) {
	if (panels[team.id]) {
		panels[team.id].table.remove();
		delete panels[team.id];
		notify(
			'[lightgray]Core info [#' +
				team.color.toString() +
				']' +
				team.name +
				' [scarlet]OFF'
		);
	} else {
		createPanel(team);
		notify(
			'[lightgray]Core info [#' +
				team.color.toString() +
				']' +
				team.name +
				' [green]ON'
		);
	}
}

function createPanel(team) {
	if (!Vars.ui || !Vars.ui.hudGroup) return;

	let possible = getPossibleItems(team);
	let dims = computeDimensions(possible.length);

	let table = new Table(Styles.black5);
	table.margin(4);
	table.touchable = Packages.arc.scene.event.Touchable.enabled;

	let label = new Label('');
	label.setWrap(true);
	label.setAlignment(Packages.arc.util.Align.topLeft);
	label.setFontScale(0.9);

	let cell = table.add(label).width(dims.width).height(dims.height);
	cell.top().left();
	table.pack();

	Vars.ui.hudGroup.addChild(table);

	let tw = table.getWidth();
	let th = table.getHeight();
	let sw = Core.scene.getWidth();
	let sh = Core.scene.getHeight();

	let defaultX = 15;
	let defaultY = 250 - Object.keys(panels).length * 60;

	let sx = Core.settings.getFloat('coreinfo-x-' + team.id, defaultX);
	let sy = Core.settings.getFloat('coreinfo-y-' + team.id, defaultY);
	let anchorX = Core.settings.getString('coreinfo-anchorX-' + team.id, '');
	let anchorY = Core.settings.getString('coreinfo-anchorY-' + team.id, '');
	let offsetX = Core.settings.getFloat('coreinfo-offsetX-' + team.id, -1);
	let offsetY = Core.settings.getFloat('coreinfo-offsetY-' + team.id, -1);

	if (!anchorX) {
		if (sx <= SNAP_DIST) {
			anchorX = 'left';
			offsetX = 0;
		} else if (sw - (sx + tw) <= SNAP_DIST) {
			anchorX = 'right';
			offsetX = 0;
		} else {
			anchorX = 'free';
			offsetX = sx;
		}
	}
	if (!anchorY) {
		if (sh - (sy + th) <= SNAP_DIST) {
			anchorY = 'top';
			offsetY = 0;
		} else if (sy <= SNAP_DIST) {
			anchorY = 'bottom';
			offsetY = 0;
		} else {
			anchorY = 'free';
			offsetY = sy;
		}
	}
	if (offsetX < 0) offsetX = sx;
	if (offsetY < 0) offsetY = sy;

	let pData = {
		table: table,
		cell: cell,
		label: label,
		team: team,
		lastText: '',
		btnX: sx,
		btnY: sy,
		anchorX: anchorX,
		anchorY: anchorY,
		offsetX: offsetX,
		offsetY: offsetY,
		isDragging: false,
		startX: 0,
		startY: 0,
		dragStageOffsetX: 0,
		dragStageOffsetY: 0,
		lastItemCount: possible.length,
		staticWidth: dims.width,
		staticHeight: dims.height,
	};

	let listener = extend(InputListener, {
		touchDown(event, x, y, pointer, button) {
			pData.isDragging = false;
			pData.startX = x;
			pData.startY = y;
			pData.dragStageOffsetX = event.stageX - pData.btnX;
			pData.dragStageOffsetY = event.stageY - pData.btnY;
			return true;
		},
		touchDragged(event, x, y, pointer) {
			if (
				!pData.isDragging &&
				(Math.abs(x - pData.startX) > 4 || Math.abs(y - pData.startY) > 4)
			) {
				pData.isDragging = true;
			}
			if (pData.isDragging) {
				let targetX = event.stageX - pData.dragStageOffsetX;
				let targetY = event.stageY - pData.dragStageOffsetY;
				applyDragWithSnapping(pData, targetX, targetY);
			}
			return true;
		},
		touchUp(event, x, y, pointer) {
			if (pData.isDragging) {
				savePanelPosition(pData, team.id);
				Timer.schedule(
					run(() => {
						pData.isDragging = false;
					}),
					0.1
				);
			} else {
				pData.isDragging = false;
			}
			return true;
		},
	});
	table.addListener(listener);
	pData.dragListener = listener;

	repositionPanel(pData);
	panels[team.id] = pData;
}

const initUI = () => {
	if (setup || !Vars.ui || !Vars.ui.hudGroup) return;
	setup = true;
	createPanel(Vars.player.team());
};

if (Vars.ui && Vars.ui.hudGroup) initUI();
else Events.on(ClientLoadEvent, initUI);

Events.on(WorldLoadEvent, () => {
	for (let id in panels) {
		panels[id].table.remove();
	}
	panels = {};
	setup = false;
	initUI();
});

interceptor.add('core', (args) => {
	if (args[1]) {
		let search = args[1].toLowerCase();
		if (search === 'all') {
			let teamsWithCores = {};
			Vars.state.teams.getActive().each((t) => {
				if (t.hasCore() || t.core() != null) {
					teamsWithCores[t.team.id] = true;
					if (!panels[t.team.id]) {
						createPanel(t.team);
					}
				}
			});
			for (let id in panels) {
				if (!teamsWithCores[id]) {
					panels[id].table.remove();
					delete panels[id];
				}
			}
			notify('[lightgray]Core info enabled for [green]all active cores');
			return;
		}
		let found = null;
		Vars.state.teams.getActive().each((t) => {
			if (t.team.name.toLowerCase().includes(search)) found = t.team;
		});
		if (!found) {
			let id = parseInt(search);
			if (!isNaN(id) && id >= 0 && id < 256) found = Team.get(id);
		}
		if (found) {
			togglePanel(found);
		} else {
			notify('[scarlet]Team [white]' + args[1] + ' [scarlet]not found');
		}
	} else {
		togglePanel(Vars.player.team());
	}
});

Events.run(Trigger.update, () => {
	if (!setup) return;

	let isGame =
		Vars.state.isGame() && Vars.ui.hudfrag && Vars.ui.hudfrag.shown;

	timer += Time.delta;
	let doUpdate = timer > 10;
	if (doUpdate) timer = 0;

	for (let id in panels) {
		let p = panels[id];

		if (!isGame) {
			p.table.visible = false;
			continue;
		}

		p.table.visible = true;
		repositionPanel(p);

		if (doUpdate) {
			let teamData = Vars.state.teams ? Vars.state.teams.get(p.team) : null;
			let core = teamData ? teamData.core() : null;

			let possible = getPossibleItems(p.team);
			if (possible.length !== p.lastItemCount) {
				p.lastItemCount = possible.length;
				let dims = computeDimensions(possible.length);
				p.staticWidth = dims.width;
				p.staticHeight = dims.height;
				p.cell.width(dims.width).height(dims.height);
				p.table.pack();
				repositionPanel(p);
			}

			let text =
				'[#' +
				p.team.color.toString() +
				']' +
				p.team.name +
				' Core[white]\n';

			if (core && core.items != null) {
				let itemStr = '';
				Vars.content.items().each(
					cons((item) => {
						let amt = core.items.get(item);
						if (amt > 0)
							itemStr += item.emoji() + formatNum(amt) + ' ';
					})
				);
				if (itemStr !== '') text += itemStr;
				else text += '[lightgray]Empty';
			} else {
				text += '[scarlet]No Core';
			}

			if (p.lastText !== text) {
				p.label.setText(text);
				p.lastText = text;
				p.table.pack();
			}
		}
	}
});
