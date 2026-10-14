// Central registry of per-module settings UIs.
//
// A module registers its own settings dialog from its own file, right next to
// the place where it already hooks its chat command:
//
//   require('qol-control/core/settings-ui').register(
//       'features/mining',
//       'Mining',
//       showMiningSettingsDialog,
//       { menuSafe: false }
//   );
//
// Nothing else needs editing. The mod settings screen draws one gear button
// per registered module. A module that was disabled at startup never runs its
// file, therefore never registers, therefore gets no gear - the button can
// never lie about a feature that is not loaded.
//
// opts:
//   menuSafe - true if the dialog can be opened from the main menu, i.e. it
//              does not touch Vars.player / Vars.world / Vars.state.rules.
//              Default false: outside a game the gear shows a toast instead
//              of throwing a NullPointerException.
//
// Registering the same module twice overrides the previous entry (handy for
// hot reload during development).

const logger = require('qol-control/core/logger');

const registry = {};

function register(module, label, open, opts) {
	if (!module || typeof open !== 'function') {
		logger.err(
			'[settings-ui] register() needs a module id and an open() function, got: ' +
				module
		);
		return false;
	}

	if (registry[module]) {
		logger.info('[settings-ui] overriding settings UI for ' + module);
	}

	registry[module] = {
		module: module,
		label: label ? String(label) : String(module),
		open: open,
		menuSafe: !!(opts && opts.menuSafe),
	};
	return true;
}

function get(module) {
	return registry[module] || null;
}

function has(module) {
	return Object.prototype.hasOwnProperty.call(registry, module);
}

function list() {
	return Object.keys(registry);
}

// Whether the dialog may be opened right now. Also used by the settings screen
// if it ever wants to grey the gear out instead of hiding it.
function canOpen(module) {
	const entry = registry[module];
	if (!entry) return false;
	if (entry.menuSafe) return true;
	return !!(Vars.state && Vars.state.isGame());
}

// hudfrag toasts only render inside a running game, so outside a world (the
// settings screen is reachable from the main menu) fall back to showInfoFade,
// and if even that is missing, at least put it in the log.
function toast(icon, msg) {
	try {
		if (Vars.state && Vars.state.isGame() && Vars.ui && Vars.ui.hudfrag) {
			Vars.ui.hudfrag.showToast(icon, msg);
			return;
		}
	} catch (e) {}

	try {
		if (Vars.ui && typeof Vars.ui.showInfoFade === 'function') {
			Vars.ui.showInfoFade(msg);
			return;
		}
	} catch (e) {}

	try {
		Log.info('[QoL] ' + msg.replace(/\[[^\]]*\]/g, ''));
	} catch (e) {}
}

function open(module) {
	const entry = registry[module];
	if (!entry) return false;

	if (!canOpen(module)) {
		// A toast/fade is too easy to miss from the menu, so say it in a real
		// popup the player has to dismiss.
		const msg =
			'[accent]' +
			entry.label +
			'[] settings can only be changed after joining a game.\n\n' +
			'Join a map (or host one), then open this gear again.';
		try {
			if (Vars.ui && typeof Vars.ui.showInfo === 'function') {
				Vars.ui.showInfo(msg);
			} else {
				toast(Icon.warning, msg);
			}
		} catch (e) {
			toast(Icon.warning, msg);
		}
		return false;
	}

	try {
		entry.open();
		return true;
	} catch (e) {
		logger.err(
			'[settings-ui] settings UI for ' + module + ' threw: ' + e + '\n' + (e.stack || '')
		);
		toast(
			Icon.warning,
			'[lightgray]Failed to open settings for [accent]' + entry.label + '[] - see the log.[]'
		);
		return false;
	}
}

module.exports = {
	register: register,
	get: get,
	has: has,
	list: list,
	canOpen: canOpen,
	open: open,
};
