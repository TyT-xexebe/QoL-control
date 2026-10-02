const _logger = require('qol-control/core/logger');

global.handleCrash = function (e) {
	if (!e) return;
	let msgStr = typeof e === 'string' ? e : e.message || String(e);
	if (msgStr.indexOf('Java class') > -1) return;

	_logger.err('Exception Caught: ' + msgStr + '\n' + (e.stack || ''));
	let alreadyReported = Core.settings.getBool('qol-error-reported', false);
	if (!alreadyReported && Vars.ui && Vars.ui.chatfrag) {
		let msg =
			'[red][QoL] Fatal Error![]\n[lightgray]Something went wrong in QoL Control! Please check your last_log.txt in the game directory and send it to the mod creator.[]';
		Vars.ui.chatfrag.addMessage(msg);
		Core.settings.put('qol-error-reported', true);
		if (typeof Core.settings.forceSave === 'function') {
			Core.settings.forceSave();
		}
	}
};

let oldCons = typeof cons !== 'undefined' ? cons : null;
if (oldCons) {
	global.cons = function (func) {
		return oldCons(function () {
			try {
				return func.apply(this, arguments);
			} catch (e) {
				handleCrash(e);
			}
		});
	};
}
let oldRun = typeof run !== 'undefined' ? run : null;
if (oldRun) {
	global.run = function (func) {
		return oldRun(function () {
			try {
				return func.apply(this, arguments);
			} catch (e) {
				handleCrash(e);
			}
		});
	};
}
let oldExtend = typeof extend !== 'undefined' ? extend : null;
if (oldExtend) {
	global.extend = function () {
		let args = Array.from(arguments);
		let obj = args[args.length - 1];
		if (obj && typeof obj === 'object') {
			for (let key in obj) {
				if (typeof obj[key] === 'function') {
					let oldFunc = obj[key];
					obj[key] = function () {
						try {
							return oldFunc.apply(this, arguments);
						} catch (e) {
							handleCrash(e);
							if (key.startsWith('touch')) return true;
							return null;
						}
					};
				}
			}
		}
		return oldExtend.apply(this, args);
	};
}

const logger = require('qol-control/core/logger');

let defaultSettings = {};

try {
	let mod = Vars.mods.getMod('qol-control');
	if (mod) {
		let file = mod.root.child('scripts').child('settings.json');
		if (file.exists()) {
			defaultSettings = JSON.parse(file.readString());
		} else {
			logger.err('settings.json not found!');
		}
	}
} catch (e) {
	logger.err('Failed to read settings.json: ' + e);
}

const activeModules = [];
for (let modName in defaultSettings) {
	let isEnabled = Core.settings.getBool(
		'qol-control-' + modName,
		defaultSettings[modName]
	);
	if (isEnabled) {
		activeModules.push(modName);
	}
}

global.qolActiveModules = activeModules;

require('qol-control/core/help');
require('qol-control/core/welcome');

for (let module of activeModules) {
	try {
		require('qol-control/' + module);
		logger.info('Loaded qol-control/' + module);
	} catch (e) {
		logger.err('Failed to load ' + module);
		logger.err(e);
	}
}

if (activeModules.indexOf('ui/units') === -1) {
	const interceptor = require('qol-control/core/interceptor');
	let dynamicLoaded = false;
	let dynamicLoadUnits = (args) => {
		if (dynamicLoaded) return;
		try {
			require('qol-control/ui/units');
			dynamicLoaded = true;
			logger.info('Dynamically loaded qol-control/ui/units');
			if (args) interceptor.trigger('units', args);
		} catch (err) {
			logger.err('Failed to dynamic load ui/units: ' + err);
		}
	};
	interceptor.add('units', (args) => {
		dynamicLoadUnits(args);
	});
	interceptor.add('u', (args) => {
		dynamicLoadUnits(args);
	});
}

if (activeModules.indexOf('features/autopath') === -1) {
	const interceptor = require('qol-control/core/interceptor');
	let autopathLoaded = false;
	let dynamicLoadAutopath = (args) => {
		if (autopathLoaded) return;
		try {
			require('qol-control/features/autopath');
			autopathLoaded = true;
			logger.info('Dynamically loaded qol-control/features/autopath');
			if (args) interceptor.trigger('autopath', args);
		} catch (err) {
			logger.err('Failed to dynamic load features/autopath: ' + err);
		}
	};
	interceptor.add('autopath', (args) => {
		dynamicLoadAutopath(args);
	});
	interceptor.add('path', (args) => {
		dynamicLoadAutopath(args);
	});
	interceptor.add('ap', (args) => {
		dynamicLoadAutopath(args);
	});
}

const toggleableFeatures = require('qol-control/core/toggleable-features');

Events.on(WorldLoadEvent, cons((e) => {
	Time.run(60, run(() => {
		if (!Vars.state.isGame()) return;
		toggleableFeatures.forEach((t) => {
			if (Core.settings.getBool(t.key, t.def)) {
				logger.notify(t.msg);
			}
		});
	}));
}));

if (!Vars.headless) {
	let hasChanged = false;

	Events.on(
		ClientLoadEvent,
		cons((e) => {
			Vars.ui.settings.addCategory(
				'QoL Control',
				Icon.logic,
				cons((table) => {
					table
						.add('[accent]QoL Control Settings[]')
						.padBottom(10)
						.row();
					table
						.add(
							'These settings only enable or disable the module import at startup.'
						)
						.padBottom(5)
						.row();
					table
						.add(
							'They do not affect the internal settings of the features themselves.'
						)
						.padBottom(5)
						.row();
					table
						.add(
							'[coral]The game will request a restart upon exiting settings![]'
						)
						.padBottom(20)
						.row();

					let moduleDescriptions = {};
					try {
						let mod = Vars.mods.getMod('qol-control');
						if (mod) {
							let file = mod.root
								.child('scripts')
								.child('module-descriptions.json');
							if (file.exists()) {
								moduleDescriptions = JSON.parse(file.readString());
							} else {
								logger.err('module-descriptions.json not found!');
							}
						}
					} catch (e) {
						logger.err('Failed to read module-descriptions.json: ' + e);
					}

					for (let modName in defaultSettings) {
						(function (mName) {
							let displayName = mName
								.split('/')
								.map(
									(word) =>
										word.charAt(0).toUpperCase() +
										word.slice(1)
								)
								.join(': ');

							let key = 'qol-control-' + mName;
							let currentState = Core.settings.getBool(
								key,
								defaultSettings[mName]
							);

							table
								.table(
									cons((row) => {
										row.check(displayName, (b) => {
											Core.settings.put(key, b);
											hasChanged = true;
										})
											.checked(currentState)
											.left();

										row.add().growX();

										row.button('?', Styles.cleart, () => {
											let desc =
												moduleDescriptions[mName] ||
												'No description available for ' +
													mName;
											let d = new BaseDialog(displayName);
											let t = new Table();
											t.add(desc)
												.width(450)
												.wrap()
												.left();
											let p = new ScrollPane(t);
											d.cont
												.add(p)
												.width(1200)
												.height(600)
												.row();
											d.addCloseButton();
											d.show();
										})
											.size(40, 40)
											.right()
											.padLeft(10);
									})
								)
								.growX()
								.padBottom(6)
								.row();
						})(modName);
					}

					let prefixKey = 'qol-control-prefix';
					let currentPrefix = Core.settings.get(prefixKey, '!');
					currentPrefix = ('' + (currentPrefix || '!')).trim();
					if (!currentPrefix) currentPrefix = '!';

					table
						.table(
							cons((prefTable) => {
								prefTable
									.add('[accent]Command Prefix:[]')
									.left()
									.padRight(10);

								prefTable
									.field(currentPrefix, (text) => {
										let val = ('' + text).trim();
										if (!val) val = '!';
										Core.settings.put(
											prefixKey,
											new java.lang.String(val)
										);
										if (
											typeof Core.settings.forceSave ===
											'function'
										) {
											Core.settings.forceSave();
										}
									})
									.size(140, 40)
									.left();

								prefTable
									.button('?', Styles.cleart, () => {
										let d = new BaseDialog(
											'Command Prefix'
										);
										let t = new Table();
										t.add(
											'Customize the command prefix for QoL Control.\n\n' +
												'Default: [green]![]\n\n' +
												'Common prefixes: [accent]! ? . # $ ~ - /[]\n' +
												'You can specify multiple prefixes separated by space (e.g. [accent]! ?[]).\n\n' +
												'Leave empty to restore default [green]![]'
										)
											.width(450)
											.wrap()
											.left();
										d.cont.add(t).pad(10);
										d.addCloseButton();
										d.show();
									})
									.size(40, 40)
									.left()
									.padLeft(10);
							})
						)
						.left()
						.padBottom(8)
						.row();

					let fooKey = 'qol-control-foo-client';
					let fooState = Core.settings.getBool(fooKey, false);
					table
						.check("Turn on if you using Foo's client", (b) => {
							Core.settings.put(fooKey, b);
							hasChanged = true;
						})
						.checked(fooState)
						.left()
						.padBottom(6)
						.row();

					// Optimizer per-feature toggles
					if (typeof buildOptimizerSettings === 'function') {
						buildOptimizerSettings(table);
					}
				})
			);

			Vars.ui.settings.hidden(
				run(() => {
					if (hasChanged) {
						hasChanged = false;

						if (typeof Core.settings.forceSave === 'function') {
							Core.settings.forceSave();
						}

						Vars.ui.showConfirm(
							'Restart Required',
							'You have changed QoL Control settings.\nA restart is required to apply them.\n\nExit the game now?',
							run(() => {
								Core.app.exit();
							})
						);
					}
				})
			);
		})
	);
}

Events.on(
	ClientLoadEvent,
	cons((e) => {
		Vars.maxSchematicSize = 512;
		Vars.renderer.minZoom = 0.1;
		Vars.renderer.maxZoom = 10.0;
	})
);
