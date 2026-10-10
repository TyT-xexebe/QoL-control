function formatNum(n) {
	let num = Number(n);
	let abs = Math.abs(num);
	if (abs >= 1000000) return (Math.round(num / 100000) / 10) + 'm';
	if (abs >= 1000) return (Math.round(num / 100) / 10) + 'k';
	return String(Math.floor(num));
}

// ---------------------------------------------------------------------------
// Stage metrics
//
// HUD elements live inside Vars.ui.hudGroup, a fillParent WidgetGroup laid out
// inside scene.root. Its usable size is the scene size minus safe insets and
// ARC's uiEdgePadding, and it CHANGES when the window is resized (F11). Reading
// hudGroup keeps our coordinates in the same frame the elements use.
// ---------------------------------------------------------------------------
function hudGroup() {
	try {
		if (typeof Vars !== 'undefined' && Vars.ui && Vars.ui.hudGroup) return Vars.ui.hudGroup;
	} catch (e) {}
	return null;
}

function stageWidth() {
	let g = hudGroup();
	if (g) {
		let w = g.getWidth();
		if (w > 0) return w;
	}
	try {
		if (Core.scene && Core.scene.getWidth() > 0) return Core.scene.getWidth();
	} catch (e) {}
	return Core.graphics.getWidth();
}

function stageHeight() {
	let g = hudGroup();
	if (g) {
		let h = g.getHeight();
		if (h > 0) return h;
	}
	try {
		if (Core.scene && Core.scene.getHeight() > 0) return Core.scene.getHeight();
	} catch (e) {}
	return Core.graphics.getHeight();
}

function elementSize(element) {
	if (!element) return { w: 0, h: 0 };
	let w = 0,
		h = 0;
	try {
		if (typeof element.getWidth === 'function') w = element.getWidth();
	} catch (e) {}
	try {
		if (typeof element.getHeight === 'function') h = element.getHeight();
	} catch (e) {}
	return { w: w, h: h };
}

function readSettingString(key, def) {
	try {
		if (typeof Core.settings.getString === 'function')
			return Core.settings.getString(key, def);
	} catch (e) {}
	return def;
}

// ---------------------------------------------------------------------------
// Anchoring
//
// A position is stored as (anchor, offset) instead of a raw pixel pair:
//   left   -> offset is the distance from the left edge
//   right  -> offset is the distance from the right edge
//   free   -> offset is the raw X
//   bottom -> offset is the distance from the bottom edge
//   top    -> offset is the distance from the top edge
// On resize the pixel position is recomputed FROM the anchor, so a panel glued
// to the right edge stays there, and a "free" panel keeps its offset instead of
// being permanently squashed by a clamp that writes back into its own source.
// ---------------------------------------------------------------------------
function computeX(anchor, offset, width, elemWidth) {
	let x = anchor === 'right' ? width - elemWidth - offset : offset;
	let max = Math.max(0, width - elemWidth);
	if (!(x > 0)) x = 0;
	if (x > max) x = max;
	return x;
}

function computeY(anchor, offset, height, elemHeight) {
	let y = anchor === 'top' ? height - elemHeight - offset : offset;
	let max = Math.max(0, height - elemHeight);
	if (!(y > 0)) y = 0;
	if (y > max) y = max;
	return y;
}

// Decide which edge an element is snapped to, given its final pixel position.
function detectAnchor(x, y, width, height, elemWidth, elemHeight, snap) {
	if (snap === undefined || snap === null) snap = 20;
	let ax = 'free',
		ox = x;
	let distRight = width - (x + elemWidth);
	if (x <= snap) {
		ax = 'left';
		ox = x;
	} else if (distRight <= snap) {
		ax = 'right';
		ox = Math.max(0, distRight);
	}

	let ay = 'free',
		oy = y;
	let distTop = height - (y + elemHeight);
	if (y <= snap) {
		ay = 'bottom';
		oy = y;
	} else if (distTop <= snap) {
		ay = 'top';
		oy = Math.max(0, distTop);
	}
	return { anchorX: ax, offsetX: ox, anchorY: ay, offsetY: oy };
}

// ---------------------------------------------------------------------------
// Resize hook
//
// Mindustry fires EventType.ResizeEvent from UI.resize(), but mods do not always
// see it (F11 fullscreen toggle, compositor-driven resizes, uiscale slider).
// So we listen to the event AND poll the metrics once per tick as a safety net.
// The poll is two float comparisons, so it is essentially free.
// ---------------------------------------------------------------------------
let _recalcRegistry = [];
let _lastStageW = -1;
let _lastStageH = -1;
let _hookInstalled = false;

function runRecalc() {
	for (let i = 0; i < _recalcRegistry.length; i++) {
		try {
			_recalcRegistry[i]();
		} catch (e) {}
	}
}

function onResize(callback) {
	if (callback && _recalcRegistry.indexOf(callback) < 0) _recalcRegistry.push(callback);
	installResizeHook();
	return callback;
}

function offResize(callback) {
	let idx = _recalcRegistry.indexOf(callback);
	if (idx >= 0) _recalcRegistry.splice(idx, 1);
}

function installResizeHook() {
	if (_hookInstalled) return;
	_hookInstalled = true;

	_lastStageW = stageWidth();
	_lastStageH = stageHeight();

	try {
		if (typeof EventType !== 'undefined' && EventType.ResizeEvent && Events && Events.on) {
			Events.on(EventType.ResizeEvent, () => {
				_lastStageW = stageWidth();
				_lastStageH = stageHeight();
				runRecalc();
			});
		}
	} catch (e) {}

	Events.run(Trigger.update, () => {
		let w = stageWidth();
		let h = stageHeight();
		if (w !== _lastStageW || h !== _lastStageH) {
			_lastStageW = w;
			_lastStageH = h;
			runRecalc();
		}
	});
}

// ---------------------------------------------------------------------------
// Drag gesture button
//
// On desktop a widget is moved with the RIGHT mouse button only, so a plain
// left click still reaches the buttons inside it. Touch devices keep the old
// behaviour (finger drag), because there is no second mouse button there.
// ---------------------------------------------------------------------------
function isDragButton(button) {
	try {
		if (Vars.mobile) return true;
	} catch (e) {
		return true;
	}
	return button === Packages.arc.input.KeyCode.mouseRight;
}

// ---------------------------------------------------------------------------
// setupDrag
//
// settingsKeyX/Y - legacy absolute pixel keys (still written, for compatibility)
// defaultX/Y     - used only when nothing was ever saved
// onDragUpdate   - optional (x, y) callback for live drag feedback; when it is
//                  omitted the attached element is moved by the handler itself
// opts.snap      - optional snap distance in pixels (default 20)
// ---------------------------------------------------------------------------
function setupDrag(settingsKeyX, settingsKeyY, defaultX, defaultY, onDragUpdate, opts) {
	opts = opts || {};
	const snap = opts.snap === undefined || opts.snap === null ? 20 : opts.snap;

	const anchorKeyX = settingsKeyX + '-anchor';
	const anchorKeyY = settingsKeyY + '-anchor';
	const offsetKeyX = settingsKeyX + '-offset';
	const offsetKeyY = settingsKeyY + '-offset';

	let savedX = Core.settings.getFloat(settingsKeyX, defaultX);
	let savedY = Core.settings.getFloat(settingsKeyY, defaultY);

	let state = {
		x: savedX,
		y: savedY,
		anchorX: readSettingString(anchorKeyX, 'free'),
		anchorY: readSettingString(anchorKeyY, 'free'),
		offsetX: Core.settings.getFloat(offsetKeyX, savedX),
		offsetY: Core.settings.getFloat(offsetKeyY, savedY),
		isDragging: false,
		dragArmed: false,
		startX: 0,
		startY: 0,
		startStageX: 0,
		startStageY: 0,
		offsetMouseX: 0,
		offsetMouseY: 0,
		attachedElement: null,
	};

	// Recompute the pixel position from anchor + offset. Never writes back into
	// the saved offset, so a resize cannot permanently move anything.
	function recompute() {
		let element = state.attachedElement;
		if (!element) return;
		let size = elementSize(element);
		let nx = computeX(state.anchorX, state.offsetX, stageWidth(), size.w);
		let ny = computeY(state.anchorY, state.offsetY, stageHeight(), size.h);
		state.x = nx;
		state.y = ny;
		element.setPosition(nx, ny);
	}

	function recalcCallback() {
		if (state.isDragging) return;
		recompute();
	}

	// After a drag: decide the anchor from where the user dropped the element,
	// then persist anchor + offset (plus the legacy absolute pair).
	function persist() {
		let element = state.attachedElement;
		let bx = element ? element.x : state.x;
		let by = element ? element.y : state.y;
		let size = elementSize(element);
		let det = detectAnchor(bx, by, stageWidth(), stageHeight(), size.w, size.h, snap);

		state.anchorX = det.anchorX;
		state.offsetX = det.offsetX;
		state.anchorY = det.anchorY;
		state.offsetY = det.offsetY;
		state.x = bx;
		state.y = by;

		Core.settings.put(settingsKeyX, new java.lang.Float(bx));
		Core.settings.put(settingsKeyY, new java.lang.Float(by));
		Core.settings.put(anchorKeyX, det.anchorX);
		Core.settings.put(anchorKeyY, det.anchorY);
		Core.settings.put(offsetKeyX, new java.lang.Float(det.offsetX));
		Core.settings.put(offsetKeyY, new java.lang.Float(det.offsetY));
		if (typeof Core.settings.forceSave === 'function') {
			try {
				Core.settings.forceSave();
			} catch (e) {}
		}
	}

	function releaseDrag() {
		try {
			Time.run(
				6,
				run(() => {
					state.isDragging = false;
				})
			);
		} catch (err) {
			try {
				Timer.schedule(
					run(() => {
						state.isDragging = false;
					}),
					0.1
				);
			} catch (e2) {
				state.isDragging = false;
			}
		}
	}

	const listener = extend(InputListener, {
		touchDown(event, x, y, pointer, button) {
			if (!isDragButton(button)) return false;
			state.dragArmed = true;
			state.isDragging = false;
			state.startX = x;
			state.startY = y;
			state.startStageX = event.stageX;
			state.startStageY = event.stageY;

			let curX = state.attachedElement ? state.attachedElement.x : state.x;
			let curY = state.attachedElement ? state.attachedElement.y : state.y;

			state.offsetMouseX = event.stageX - curX;
			state.offsetMouseY = event.stageY - curY;
			state.x = curX;
			state.y = curY;
			return true;
		},
		touchDragged(event, x, y, pointer) {
			if (!state.dragArmed) return false;
			if (
				!state.isDragging &&
				(Math.abs(event.stageX - state.startStageX) > 5 ||
					Math.abs(event.stageY - state.startStageY) > 5)
			) {
				state.isDragging = true;
			}
			if (state.isDragging) {
				let size = elementSize(state.attachedElement);
				let maxX = Math.max(0, stageWidth() - size.w);
				let maxY = Math.max(0, stageHeight() - size.h);
				let newX = Mathf.clamp(event.stageX - state.offsetMouseX, 0, maxX);
				let newY = Mathf.clamp(event.stageY - state.offsetMouseY, 0, maxY);

				// While dragging the element is free-floating; offsets follow the
				// pointer so an unlucky resize mid-drag cannot teleport it.
				state.anchorX = 'free';
				state.anchorY = 'free';
				state.offsetX = newX;
				state.offsetY = newY;

				// The handler moves the attached element itself, so callers that only
				// bind() it (quickchat, buildpause, camera) drag properly too.
				// onDragUpdate stays available for extra live feedback.
				if (state.attachedElement) state.attachedElement.setPosition(newX, newY);
				state.x = newX;
				state.y = newY;
				if (onDragUpdate) onDragUpdate(newX, newY);
			}
			return true;
		},
		touchUp(event, x, y, pointer) {
			if (!state.dragArmed) return false;
			state.dragArmed = false;
			// A plain click without movement must not rewrite the saved position.
			if (state.isDragging) {
				if (state.attachedElement) {
					state.x = state.attachedElement.x;
					state.y = state.attachedElement.y;
				}
				persist();
			}
			// isDragging is cleared a few ticks later on purpose: the button click
			// handlers run before this one and use it to swallow the click that
			// ends a drag.
			releaseDrag();
			return true;
		},
	});

	// bind(): track the element (position, resize recalc) WITHOUT taking over
	// its input, for callers that attach the listener to an inner widget.
	function bind(element) {
		state.attachedElement = element;
		recompute();
		onResize(recalcCallback);
	}

	// attach(): bind + listen on the element itself.
	function attach(element) {
		bind(element);
		element.addListener(listener);
	}

	return {
		state: state,
		listener: listener,
		attach: attach,
		bind: bind,
		recompute: recompute,
		persist: persist,
	};
}

module.exports = {
	formatNum: formatNum,
	setupDrag: setupDrag,
	isDragButton: isDragButton,
	stageWidth: stageWidth,
	stageHeight: stageHeight,
	elementSize: elementSize,
	computeX: computeX,
	computeY: computeY,
	detectAnchor: detectAnchor,
	onResize: onResize,
	offResize: offResize,
	recalcAll: runRecalc,
};
