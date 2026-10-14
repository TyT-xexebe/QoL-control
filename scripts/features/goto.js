/**
 * Goto Module for QoL-Control (Mindustry)
 * Directs player unit to cursor position on keybind tap.
 * Holds position at target point until manual WASD input or new target.
 * Works seamlessly in default camera, freecam, and pan view.
 * Renders high-contrast thin path line and destination marker.
 */

const notify = require("qol-control/core/logger").notify;
const interceptor = require("qol-control/core/interceptor");

let cfg = {
	key: ""
};

try {
	if (typeof Core !== "undefined" && Core.settings) {
		cfg.key = Core.settings.getString("qol-goto-key", "");
	}
} catch (e) {}

function saveCfg() {
	try {
		if (typeof Core !== "undefined" && Core.settings) {
			Core.settings.put("qol-goto-key", cfg.key || "");
			if (typeof Core.settings.forceSave === "function") Core.settings.forceSave();
		}
	} catch (e) {}
}

// -------------------------------------------------------------
// Key Binding & Combo Parsing (Same robust engine as autopath)
// -------------------------------------------------------------
const allKeyCodes = KeyCode.values();
const NON_BINDABLE_KEYS = {
	unknown: true, anyKey: true, unset: true,
	back: true, forward: true, menu: true, search: true, camera: true, focus: true,
	clear: true, call: true, endcall: true, home: true, notification: true, power: true,
	sym: true, volumeDown: true, volumeUp: true, mute: true,
	mediaPlayPause: true, mediaStop: true, mediaNext: true, mediaPrevious: true,
	mediaRewind: true, mediaFastForward: true, envelope: true, headsetHook: true,
	explorer: true, application: true, switchCharset: true, pictSymbols: true,
	softLeft: true, softRight: true, dpadCenter: true, dpadUp: true, dpadDown: true,
	dpadLeft: true, dpadRight: true, left: true, right: true, up: true, down: true,
	center: true, backtick: true
};

function isBindableKey(k) {
	if (!k) return false;
	let n = "" + k.name();
	if (NON_BINDABLE_KEYS[n]) return false;
	if (n.indexOf("controller") === 0 || n.indexOf("button") === 0 || n.indexOf("meta") === 0) return false;
	return true;
}

function isModifierKey(k) {
	return (
		k === KeyCode.controlLeft || k === KeyCode.controlRight ||
		k === KeyCode.altLeft || k === KeyCode.altRight ||
		k === KeyCode.shiftLeft || k === KeyCode.shiftRight
	);
}

function keyDownAny(k) {
	try {
		return Core.input.keyDown(k);
	} catch (e) {
		return false;
	}
}

function keyTapAny(k) {
	try {
		return Core.input.keyTap(k);
	} catch (e) {
		return false;
	}
}

const keySpecCache = { raw: null, spec: null };

function parseKeySpec(str) {
	let raw = (str === undefined || str === null) ? "" : String(str);
	if (keySpecCache.raw === raw && keySpecCache.spec) return keySpecCache.spec;
	let spec = { ctrl: false, alt: false, shift: false, key: null, any: false };
	if (raw) {
		let parts = raw.split("+");
		for (let i = 0; i < parts.length; i++) {
			let p = parts[i].trim();
			if (!p) continue;
			let lp = p.toLowerCase();
			if (lp === "ctrl" || lp === "control") spec.ctrl = true;
			else if (lp === "shift") spec.shift = true;
			else if (lp === "alt") spec.alt = true;
			else {
				try {
					let k = KeyCode.valueOf(p);
					if (k && k !== KeyCode.unknown) spec.key = k;
				} catch (e) {}
			}
		}
	}
	spec.any = spec.ctrl || spec.alt || spec.shift || spec.key !== null;
	keySpecCache.raw = raw;
	keySpecCache.spec = spec;
	return spec;
}

function isKeyTriggered() {
	let spec = parseKeySpec(cfg.key);
	if (!spec.any) return false;
	if (spec.ctrl && !(keyDownAny(KeyCode.controlLeft) || keyDownAny(KeyCode.controlRight))) return false;
	if (spec.alt && !(keyDownAny(KeyCode.altLeft) || keyDownAny(KeyCode.altRight))) return false;
	if (spec.shift && !(keyDownAny(KeyCode.shiftLeft) || keyDownAny(KeyCode.shiftRight))) return false;
	
	if (spec.key) {
		return keyTapAny(spec.key);
	} else {
		if (spec.ctrl && (keyTapAny(KeyCode.controlLeft) || keyTapAny(KeyCode.controlRight))) return true;
		if (spec.alt && (keyTapAny(KeyCode.altLeft) || keyTapAny(KeyCode.altRight))) return true;
		if (spec.shift && (keyTapAny(KeyCode.shiftLeft) || keyTapAny(KeyCode.shiftRight))) return true;
		return false;
	}
}

function prettyKey(str) {
	let raw = (str === undefined || str === null) ? "" : String(str);
	if (!raw.trim()) return "Not bound";
	return raw
		.split("+")
		.map(function (p) {
			let s = p.trim();
			if (!s) return "";
			let lp = s.toLowerCase();
			if (lp === "ctrl" || lp === "control") return "Ctrl";
			if (lp === "shift") return "Shift";
			if (lp === "alt") return "Alt";
			if (lp === "controlleft") return "LCtrl";
			if (lp === "controlright") return "RCtrl";
			if (lp === "shiftleft") return "LShift";
			if (lp === "shiftright") return "RShift";
			if (lp === "altleft") return "LAlt";
			if (lp === "altright") return "RAlt";
			return s.charAt(0).toUpperCase() + s.slice(1);
		})
		.filter(function (p) { return p.length > 0; })
		.join("+");
}

function collectHeldCombo() {
	let parts = [];
	if (keyDownAny(KeyCode.controlLeft) || keyDownAny(KeyCode.controlRight)) parts.push("ctrl");
	if (keyDownAny(KeyCode.altLeft) || keyDownAny(KeyCode.altRight)) parts.push("alt");
	if (keyDownAny(KeyCode.shiftLeft) || keyDownAny(KeyCode.shiftRight)) parts.push("shift");
	for (let i = 0; i < allKeyCodes.length; i++) {
		let k = allKeyCodes[i];
		if (!isBindableKey(k) || isModifierKey(k)) continue;
		if (keyDownAny(k)) {
			parts.push("" + k.name());
			break;
		}
	}
	return parts.join("+");
}

let listenSession = null;
let gotoDialog = null;
let gotoContent = null;

function startListening(onDone) {
	if (listenSession) return;
	let d = new BaseDialog("Bind Goto key");
	d.cont.add("[lightgray]Hold the key or combination you want, then release it to confirm.[]")
		.width(420)
		.wrap()
		.left()
		.row();
	d.cont.add("[lightgray]A plain key (e.g. G, Z, X) or modifier (Ctrl/Shift/Alt) works too.[]")
		.width(420)
		.wrap()
		.left()
		.padTop(6)
		.row();
	let live = d.cont.add("[lightgray](waiting...)").padTop(14).padBottom(10).get();
	d.cont.row();
	d.addCloseButton();
	d.buttons
		.button("Clear bind", () => {
			let cb = listenSession ? listenSession.onDone : null;
			listenSession = null;
	d.hide();
			if (cb) cb("");
		})
		.size(170, 50);
	d.show();
	listenSession = { dialog: d, live: live, seen: false, last: "", onDone: onDone };
}

function refreshGotoUI() {
	if (!gotoContent) return;
	gotoContent.clear();
	gotoContent.top().left().margin(10);

	function createCard(title, titleColor) {
		let card = gotoContent.table(Styles.black6).growX().padBottom(8).get();
		card.margin(8);
		card.top().left();
		card.add("[#" + (titleColor || "ffd37f") + "]" + title + "[]").style(Styles.outlineLabel).fontScale(0.90).left().padBottom(4).row();
		card.image().color(Color.valueOf("3a3a46")).height(1.5).growX().padBottom(6).row();
		return card;
	}

	let c1 = createCard("Activation Key", "50fa7b");
	let keyRow = c1.table().growX().pad(2).get();
	keyRow.add("[lightgray]Goto Key: []").left().padRight(10);
	keyRow.button(
		cfg.key ? "[accent]" + prettyKey(cfg.key) + "[]" : "[scarlet]Not bound - click to set[]",
		Styles.grayt,
		() => {
			startListening((res) => {
				cfg.key = res;
				saveCfg();
				refreshGotoUI();
				notify(
					res
						? "[lightgray]Goto key bound to [accent]" + prettyKey(res) + "[]"
						: "[lightgray]Goto key cleared"
				);
			});
		}
	).size(260, 38).left();
	c1.row();
	gotoContent.row();

	let c2 = createCard("How it Works", "8be9fd");
	c2.add("[lightgray]Hover your mouse over any destination and press the bound key. Your unit will automatically fly to those coordinates and hold position until you start moving with WASD or set a new destination.[]")
		.fontScale(0.90)
		.wrap()
		.growX()
		.left()
		.padBottom(6)
		.row();
	c2.add("[gray]Seamlessly supports vanilla view, freecam, and pan view. Direct WASD input immediately resumes manual player control.[]")
		.fontScale(0.85)
		.wrap()
		.growX()
		.left()
		.row();
	gotoContent.row();
}

function showGotoUI() {
	if (!gotoDialog) {
		gotoDialog = new BaseDialog("Goto Config");
		gotoDialog.addCloseButton();
		gotoContent = new Table();
		let pane = new ScrollPane(gotoContent);
		pane.setScrollingDisabled(true, false);
		pane.setOverscroll(false, true);
		let dw = Math.min(Core.scene.getWidth() * 0.95, 620);
		let dh = Math.min(Core.scene.getHeight() * 0.85, 380);
		gotoDialog.cont.add(pane).width(dw).height(dh).row();
	}
	refreshGotoUI();
	gotoDialog.show();
}

interceptor.add("goto", () => {
	showGotoUI();
});

// -------------------------------------------------------------
// Movement & Position State
// -------------------------------------------------------------
let targetPos = null;
let targetUnit = null;

function resetGoto() {
	targetPos = null;
	targetUnit = null;
}

Events.on(WorldLoadEvent, () => {
	resetGoto();
});

// Capture combo loop for dialog
Events.run(Trigger.update, () => {
	if (!listenSession) return;
	if (!listenSession.dialog.isShown()) {
		listenSession = null;
		return;
	}
	let combo = collectHeldCombo();
	if (combo) {
		if (listenSession.last !== combo) {
			listenSession.last = combo;
			listenSession.live.setText("[accent]" + prettyKey(combo));
		}
		listenSession.seen = true;
		return;
	}
	listenSession.live.setText("[lightgray](release to confirm)");
	if (!listenSession.seen) return;
	let session = listenSession;
	listenSession = null;
	session.dialog.hide();
	session.onDone(session.last);
});

// Main Update Loop: Key checking, manual WASD interruption, unit movement
Events.run(Trigger.update, () => {
	if (!Vars.state.isGame()) {
		if (targetPos) resetGoto();
		return;
	}

	let p = Vars.player;
	let u = p ? p.unit() : null;
	if (!u || u.dead) {
		if (targetPos) resetGoto();
		return;
	}

	let hasKeyboardFocus = (Core.scene && Core.scene.hasKeyboard()) || (Vars.ui.chatfrag && Vars.ui.chatfrag.shown());

	// 1. Check if bound key is tapped to set a new goto destination
	if (!listenSession && !hasKeyboardFocus && cfg.key && isKeyTriggered()) {
		let mx = Core.input.mouseWorldX();
		let my = Core.input.mouseWorldY();
		targetPos = { x: mx, y: my };
		targetUnit = u;
	}

	if (!targetPos) return;

	// If player switched unit or died, cancel
	if (targetUnit && u !== targetUnit) {
		resetGoto();
		return;
	}

	// 2. Check for manual player movement input (WASD / arrows / axis) to immediately cancel goto
	if (!hasKeyboardFocus) {
		let isManualMoving = false;
		if (typeof Binding !== "undefined") {
			try {
				if (Binding.move_x && Core.input.axis(Binding.move_x) !== 0) isManualMoving = true;
				if (Binding.move_y && Core.input.axis(Binding.move_y) !== 0) isManualMoving = true;
			} catch (e) {}
		}
		if (!isManualMoving) {
			if (
				keyDownAny(KeyCode.w) || keyDownAny(KeyCode.a) ||
				keyDownAny(KeyCode.s) || keyDownAny(KeyCode.d) ||
				keyDownAny(KeyCode.up) || keyDownAny(KeyCode.down) ||
				keyDownAny(KeyCode.left) || keyDownAny(KeyCode.right)
			) {
				isManualMoving = true;
			}
		}
		if (isManualMoving) {
			resetGoto();
			return;
	}
	}

	// 3. Move towards target point or hold position once arrived
	let d = u.dst(targetPos.x, targetPos.y);
	if (d > 6.0) {
		u.vel.trns(u.angleTo(targetPos.x, targetPos.y), u.type.speed);
		u.lookAt(targetPos.x, targetPos.y);
	} else {
		// Arrived at destination: hold position right here until player moves or sets a new point
		u.vel.set(0, 0);
	}
});

// Render crisp, minimal, high-contrast path line and target marker
Events.run(Trigger.draw, () => {
	if (!Vars.state.isGame() || !targetPos) return;
	let p = Vars.player;
	let u = p ? p.unit() : null;
	if (!u || u.dead) return;

	Draw.z(Layer.overlayUI);

	let ux = u.x;
	let uy = u.y;
	let tx = targetPos.x;
	let ty = targetPos.y;

	// Dark semi-transparent shadow line for contrast on light terrain/snow/space
	Lines.stroke(2.4);
	Draw.color(Color.black, 0.65);
	Lines.line(ux, uy, tx, ty);

	// Thin bright accent line
	Lines.stroke(1.2);
	Draw.color(Pal.accent, 0.95);
	Lines.line(ux, uy, tx, ty);

	// Target point indicators
	Draw.color(Color.black, 0.65);
	Lines.stroke(2.4);
	Lines.circle(tx, ty, 4.5);

	Draw.color(Pal.accent, 0.95);
	Lines.stroke(1.2);
	Lines.circle(tx, ty, 4.5);
	Fill.circle(tx, ty, 2.0);
});

module.exports = {
	getTarget: () => targetPos,
	reset: resetGoto
};
