const notify = require('qol-control/core/logger').notify;
const interceptor = require('qol-control/core/interceptor');
const uiUtils = require('qol-control/ui/utils');

let setup = false;
let mapTable, mapElem, coordsLabel;
let mapEnabled = Core.settings.getBool('map-enabled', false);
let btnX = Core.settings.getFloat('map-x', 15);
let btnY = Core.settings.getFloat('map-y', 400);
let anchorX = Core.settings.getString('map-anchorX', 'free');
let anchorY = Core.settings.getString('map-anchorY', 'free');
let posOffsetX = Core.settings.getFloat('map-offsetX', Core.settings.getFloat('map-x', 15));
let posOffsetY = Core.settings.getFloat('map-offsetY', Core.settings.getFloat('map-y', 400));
let mapSize = Core.settings.getInt('map-size', 200);

let playerMode = Core.settings.getInt('cmap-player-mode', 0);
let unitOutline = Core.settings.getBool('cmap-unit-outline', false);
let unitSize = Core.settings.getFloat('cmap-unit-size', 24);
let sortByHp = Core.settings.getBool('cmap-sort-hp', true);

let unitCache = [];
let cacheTimer = 0;
let mapWasVisible = false;
const colorWhite = Packages.arc.graphics.Color.white;

// How often the unit list is rebuilt, in rendered frames. It used to be gated on
// `Time.delta` accumulating past 30 — i.e. every 30 SECONDS — which froze unit
// positions on the minimap and made them jump in bursts. Ticks instead of seconds
// also keeps the per-frame cost constant when the framerate drops.
const UNIT_CACHE_TICKS = 10;
// With a lot of units the rebuild itself (filter + sort) becomes the expensive
// part, so it is simply done less often. Positions are read live from the Java
// objects, so a slightly stale list only delays newly spawned units appearing.
const UNIT_CACHE_TICKS_HEAVY = 20;

// ---------------------------------------------------------------------------
// Unit cache
//
// Every property read on a Java object from JS costs Rhino marshalling, so the
// per-frame loop must touch as few of them as possible. Everything that does not
// change from frame to frame — icon region, its aspect ratio, team colour, team
// id for batching, HP for sorting — is resolved once per rebuild into a plain JS
// record. The draw loop then reads only x / y / rotation / dead off the Java unit.
// ---------------------------------------------------------------------------
function pushUnitRecord(out, u, t) {
	const icon = t.fullIcon;
	if (!icon || !icon.width) return;
	out.push({
		u: u,
		icon: icon,
		ar: icon.height / icon.width,
		color: u.team.color,
		team: u.team.id,
		hp: u.maxHealth
	});
}

function rebuildUnitCache() {
	const out = [];
	let seq = null;
	try {
		// rawSeq() hands back the group's internal Seq without copying, so the
		// backing array can be walked directly: no closure per unit, no Java
		// iterator driven from JS.
		seq = Groups.unit.rawSeq();
	} catch (e) {
		seq = null;
	}

	if (seq && seq.items) {
		const items = seq.items;
		const n = Math.min(seq.size, items.length);
		for (let i = 0; i < n; i++) {
			const u = items[i];
			if (!u || u.dead) continue;
			const t = u.type;
			if (!t || !t.drawMinimap) continue;
			if (u.isPlayer()) continue;
			pushUnitRecord(out, u, t);
		}
	} else {
		// Safety net for a game build without rawSeq(): the previous nested
		// iteration, unchanged in behaviour.
		Vars.state.teams.present.each((data) => {
			data.units.each((u) => {
				if (!u || u.dead) return;
				const t = u.type;
				if (!t || !t.drawMinimap) return;
				if (u.isPlayer()) return;
				pushUnitRecord(out, u, t);
			});
		});
	}

	// Sorted by team first, so Draw.color() can be switched once per team group
	// instead of once per unit — that alone removes one Java call per unit per
	// frame. The HP ordering the setting asks for is kept inside each group.
	if (sortByHp) {
		out.sort((a, b) => (a.team !== b.team ? a.team - b.team : a.hp - b.hp));
	} else {
		out.sort((a, b) => a.team - b.team);
	}
	return out;
}

function refreshUnitCache(force) {
	const interval = unitCache.length > 800 ? UNIT_CACHE_TICKS_HEAVY : UNIT_CACHE_TICKS;
	cacheTimer++;
	if (!force && cacheTimer < interval) return;
	cacheTimer = 0;
	unitCache = rebuildUnitCache();
}

const initUI = () => {
	if (setup || !Vars.ui || !Vars.ui.hudGroup) return;
	setup = true;

	mapTable = new Table(Styles.black5);
	mapTable.touchable = Packages.arc.scene.event.Touchable.enabled;

	mapElem = extend(Element, {
		draw() {
			let region = Vars.renderer.minimap.getRegion();
			if (!region || !this.clipBegin()) return;

			let tiles = Vars.world.tiles;
			let w = tiles.width * 8,
				h = tiles.height * 8;
			let min = Math.min(w, h),
				max = Math.max(w, h);

			Draw.color();
			region.set(0, 1 - w / min, h / min, 1);
			Draw.rect(
				region,
				this.x + this.width / 2,
				this.y + this.height / 2,
				this.width,
				this.height
			);

			let scl = Packages.arc.scene.ui.layout.Scl.scl();
			let scale = scl * unitSize;
			let off = scl * 1.5;

			let pxScl = this.width / max;
			let pyScl = this.height / max;
			let cacheLen = unitCache.length;

			if (unitOutline) {
				Draw.color(colorWhite);
				for (let i = 0; i < cacheLen; i++) {
					let rec = unitCache[i];
					let u = rec.u;
					if (u.dead) continue;

					let icon = rec.icon;
					let px = this.x + u.x * pxScl;
					let py = this.y + u.y * pyScl;
					let ih = scale * rec.ar;
					let rot = u.rotation - 90;

					Draw.rect(icon, px + off, py, scale, ih, rot);
					Draw.rect(icon, px - off, py, scale, ih, rot);
					Draw.rect(icon, px, py + off, scale, ih, rot);
					Draw.rect(icon, px, py - off, scale, ih, rot);
				}
			}

			// Colour switches only when the team actually changes: the records are
			// sorted by team, so this is a handful of Draw.color() calls per frame
			// rather than one per unit. Everything else comes from the cached
			// record, and only x / y / rotation are read off the Java unit.
			let lastTeam = -1;
			for (let i = 0; i < cacheLen; i++) {
				let rec = unitCache[i];
				let u = rec.u;
				if (u.dead) continue;

				if (rec.team !== lastTeam) {
					lastTeam = rec.team;
					Draw.color(rec.color);
				}

				Draw.rect(
					rec.icon,
					this.x + u.x * pxScl,
					this.y + u.y * pyScl,
					scale,
					scale * rec.ar,
					u.rotation - 90
				);
			}

			Draw.color();
			let eye = Icon.eye.getRegion();
			let eyeScl = scl * 0.625;
			let font = Fonts.def;
			let oldSclX = font.getData().scaleX;
			let oldSclY = font.getData().scaleY;

			try {
				if (playerMode === 1) {
					font.getData().setScale(scl * 0.6);
				}

				Groups.player.each((p) => {
					if (p.unit() && p !== Vars.player) {
						let px = this.x + p.x * pxScl;
						let py = this.y + p.y * pyScl;

						if (playerMode === 0) {
							Draw.rect(
								eye,
								px,
								py,
								eye.width * eyeScl,
								eye.height * eyeScl
							);
						} else {
							font.draw(
								p.name,
								px,
								py + scl * 4,
								Packages.arc.util.Align.center
							);
						}
					}
				});
			} finally {
				if (playerMode === 1) {
					font.getData().setScale(oldSclX, oldSclY);
				}
			}

			Lines.stroke(scl * 3);
			let cam = Core.camera;
			Lines.rect(
				this.x + (cam.position.x - cam.width / 2) * pxScl,
				this.y + (cam.position.y - cam.height / 2) * pyScl,
				cam.width * pxScl,
				cam.height * pyScl
			);

			Draw.reset();
			this.clipEnd();
		},
	});

	let isMoving = false,
		isPanning = false;
	let startX = 0,
		startY = 0,
		offsetX = 0,
		offsetY = 0;
	let pressTask = null;
	const KeyCode = Packages.arc.input.KeyCode;

	let pan = (x, y) => {
		let tiles = Vars.world.tiles;
		let max = Math.max(tiles.width, tiles.height) * 8;
		Core.camera.position.set(
			(x / mapElem.getWidth()) * max,
			(y / mapElem.getHeight()) * max
		);
	};

	mapElem.update(() => {
		if (isPanning && Vars.control.input.panning !== undefined) {
			Vars.control.input.panning = true;
		}
	});

	mapElem.addListener(
		extend(InputListener, {
			touchDown(e, x, y, p, btn) {
				if (btn === KeyCode.mouseRight) {
					isPanning = true;
					pan(x, y);
					return true;
				}

				isMoving = isPanning = false;
				startX = x;
				startY = y;
				offsetX = e.stageX - mapTable.x;
				offsetY = e.stageY - mapTable.y;

				if (pressTask) pressTask.cancel();
				pressTask = Timer.schedule(() => {
					if (!isMoving) {
						isPanning = true;
						pan(x, y);
					}
				}, 0.4);

				return true;
			},
			touchDragged(e, x, y, p) {
				if (isPanning) {
					pan(x, y);
					return true;
				}

				if (
					!isMoving &&
					(Math.abs(x - startX) > 5 || Math.abs(y - startY) > 5)
				) {
					isMoving = true;
					if (pressTask) pressTask.cancel();
				}

				if (isMoving) {
					let size = uiUtils.elementSize(mapTable);
					btnX = Mathf.clamp(
						e.stageX - offsetX,
						0,
						Math.max(0, uiUtils.stageWidth() - size.w)
					);
					btnY = Mathf.clamp(
						e.stageY - offsetY,
						0,
						Math.max(0, uiUtils.stageHeight() - size.h)
					);
					// Free-floating while dragging; the anchor is decided on drop.
					anchorX = 'free';
					anchorY = 'free';
					posOffsetX = btnX;
					posOffsetY = btnY;
					mapTable.setPosition(btnX, btnY);
				}
				return true;
			},
			touchUp(e, x, y, p, btn) {
				if (pressTask) pressTask.cancel();

				if (isPanning) {
					isPanning = false;
					return true;
				}

				if (!isMoving && btn === KeyCode.mouseLeft) {
					Vars.ui.minimapfrag.toggle();
				} else if (isMoving) {
					saveMapPosition();
					isMoving = false;
				}
				return true;
			},
		})
	);

	coordsLabel = new Label('');
	coordsLabel.setFontScale(0.75);
	coordsLabel.setAlignment(Packages.arc.util.Align.center);

	coordsLabel.update(() => {
		if (Vars.player) {
			let px = Vars.player.tileX();
			let py = Vars.player.tileY();
			let mx = Packages.mindustry.core.World.toTile(
				Core.input.mouseWorld().x
			);
			let my = Packages.mindustry.core.World.toTile(
				Core.input.mouseWorld().y
			);
			coordsLabel.setText(
				'[lightgray]' + px + ',' + py + ' []' + mx + ',' + my
			);
		}
	});

	mapTable.add(mapElem).size(mapSize).row();
	mapTable.add(coordsLabel).width(mapSize).padTop(2);
	mapTable.pack();
	Vars.ui.hudGroup.addChild(mapTable);
	applyAnchoredPosition();
	mapTable.visible = false;
};

// Derive the pixel position from (anchor, offset) and register for resize
// recalculation. Never writes the clamped result back into the offset, so a
// window resize (F11) cannot permanently shift the minimap.
function applyAnchoredPosition() {
	if (!mapTable) return;
	let size = uiUtils.elementSize(mapTable);
	btnX = uiUtils.computeX(anchorX, posOffsetX, uiUtils.stageWidth(), size.w);
	btnY = uiUtils.computeY(anchorY, posOffsetY, uiUtils.stageHeight(), size.h);
	mapTable.setPosition(btnX, btnY);
}

uiUtils.onResize(applyAnchoredPosition);

function saveMapPosition() {
	let size = uiUtils.elementSize(mapTable);
	let det = uiUtils.detectAnchor(
		btnX,
		btnY,
		uiUtils.stageWidth(),
		uiUtils.stageHeight(),
		size.w,
		size.h,
		20
	);
	anchorX = det.anchorX;
	anchorY = det.anchorY;
	posOffsetX = det.offsetX;
	posOffsetY = det.offsetY;

	Core.settings.put('map-x', new java.lang.Float(btnX));
	Core.settings.put('map-y', new java.lang.Float(btnY));
	Core.settings.put('map-anchorX', det.anchorX);
	Core.settings.put('map-anchorY', det.anchorY);
	Core.settings.put('map-offsetX', new java.lang.Float(det.offsetX));
	Core.settings.put('map-offsetY', new java.lang.Float(det.offsetY));
	if (typeof Core.settings.forceSave === 'function') Core.settings.forceSave();
}

if (Vars.ui && Vars.ui.hudGroup) initUI();
else Events.on(ClientLoadEvent, initUI);

Events.on(WorldLoadEvent, () => {
	// Drop the stale list and let the update loop rebuild it (forcing the rebuild
	// on the first visible tick), so a new map never draws the previous one's
	// units.
	unitCache = [];
	cacheTimer = 0;
	mapWasVisible = false;
	let t = Vars.world.tiles;
	Packages.arc.util.Reflect.set(
		Vars.renderer.minimap,
		'zoom',
		new java.lang.Float(Math.max(t.height, t.width) / 32)
	);
});

interceptor.add('cmap', () => {
	let dialog = new BaseDialog('Minimap Settings');
	dialog.addCloseButton();
	let cont = dialog.cont;

	cont.check('Enable Minimap', mapEnabled, (b) => {
		mapEnabled = b;
		Core.settings.put('map-enabled', new java.lang.Boolean(b));
	})
		.pad(4)
		.row();

	cont.check('Unit Outlines', unitOutline, (b) => {
		unitOutline = b;
		Core.settings.put('cmap-unit-outline', new java.lang.Boolean(b));
	})
		.pad(4)
		.row();

	cont.check(
		'Sort Units by HP (disable on low-end devices)',
		sortByHp,
		(b) => {
			sortByHp = b;
			Core.settings.put('cmap-sort-hp', new java.lang.Boolean(b));
		}
	)
		.pad(4)
		.row();

	let modeBtn;
	modeBtn = cont
		.button(
			'Player Display: ' + (playerMode === 0 ? 'Icon' : 'Name'),
			() => {
				playerMode = playerMode === 0 ? 1 : 0;
				modeBtn
					.get()
					.setText(
						'Player Display: ' +
							(playerMode === 0 ? 'Icon' : 'Name')
					);
				Core.settings.put(
					'cmap-player-mode',
					new java.lang.Integer(playerMode)
				);
			}
		)
		.size(240, 50)
		.pad(4);
	cont.row();

	cont.label(() => 'Map Size: ' + mapSize)
		.padTop(10)
		.row();
	cont.slider(50, 1000, 10, mapSize, (s) => {
		mapSize = s;
		Core.settings.put('map-size', new java.lang.Integer(s));
		if (mapTable && mapElem) {
			mapTable.clearChildren();
			mapTable.add(mapElem).size(mapSize).row();
			mapTable.add(coordsLabel).width(mapSize).padTop(2);
			mapTable.pack();
		}
	})
		.width(240)
		.pad(4)
		.row();

	cont.label(() => 'Unit Size: ' + Math.floor(unitSize))
		.padTop(10)
		.row();
	cont.slider(10, 60, 1, unitSize, (s) => {
		unitSize = s;
		Core.settings.put('cmap-unit-size', new java.lang.Float(s));
	})
		.width(240)
		.pad(4)
		.row();

	dialog.show();
});

Events.run(Trigger.update, () => {
	if (!setup || !mapTable) return;

	let frag = Vars.ui.minimapfrag;
	let mapOpen =
		frag && (typeof frag.shown === 'function' ? frag.shown() : frag.shown);

	if (
		!Vars.state.isGame() ||
		!Vars.ui.hudfrag.shown ||
		!mapEnabled ||
		mapOpen
	) {
		mapTable.visible = false;
		mapWasVisible = false;
		return;
	}

	mapTable.visible = true;
	// Anchor-based: recomputed each tick from the stored offset, never from an
	// already-clamped pixel value, so resizes do not accumulate drift.
	applyAnchoredPosition();

	// The throttle lives inside refreshUnitCache(); this loop must NOT touch
	// cacheTimer. Resetting it here every tick made the interval unreachable on
	// maps with >800 units, which froze the unit list and stopped newly created
	// units from ever appearing. The first tick after the map (re)appears forces
	// a rebuild, so opening it never shows a stale list.
	refreshUnitCache(!mapWasVisible);
	mapWasVisible = true;
});
