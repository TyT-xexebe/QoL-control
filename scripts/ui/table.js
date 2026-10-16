
const uiUtils = require('qol-control/ui/utils');
const logger = require('qol-control/core/logger');
const notify = logger.notify;
const interceptor = require('qol-control/core/interceptor');

// Hover preview geometry. PREVIEW_BASE_PX is the 100% size of the square the
// schematic thumbnail is scaled into; cfg.previewScale is a percentage of it.
const PREVIEW_BASE_PX = 184;
const PREVIEW_SCALE_MIN = 50;
const PREVIEW_SCALE_MAX = 300;

var cfg = {
	rows: Core.settings.getInt('qol-schem-rows', 4),
	cols: Core.settings.getInt('qol-schem-cols', 4),
	size: Core.settings.getInt('qol-schem-size', 32),
	enabled: Core.settings.getBool('qol-schem-enabled', false),
	preview: Core.settings.getBool('qol-schem-preview', true),
	previewScale: Core.settings.getInt('qol-schem-preview-scale', 100),
	slots: {},
};

// Guard against a hand-edited settings file: the tooltip must never be built
// with a zero or absurd size.
if (!(cfg.previewScale >= PREVIEW_SCALE_MIN)) cfg.previewScale = 100;
if (cfg.previewScale > PREVIEW_SCALE_MAX) cfg.previewScale = PREVIEW_SCALE_MAX;

try {
	cfg.slots = JSON.parse(Core.settings.getString('qol-schem-slots', '{}'));
} catch (e) {
	cfg.slots = {};
}

// The settings window needs the live HUD table, so it is defined inside the
// client-load closure below. The registry is filled at module scope (before
// that closure runs) and gets this forwarder instead of the real function.
let tableSettingsOpener = null;

var saveCfg = () => {
	Core.settings.put('qol-schem-rows', new java.lang.Integer(cfg.rows));
	Core.settings.put('qol-schem-cols', new java.lang.Integer(cfg.cols));
	Core.settings.put('qol-schem-size', new java.lang.Integer(cfg.size));
	Core.settings.put('qol-schem-enabled', new java.lang.Boolean(cfg.enabled));
	Core.settings.put('qol-schem-preview', new java.lang.Boolean(cfg.preview));
	Core.settings.put(
		'qol-schem-preview-scale',
		new java.lang.Integer(cfg.previewScale)
	);
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
	// -----------------------------------------------------------------------
	let slotButtons = [];

	const iconDrag = {
		active: false,
		moving: false,
		fromIdx: -1,
		hoverIdx: -1,
		ghost: null,
		startStageX: 0,
		startStageY: 0,
	};

	const panelModifierHeld = () => {
		try {
			const KC = Packages.arc.input.KeyCode;
			return (
				Core.input.keyDown(KC.shiftLeft) ||
				Core.input.keyDown(KC.shiftRight)
			);
		} catch (e) {
			return false;
		}
	};

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
		if (iconDrag.hoverIdx >= 0) {
			tintSlot(iconDrag.hoverIdx, 1, 1, 1, 1);
		}
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
		ghost.touchable = Packages.arc.scene.event.Touchable.disabled;
		Vars.ui.hudGroup.addChild(ghost);
		iconDrag.ghost = ghost;

		tintSlot(idx, 1, 1, 1, 0.35);
	};

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
		Time.run(1, run(() => rebuildGrid()));
	};

	const grabTargetAt = (stageX, stageY) => {
		if (Vars.mobile) return -1;

		const idx = slotAt(stageX, stageY);
		if (idx < 0) return -1;

		const slot = cfg.slots[idx];
		if (!slot || (!slot.schem && !slot.icon)) return -1;

		return idx;
	};

	const makeSlotListener = (idx) =>
		extend(InputListener, {
			touchDown(event, x, y, pointer, button) {
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
						liftIcon(
							iconDrag.fromIdx,
							event.stageX,
							event.stageY
						);
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
				const to = wasMoving
					? slotAt(event.stageX, event.stageY)
					: -1;

				if (wasMoving && from >= 0) {
					tintSlot(from, 1, 1, 1, 1);
				}

				cancelIconDrag();

				if (wasMoving) {
					lastClickTime = 0;
					lastClickSlot = -1;

					if (dragHandler && dragHandler.state) {
						dragHandler.state.isDragging = false;
					}

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

		let slot = cfg.slots[idx] || {
			schem: '',
			icon: null,
			type: null,
		};

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

			if (++colsCount % 10 === 0) {
				iconPane.row();
			}
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

	// -----------------------------------------------------------------------
	// Schematic hover preview
	// -----------------------------------------------------------------------
	const findSchematic = (name) => {
		if (!name) return null;

		return Vars.schematics.all().find(
			(sc) => String(sc.name()) === name
		);
	};

	const previewPx = () => {
		let px = Math.round((PREVIEW_BASE_PX * cfg.previewScale) / 100);

		// Never let the tooltip outgrow the window: on a small stage a 300%
		// preview would cover the whole screen it is supposed to help read.
		try {
			if (Core.scene) {
				let cap = Math.min(
					Core.scene.getWidth(),
					Core.scene.getHeight()
				) * 0.8;
				if (cap > 16) px = Math.min(px, Math.round(cap));
			}
		} catch (e) {}

		return Math.max(16, px);
	};

	// Mindustry renders each preview into a FrameBuffer of
	// (schematic.width + 2) x (schematic.height + 2) tiles — the +2 is
	// Schematics.padding. Sizing the image cell by that same ratio makes the
	// texture fill the box exactly, so the black tooltip background hugs the
	// schematic instead of framing it in a fixed square.
	const SCHEM_PREVIEW_PADDING = 2;

	const previewBox = (schematic) => {
		let px = previewPx();

		if (!schematic) return { w: px, h: px };

		let aw = Math.max(1, schematic.width + SCHEM_PREVIEW_PADDING);
		let ah = Math.max(1, schematic.height + SCHEM_PREVIEW_PADDING);
		let k = px / Math.max(aw, ah);

		return {
			w: Math.max(8, Math.round(aw * k)),
			h: Math.max(8, Math.round(ah * k)),
		};
	};

	// ---------------------------------------------------------------------
	// Preview overlay
	//
	// The Tooltip version was wrong on two counts. First, arc packs a Table
	// from the content's *native* size, and the preview texture Mindustry
	// hands out is a full-size FrameBuffer (32 px per schematic tile), so the
	// black frame ended up far bigger than the box we asked for. Second,
	// Scaling.fit scales against that native pixel size, which left the
	// schematic small inside its own frame.
	//
	// Here the box is set explicitly through the cell and the drawable is
	// registered with Scaling.stretch — TextureRegionDrawable.draw(x, y, w, h)
	// draws the region into exactly those bounds, no guessing involved. The
	// box keeps the schematic's own (w + padding) : (h + padding) ratio, so
	// the background hugs the schematic instead of framing it.
	// ---------------------------------------------------------------------
	let previewOverlay = null;
	let previewCell = null;
	let previewElem = null;
	let previewSchem = null;
	let previewAnchor = null;
	let previewCurW = 0;
	let previewCurH = 0;
	let tmpVec = new Packages.arc.math.geom.Vec2();

	const hideSlotPreview = () => {
		if (!previewOverlay) return;
		previewOverlay.visible = false;
		previewSchem = null;
		previewAnchor = null;
	};

	// Above the slot when it fits, below when it does not, and always nudged
	// back inside the screen — a 300% preview must flip to the free side, not
	// hang off the edge.
	//
	// getScene()/getWidth()/getHeight(), never getStage() or the bare width
	// field: arc's Element exposes the first as part of the Scene API, and
	// width/height are protected Java fields that Rhino cannot read.
	const placeSlotPreview = (btn) => {
		if (!previewOverlay || !btn) return;

		let scene = btn.getScene();
		if (!scene) return;

		let pad = 6;
		let w = previewOverlay.getWidth();
		let h = previewOverlay.getHeight();

		let p = tmpVec.set(0, 0);
		btn.localToStageCoordinates(p);

		let x = p.x + (btn.getWidth() - w) / 2;
		let y = p.y + btn.getHeight() + pad;

		if (y + h > scene.getHeight() - pad) {
			let below = p.y - h - pad;
			y = below >= pad ? below : scene.getHeight() - pad - h;
		}

		let maxX = scene.getWidth() - pad - w;
		if (x > maxX) x = maxX;
		if (x < pad) x = pad;
		if (y < pad) y = pad;

		previewOverlay.setPosition(Math.round(x), Math.round(y));
	};

	const relayoutPreview = () => {
		previewOverlay.invalidate();
		previewOverlay.pack();
		placeSlotPreview(previewAnchor);
	};

	const showSlotPreview = (btn, slot) => {
		if (!cfg.preview || !previewOverlay) return;
		if (!slot || !slot.schem) return;

		previewSchem = findSchematic(slot.schem);
		previewAnchor = btn;

		let box = previewBox(previewSchem);
		previewCurW = box.w;
		previewCurH = box.h;

		// Placeholder straight away: the real texture needs a render pass.
		previewElem.setDrawable(
			new TextureRegionDrawable(Icon.paste.getRegion())
		);

		previewCell.size(box.w, box.h);
		previewOverlay.visible = true;
		relayoutPreview();
		previewOverlay.toFront();

		// getPreview() renders into a FrameBuffer, so it cannot run from an
		// input event — hand it to the app queue.
		Core.app.post(
			run(() => {
				if (!previewOverlay.visible) return;

				try {
					let texture = previewSchem
						? Vars.schematics.getPreview(previewSchem)
						: null;

					previewElem.setDrawable(
						new TextureRegionDrawable(
							texture
								? new Packages.arc.graphics.g2d.TextureRegion(
										texture
								  )
								: Icon.cancel.getRegion()
						)
					);
				} catch (e) {
					previewElem.setDrawable(
						new TextureRegionDrawable(Icon.cancel.getRegion())
					);
				}

				relayoutPreview();
			})
		);
	};

	// The preview has to keep following the table while it is dragged, so the
	// placement runs every frame; the re-size only fires when scale changed.
	const updateSlotPreview = () => {
		if (!previewOverlay || !previewOverlay.visible || !previewAnchor) return;

		let want = previewBox(previewSchem);

		if (want.w !== previewCurW || want.h !== previewCurH) {
			previewCurW = want.w;
			previewCurH = want.h;
			previewCell.size(want.w, want.h);
			previewOverlay.invalidate();
			previewOverlay.pack();
		}

		placeSlotPreview(previewAnchor);
	};

	const attachSchematicPreview = (btn, slot) => {
		if (!cfg.preview) return;
		if (!slot || !slot.schem) return;

		// Wrapped on purpose: a JS exception thrown from an input listener
		// escapes through arc's Scene.act and takes the whole game down (that
		// is exactly how a mistyped Element method produced a crash report
		// instead of a chat warning). Hover feedback must never be fatal.
		btn.addListener(
			extend(Packages.arc.scene.event.InputListener, {
				enter(event, x, y, pointer, fromActor) {
					try {
						if (fromActor != null && fromActor.isDescendantOf(btn))
							return;
						showSlotPreview(btn, slot);
					} catch (e) {
						logger.err('Table preview enter failed: ' + e);
						hideSlotPreview();
					}
				},
				exit(event, x, y, pointer, toActor) {
					try {
						if (toActor != null && toActor.isDescendantOf(btn)) return;
						hideSlotPreview();
					} catch (e) {
						logger.err('Table preview exit failed: ' + e);
					}
				},
			})
		);
	};

	// Built once, reused by every slot. The size is set explicitly through the
	// cell instead of being derived from the drawable, which is exactly what
	// the Tooltip version got wrong.
	previewOverlay = new Table(Styles.black8);
	previewOverlay.margin(6);
	previewOverlay.visible = false;
	previewOverlay.touchable = Packages.arc.scene.event.Touchable.disabled;

	previewElem = new Packages.arc.scene.ui.Image(
		new TextureRegionDrawable(Icon.paste.getRegion())
	);

	// Stretch, not fit: the drawable is drawn into exactly the box the cell
	// gives it, instead of being scaled down from the preview texture's own
	// (very large) pixel size. The box already carries the schematic's aspect,
	// so stretching distorts nothing.
	previewElem.setScaling(Packages.arc.util.Scaling.stretch);

	previewCell = previewOverlay.add(previewElem).size(64, 64);
	previewOverlay.pack();

	Vars.ui.hudGroup.addChild(previewOverlay);

	const rebuildGrid = () => {
		cancelIconDrag();
		hideSlotPreview();
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
							if (
								dragHandler &&
								dragHandler.state.isDragging
							) {
								return;
							}

							if (iconDrag.active || iconDrag.moving) return;

							let time = Time.millis();

							if (
								time - lastClickTime < 300 &&
								lastClickSlot === idx
							) {
								openConfig(idx);
							} else if (slot && slot.schem) {
								let s = Vars.schematics
									.all()
									.find(
										(sc) => String(sc.name()) === slot.schem
									);

								if (s) {
									Vars.control.input.useSchematic(s);
								} else {
									notify(
										'[scarlet]Schematic not found: ' +
											slot.schem
									);
								}
							}

							lastClickTime = time;
							lastClickSlot = idx;
						}
					)
					.size(cfg.size)
					.get();

				attachSchematicPreview(btn, slot);
				btn.addListener(makeSlotListener(idx));
				slotButtons[idx] = btn;
			}

			gridTable.row();
		}

		uiTable.pack();
	};

	// -----------------------------------------------------------------------
	// Settings
	// -----------------------------------------------------------------------
	function showTableSettingsDialog() {
		let d = new BaseDialog('Schematic Table Config');
		d.addCloseButton();

		// Dialog and inner widths are resolved up front: the hint labels need an
		// explicit width to wrap at. Without one, a Label keeps its natural text
		// width as its minimum (arc's Cell.wrap() alone leaves wrapFit false),
		// which stretched the cards past the pane and clipped the text, since
		// horizontal scrolling is disabled below.
		let dw = Math.min(Core.scene.getWidth() * 0.95, 680);
		let dh = Math.min(Core.scene.getHeight() * 0.85, 480);
		// 64 px of slack: root margin, card margin and the vertical scrollbar all
		// eat into the pane width, and a wrapped label that is 1 px too wide
		// still gets clipped instead of reflowing.
		let hintW = Math.max(240, Math.round(dw - 64));

		// Sliders shrink with the pane too: a fixed 240 px track plus the value
		// field is what pushed the label text off the edge on small windows.
		let sliderW = Math.max(120, Math.min(220, Math.round(hintW * 0.42)));
		let fieldW = 80;

		let root = new Table();
		root.top().left().margin(10);

		function createCard(title, titleColor) {
			let card = root
				.table(Styles.black6)
				.growX()
				.padBottom(8)
				.get();

			card.margin(8);
			card.top().left();

			card.add(
				'[#' + (titleColor || 'ffd37f') + ']' + title + '[]'
			)
				.style(Styles.outlineLabel)
				.fontScale(0.90)
				.left()
				.padBottom(4)
				.row();

			card.image()
				.color(Color.valueOf('3a3a46'))
				.height(1.5)
				.growX()
				.padBottom(6)
				.row();

			return card;
		}

		let c1 = createCard('General Display', '50fa7b');

		c1.check('Show Schematic Table HUD', cfg.enabled, (b) => {
			cfg.enabled = b;
			saveCfg();

			notify(
				'[lightgray]Table ' +
					(b ? '[green]ON' : '[scarlet]OFF')
			);
		})
			.pad(3)
			.left()
			.row();

		root.row();

		c1.check('Show Schematic Preview on Hover', cfg.preview, (b) => {
			cfg.preview = b;
			saveCfg();
			rebuildGrid();

			notify(
				'[lightgray]Slot preview ' +
					(b ? '[green]ON' : '[scarlet]OFF')
			);
		})
			.pad(3)
			.left()
			.row();

		let previewScaleCtrl = uiUtils.sliderField(
			c1,
			'[lightgray]Preview scale (%):[]',
			{
				min: PREVIEW_SCALE_MIN,
				max: PREVIEW_SCALE_MAX,
				step: 5,
				value: cfg.previewScale,
				sliderWidth: sliderW,
				fieldWidth: fieldW,
				onChange: (v) => {
					cfg.previewScale = Math.round(v);
					saveCfg();
				},
			}
		);

		c1.add(
			'[gray]100% = ' +
				PREVIEW_BASE_PX +
				' px square. The preview resizes live; only the hover tooltip is affected.[]'
		)
			.fontScale(0.85)
			.width(hintW)
			.wrap()
			.left()
			.padTop(4)
			.row();

		root.row();

		let c2 = createCard('Grid Dimensions & Slots', 'ffd37f');

		let rowsCtrl = uiUtils.sliderField(c2, '[lightgray]Rows:[]', {
			min: 1,
			max: 10,
			step: 1,
			value: cfg.rows,
			sliderWidth: sliderW,
			fieldWidth: fieldW,
			onChange: (v) => {
				cfg.rows = Math.round(v);
				saveCfg();
				rebuildGrid();
			},
		});

		let colsCtrl = uiUtils.sliderField(c2, '[lightgray]Columns:[]', {
			min: 1,
			max: 10,
			step: 1,
			value: cfg.cols,
			sliderWidth: sliderW,
			fieldWidth: fieldW,
			onChange: (v) => {
				cfg.cols = Math.round(v);
				saveCfg();
				rebuildGrid();
			},
		});

		let sizeCtrl = uiUtils.sliderField(c2, '[lightgray]Button size (px):[]', {
			min: 16,
			max: 96,
			step: 4,
			value: cfg.size,
			sliderWidth: sliderW,
			fieldWidth: fieldW,
			onChange: (v) => {
				cfg.size = Math.round(v);
				saveCfg();
				rebuildGrid();
			},
		});

		// Two separate labels instead of one string with an escaped newline:
		// the two-character sequence depends on the font parser, a real break
		// does not.
		c2.add('[gray]Drag the slider or type an exact value.[]')
			.fontScale(0.85)
			.width(hintW)
			.wrap()
			.left()
			.padTop(6)
			.row();

		c2.add(
			'[gray]The table itself is dragged with [accent]RMB[] on the HUD.[]'
		)
			.fontScale(0.85)
			.width(hintW)
			.wrap()
			.left()
			.padTop(2)
			.row();

		root.row();

		let actCard = root
			.table(Styles.black6)
			.growX()
			.padBottom(2)
			.get();

		actCard.margin(8);

		let actRow = actCard.table().center().get();

		actRow.button(
			'[accent]Reset Table & Position[]',
			Icon.refresh,
			Styles.grayt,
			() => {
				cfg.rows = 4;
				cfg.cols = 4;
				cfg.size = 32;
				// Preview on/off is a display preference, not table geometry —
				// it stays whatever the user picked; only its scale is reset.
				cfg.previewScale = 100;
				cfg.slots = {};

				saveCfg();
				rebuildGrid();

				rowsCtrl.set(4);
				colsCtrl.set(4);
				sizeCtrl.set(32);
				previewScaleCtrl.set(100);

				let sw = getStageW();
				let sh = getStageH();
				let tw = uiTable ? uiTable.getWidth() : 200;
				let th = uiTable ? uiTable.getHeight() : 200;

				tableX = Math.max(0, (sw - tw) / 2);
				tableY = Math.max(0, (sh - th) / 2);

				if (dragHandler && dragHandler.state) {
					dragHandler.state.anchorX = 'free';
					dragHandler.state.anchorY = 'free';
					dragHandler.state.offsetX = tableX;
					dragHandler.state.offsetY = tableY;
					dragHandler.state.isDragging = false;
					dragHandler.persist();
				} else {
					Core.settings.put(
						'qol-schem-x',
						new java.lang.Float(tableX)
					);
					Core.settings.put(
						'qol-schem-y',
						new java.lang.Float(tableY)
					);
				}

				if (uiTable) {
					uiTable.setPosition(tableX, tableY);
				}

				notify('[lightgray]Table [green]RESET');
			}
		).size(220, 36);

		root.row();

		let scroll = new ScrollPane(root);
		scroll.setScrollingDisabled(true, false);
		scroll.setOverscroll(false, true);

		d.cont.add(scroll).width(dw).height(dh).row();
		d.show();
	}

	tableSettingsOpener = showTableSettingsDialog;

	interceptor.add('table', (args) => {
		let sub = args[1] ? args[1].toLowerCase() : '';

		if (sub === 's' || sub === 'settings' || sub === 'ui') {
			showTableSettingsDialog();
			return;
		}

		if (sub === 'help') {
			notify(
				'[lightgray]!table - toggle the table\n' +
					'[accent]!table settings[lightgray] (or [accent]!table s[lightgray]) - open the settings window\n\n' +
					'[accent]Shift+LMB[] on a filled slot - drag the icon: drop on an empty slot to move it, on another icon to swap. Drop outside to cancel.\n' +
					'[accent]RMB[] - moves the whole panel.\n' +
					'[accent]Hover[] - shows a schematic preview (toggleable in [accent]!table ui[]).\n' +
					'LMB / double click - place schematic / open the slot config.'
			);
			return;
		}

		if (sub && !interceptor.isBooleanArg(sub)) {
			notify(
				'[scarlet]Unknown command option\n' +
					'[lightgray]Use [accent]!table settings[lightgray] for the settings window.'
			);
			return;
		}

		cfg.enabled = interceptor.parseToggle(cfg.enabled, args[1]);
		saveCfg();

		notify(
			'[lightgray]Table ' +
				(cfg.enabled ? '[green]ON' : '[scarlet]OFF')
		);
	});

	rebuildGrid();
	Vars.ui.hudGroup.addChild(uiTable);

	let initSw = getStageW();
	let initSh = getStageH();

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

		if (!uiTable.visible) {
			hideSlotPreview();
			return;
		}

		// Follows the table while it is dragged and picks up a live scale change.
		try {
			updateSlotPreview();
		} catch (e) {
			hideSlotPreview();
		}

		if (
			dragHandler &&
			dragHandler.state &&
			dragHandler.state.isDragging
		) {
			return;
		}

		dragHandler.recompute();
		tableX = dragHandler.state.x;
		tableY = dragHandler.state.y;
	});
});

// Expose the module's settings window to the mod settings screen (gear button).
require('qol-control/core/settings-ui').register(
	'ui/table',
	'Schematic Table',
	() => {
		if (!tableSettingsOpener) {
			notify(
				'[scarlet]The table is not ready yet - reload the game after enabling the module.'
			);
			return;
		}

		tableSettingsOpener();
	},
	{ menuSafe: true }
);
