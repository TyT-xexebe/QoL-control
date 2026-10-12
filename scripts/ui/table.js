const uiUtils = require('qol-control/ui/utils');
const notify = require('qol-control/core/logger').notify;
const interceptor = require('qol-control/core/interceptor');

var cfg = {
	rows: Core.settings.getInt('qol-schem-rows', 4),
	cols: Core.settings.getInt('qol-schem-cols', 4),
	size: Core.settings.getInt('qol-schem-size', 32),
	enabled: Core.settings.getBool('qol-schem-enabled', false),
	slots: {},
};

try {
	cfg.slots = JSON.parse(Core.settings.getString('qol-schem-slots', '{}'));
} catch (e) {
	cfg.slots = {};
}

var saveCfg = () => {
	Core.settings.put('qol-schem-rows', new java.lang.Integer(cfg.rows));
	Core.settings.put('qol-schem-cols', new java.lang.Integer(cfg.cols));
	Core.settings.put('qol-schem-size', new java.lang.Integer(cfg.size));
	Core.settings.put('qol-schem-enabled', new java.lang.Boolean(cfg.enabled));
	Core.settings.put('qol-schem-slots', JSON.stringify(cfg.slots));
};

var getIcon = (name, typeStr) => {
	if (!name) return Icon.add.getRegion();

	if (typeStr && ContentType[typeStr]) {
		let c = Vars.content.getByName(ContentType[typeStr], name);
		if (c) return c.uiIcon;
	}

	let c =
		Vars.content.getByName(ContentType.block, name) ||
		Vars.content.getByName(ContentType.item, name) ||
		Vars.content.getByName(ContentType.liquid, name) ||
		Vars.content.getByName(ContentType.unit, name);
	return c ? c.uiIcon : Icon.add.getRegion();
};

Events.on(EventType.ClientLoadEvent, (e) => {
	let allIcons = [];

	Vars.content.getBy(ContentType.block).each((c) => {
		if (
			c.uiIcon &&
			c.uiIcon !== Core.atlas.find('error') &&
			c.uiIcon !== Core.atlas.find('clear')
		) {
			allIcons.push({
				name: String(c.name),
				type: 'block',
				icon: c.uiIcon,
				order: c.category ? c.category.ordinal() * 100 : 0,
			});
		}
	});

	const addIcons = (type, typeStr, typeOrder) => {
		Vars.content.getBy(type).each((c) => {
			if (
				c.uiIcon &&
				c.uiIcon !== Core.atlas.find('error') &&
				c.uiIcon !== Core.atlas.find('clear')
			) {
				allIcons.push({
					name: String(c.name),
					type: typeStr,
					icon: c.uiIcon,
					order: typeOrder,
				});
			}
		});
	};

	addIcons(ContentType.item, 'item', 10000);
	addIcons(ContentType.liquid, 'liquid', 10001);
	addIcons(ContentType.unit, 'unit', 10002);
	allIcons.sort((a, b) =>
		a.order !== b.order ? a.order - b.order : a.name.localeCompare(b.name)
	);

	let uiTable = new Table(Styles.black5);
	uiTable.margin(0);
	let gridTable = new Table();
	gridTable.margin(0);
	uiTable.add(gridTable);

	let dragHandler = null,
		lastClickTime = 0,
		lastClickSlot = -1;

	let getStageW = () => uiUtils.stageWidth();
	let getStageH = () => uiUtils.stageHeight();

	// -----------------------------------------------------------------------
	// Slot drag & drop: Shift + LEFT mouse
	//
	// The panel is moved with the RIGHT button (uiUtils.isDragButton), so LMB is
	// a completely separate channel and the two gestures cannot collide — no
	// event-order tricks, no vetoes. RMB keeps moving the panel everywhere,
	// including on top of a filled slot, exactly as it always did.
	//
	// The button's own ClickListener reads `button === KeyCode.mouseLeft` from
	// the constructor (verified against Mindustry.jar), so a Shift+LMB press also
	// reaches this listener. It does not swallow our gesture; both listeners are
	// notified, and ClickListener's clicked() only fires when the pointer stayed
	// inside its 14px tap square — our drag threshold is smaller, so the button
	// callback additionally ignores anything while a drag is in progress.
	// -----------------------------------------------------------------------
	let slotButtons = [];
	const iconDrag = {
		active: false, // right button is down on an occupied slot
		moving: false, // the pointer actually travelled, so the icon is lifted
		fromIdx: -1,
		hoverIdx: -1,
		ghost: null,
		startStageX: 0,
		startStageY: 0,
	};

	// Shift held = the icon is dragged instead of the schematic being placed.
	const panelModifierHeld = () => {
		try {
			const KC = Packages.arc.input.KeyCode;
			return Core.input.keyDown(KC.shiftLeft) || Core.input.keyDown(KC.shiftRight);
		} catch (e) {
			return false;
		}
	};

	// ImageButton keeps the icon in a child Image; that child is what gets
	// tinted for the drop highlight and dimmed while its icon is in the air.
	const iconImage = (btn) => {
		try {
			if (btn && typeof btn.getImage === 'function') return btn.getImage();
		} catch (e) {}
		return null;
	};

	const tintSlot = (idx, r, g, b, a) => {
		let img = iconImage(slotButtons[idx]);
		if (img) img.color.set(r, g, b, a);
	};

	const dropGhost = () => {
		if (!iconDrag.ghost) return;
		try {
			iconDrag.ghost.remove();
		} catch (e) {}
		iconDrag.ghost = null;
	};

	const clearHover = () => {
		if (iconDrag.hoverIdx >= 0) tintSlot(iconDrag.hoverIdx, 1, 1, 1, 1);
		iconDrag.hoverIdx = -1;
	};

	const setHover = (idx) => {
		if (idx === iconDrag.hoverIdx) return;
		clearHover();
		iconDrag.hoverIdx = idx;
		if (idx >= 0) tintSlot(idx, 0.6, 1, 0.6, 1);
	};

	const cancelIconDrag = () => {
		clearHover();
		dropGhost();
		iconDrag.active = false;
		iconDrag.moving = false;
		iconDrag.fromIdx = -1;
	};

	// Which slot is under a stage point.
	//
	// The scene's own hit test decides, not hand-rolled math: arc lays elements out
	// through its own transform chain, and Core.scene.hit() is the one
	// implementation guaranteed to agree with what the input system considers
	// "under the cursor". A manual localToStageCoordinates pass was tried first
	// and returned wrong rectangles inside hudGroup — the debug log caught it:
	// hit correct, rect -1 for almost every slot. hit() yields the deepest element,
	// which is the button's icon Image, so the parent chain is walked up to the
	// button. If nothing matches, no slot is reported and the drop is discarded.
	const slotAt = (stageX, stageY) => {
		try {
			let e = Core.scene.hit(stageX, stageY, true);
			while (e) {
				for (let i = 0; i < slotButtons.length; i++) {
					if (slotButtons[i] === e) return i;
				}
				e = e.parent;
			}
		} catch (err) {}
		return -1;
	};

	const liftIcon = (idx, stageX, stageY) => {
		const slot = cfg.slots[idx];
		if (!slot) return;
		dropGhost();
		const size = Math.max(8, cfg.size - 8);
		const ghost = new Packages.arc.scene.ui.Image(
			new TextureRegionDrawable(getIcon(slot.icon, slot.type))
		);
		ghost.setSize(size);
		ghost.setPosition(stageX - size / 2, stageY - size / 2);
		ghost.color.a = 0.75;
		// The ghost must never eat input: the gesture has to stay on the button.
		ghost.touchable = Packages.arc.scene.event.Touchable.disabled;
		Vars.ui.hudGroup.addChild(ghost);
		iconDrag.ghost = ghost;
		tintSlot(idx, 1, 1, 1, 0.35);
	};

	// Empty target: the icon moves. Occupied target: the two swap. Dropped
	// anywhere outside the grid nothing is touched — no write, no save.
	const commitDrop = (from, to) => {
		if (from < 0 || to < 0 || from === to) return;
		const src = cfg.slots[from];
		if (!src) return;
		const dst = cfg.slots[to];
		if (dst) {
			cfg.slots[from] = dst;
			cfg.slots[to] = src;
		} else {
			cfg.slots[to] = src;
			delete cfg.slots[from];
		}
		saveCfg();
		// Deferred on purpose: rebuildGrid() destroys the very button whose
		// listener is mid-call right now. One tick later the gesture is fully
		// unwound and the grid can be torn down safely.
		Time.run(1, run(() => rebuildGrid()));
	};

	// Single source of truth for "does this press grab an icon?".
	const grabTargetAt = (stageX, stageY) => {
		if (Vars.mobile) return -1;
		const idx = slotAt(stageX, stageY);
		if (idx < 0) return -1;
		const slot = cfg.slots[idx];
		// A slot can carry an icon without a schematic bound to it yet; those
		// are worth rearranging too, so accept either.
		if (!slot || (!slot.schem && !slot.icon)) return -1;
		return idx;
	};

	const makeSlotListener = (idx) =>
		extend(InputListener, {
			touchDown(event, x, y, pointer, button) {
				// Shift + LEFT mouse only. RMB belongs to the panel drag, so the
				// two gestures never compete for the same press.
				if (button !== Packages.arc.input.KeyCode.mouseLeft) return false;
				if (!panelModifierHeld()) return false;
				if (grabTargetAt(event.stageX, event.stageY) !== idx) return false;
				iconDrag.active = true;
				iconDrag.moving = false;
				iconDrag.fromIdx = idx;
				iconDrag.startStageX = event.stageX;
				iconDrag.startStageY = event.stageY;
				return true;
			},
			touchDragged(event, x, y, pointer) {
				if (!iconDrag.active) return false;
				if (!iconDrag.moving) {
					if (
						Math.abs(event.stageX - iconDrag.startStageX) > 4 ||
						Math.abs(event.stageY - iconDrag.startStageY) > 4
					) {
						iconDrag.moving = true;
						liftIcon(iconDrag.fromIdx, event.stageX, event.stageY);
					}
				}
				if (iconDrag.moving && iconDrag.ghost) {
					const size = iconDrag.ghost.getWidth();
					iconDrag.ghost.setPosition(
						event.stageX - size / 2,
						event.stageY - size / 2
					);
					setHover(slotAt(event.stageX, event.stageY));
				}
				return true;
			},
			touchUp(event, x, y, pointer) {
				if (!iconDrag.active) return false;
				const wasMoving = iconDrag.moving;
				const from = iconDrag.fromIdx;
				const to = wasMoving ? slotAt(event.stageX, event.stageY) : -1;
				if (wasMoving && from >= 0) tintSlot(from, 1, 1, 1, 1);
				cancelIconDrag();
				if (wasMoving) {
					// A drop is not a click: keep the double-click handler in the
					// button callback from firing off this gesture.
					lastClickTime = 0;
					lastClickSlot = -1;
					if (dragHandler && dragHandler.state)
						dragHandler.state.isDragging = false;
					commitDrop(from, to);
				}
				return true;
			},
		});

	let tableX = 0;
	let tableY = 0;

	const openConfig = (idx) => {
		let dialog = new BaseDialog('');
		dialog.addCloseButton();
		let slot = cfg.slots[idx] || { schem: '', icon: null, type: null };
		let currentSchem = slot.schem;
		let currentIconName = slot.icon;
		let currentIconType = slot.type;

		let t = new Table();
		t.add('Schematic: ').padRight(8);
		t.field(currentSchem, (s) => {
			currentSchem = s;
		}).width(300);
		dialog.cont.add(t).row();

		let iconPane = new Table();
		let colsCount = 0;
		for (let i = 0; i < allIcons.length; i++) {
			let ic = allIcons[i];
			iconPane
				.button(
					new TextureRegionDrawable(ic.icon),
					Styles.clearNonei,
					32,
					() => {
						currentIconName = ic.name;
						currentIconType = ic.type;
						dialog.title.setText(ic.name);
					}
				)
				.size(40);
			if (++colsCount % 10 === 0) iconPane.row();
		}

		dialog.cont
			.add(new ScrollPane(iconPane))
			.size(520, 300)
			.padTop(10)
			.row();

		dialog.buttons
			.button('@ok', Icon.ok, () => {
				cfg.slots[idx] = {
					schem: currentSchem,
					icon: currentIconName,
					type: currentIconType,
				};
				saveCfg();
				rebuildGrid();
				dialog.hide();
			})
			.size(150, 50);

		dialog.buttons
			.button('@cancel', Icon.cancel, () => {
				delete cfg.slots[idx];
				saveCfg();
				rebuildGrid();
				dialog.hide();
			})
			.size(150, 50);

		dialog.show();
	};

	const rebuildGrid = () => {
		// A rebuild destroys the buttons an in-flight drag is holding on to.
		cancelIconDrag();
		gridTable.clear();
		slotButtons = [];
		let iconSize = Math.max(8, cfg.size - 8);
		for (let r = 0; r < cfg.rows; r++) {
			for (let c = 0; c < cfg.cols; c++) {
				let idx = r * cfg.cols + c;
				let slot = cfg.slots[idx];
				let btn = gridTable
					.button(
						new TextureRegionDrawable(
							getIcon(
								slot ? slot.icon : null,
								slot ? slot.type : null
							)
						),
						Styles.clearNonei,
						iconSize,
						() => {
							if (dragHandler && dragHandler.state.isDragging)
								return;
							// A Shift+LMB drag ends with a click callback if the
							// pointer stayed inside the button's tap square, and
							// ClickListener runs before this listener's touchUp —
							// so the icon drag is still flagged as active here.
							if (iconDrag.active || iconDrag.moving) return;
							let time = Time.millis();
							if (
								time - lastClickTime < 300 &&
								lastClickSlot === idx
							)
								openConfig(idx);
							else if (slot && slot.schem) {
								let s = Vars.schematics
									.all()
									.find(
										(sc) => String(sc.name()) === slot.schem
									);
								if (s) Vars.control.input.useSchematic(s);
								else
									notify(
										'[scarlet]Schematic not found: ' +
											slot.schem
									);
							}
							lastClickTime = time;
							lastClickSlot = idx;
						}
					)
					.size(cfg.size)
					.get();
				btn.addListener(makeSlotListener(idx));
				slotButtons[idx] = btn;
			}
			gridTable.row();
		}
		uiTable.pack();
	};

	interceptor.add('table', (args) => {
		let sub = args[1] ? args[1].toLowerCase() : '';
		let val = args[2] ? parseInt(args[2]) : 0;

		if (sub === 'rows' && val > 0) {
			cfg.rows = val;
			saveCfg();
			rebuildGrid();
			notify('[lightgray]Rows set to [accent]' + val);
		} else if (sub === 'cols' && val > 0) {
			cfg.cols = val;
			saveCfg();
			rebuildGrid();
			notify('[lightgray]Columns set to [accent]' + val);
		} else if (sub === 'size' && val > 0) {
			cfg.size = val;
			saveCfg();
			rebuildGrid();
			notify('[lightgray]Size set to [accent]' + val);
		} else if (sub === 'reset') {
			cfg.rows = 4;
			cfg.cols = 4;
			cfg.size = 32;
			cfg.slots = {};
			saveCfg();
			rebuildGrid();
			let sw = getStageW();
			let sh = getStageH();
			tableX = Math.max(0, (sw - uiTable.getWidth()) / 2);
			tableY = Math.max(0, (sh - uiTable.getHeight()) / 2);
			if (dragHandler && dragHandler.state) {
				dragHandler.state.anchorX = 'free';
				dragHandler.state.anchorY = 'free';
				dragHandler.state.offsetX = tableX;
				dragHandler.state.offsetY = tableY;
				dragHandler.state.isDragging = false;
				dragHandler.persist();
			} else {
				Core.settings.put('qol-schem-x', new java.lang.Float(tableX));
				Core.settings.put('qol-schem-y', new java.lang.Float(tableY));
			}
			uiTable.setPosition(tableX, tableY);
			notify('[lightgray]Table [green]RESET');
		} else if (sub === 'help') {
			notify(
				'[lightgray]!table\n!table <1/0?>\n!table rows <val>\n!table cols <val>\n!table size <val>\n!table reset\n\n[accent]Shift+LMB[] on a filled slot — drag the icon: drop on an empty slot to move it, on another icon to swap. Drop outside to cancel.\n[accent]RMB[] — moves the whole panel (anywhere, as before).\nLMB / double click — place schematic / open the slot config.'
			);
		} else {
			if (sub && !interceptor.isBooleanArg(sub)) {
				notify(
					'[scarlet]Unknown command option\n[lightgray]!table <1/0?> or !table rows/cols/size/reset'
				);
				return;
			}
			cfg.enabled = interceptor.parseToggle(cfg.enabled, args[1]);
			saveCfg();
			notify(
				'[lightgray]Table ' +
					(cfg.enabled ? '[green]ON' : '[scarlet]OFF')
			);
		}
	});

	rebuildGrid();
	Vars.ui.hudGroup.addChild(uiTable);

	let initSw = getStageW();
	let initSh = getStageH();
	// Saved values are passed through untouched: clamping them here used to
	// become the new "saved" position, so every resize crept the table inward.
	tableX = Core.settings.getFloat(
		'qol-schem-x',
		(initSw - uiTable.getWidth()) / 2
	);
	tableY = Core.settings.getFloat(
		'qol-schem-y',
		(initSh - uiTable.getHeight()) / 2
	);

	dragHandler = uiUtils.setupDrag(
		'qol-schem-x',
		'qol-schem-y',
		tableX,
		tableY,
		(x, y) => {
			tableX = x;
			tableY = y;
			uiTable.setPosition(tableX, tableY);
		}
	);
	dragHandler.attach(uiTable);

	Events.run(Trigger.update, () => {
		uiTable.visible =
			cfg.enabled && Vars.state.isGame() && Vars.ui.hudfrag.shown;
		if (!uiTable.visible) return;
		if (dragHandler && dragHandler.state && dragHandler.state.isDragging)
			return;
		// Recomputed from anchor + offset; nothing is written back, so repeated
		// resizes stay idempotent.
		dragHandler.recompute();
		tableX = dragHandler.state.x;
		tableY = dragHandler.state.y;
	});
});
