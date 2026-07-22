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
require('qol-control/core/users');
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

					const moduleDescriptions = {
						'core/optimizer':
							'Optimizer\nThe optimizer disables some unnecessary game features to increase FPS.\n\n!opt for settings',
						'core/unlocker': 'Unlocker\nSandbox blocks unlocker.',
						'core/bind':
							'!bind\nYou can add keybinds for your PC to launch some commands or text in chat.',
						'core/colors':
							'!colors\nYou can customise all your mindustry colors from Pal.java.',
						'core/logicfix':
							'Logic Fix\nContains small logic fixes.',
						'features/hp':
							"!hp\n!hp <1/0?>\nToggles the display of HP and shield for the unit you are currently shooting at.\n\n!hp <name?> <1/0?>\nTracks a specific player's HP and draws a line to them.",
						'features/trange':
							'!trange <1/0?>\nToggles the display of enemy turret ranges. (may cause FPS drops)',
						'features/urange':
							'!urange <1/0?>\nToggles the display of enemy unit ranges. (may cause FPS drops)',
						'features/lookat':
							'!lookat | !la\n!lookat <x> <y> | !la <x> <y>\nMoves your camera to the specified coordinates.\n\n!lookat last <n?> | !la l <n?>\nMoves your camera to the last n recorded locations. !lookat last to see saved history',
						'features/here':
							'!here <text?>\nSends a chat message with your current camera coordinates.\n\n!herec <text?>\nSends a chat message with your current cursor coordinates.',
						'features/cghost':
							'!cghost | !cg\nClears all your ghost blocks (destroyed blocks waiting to be rebuilt) if they in enemy turrets range.',
						'features/trace':
							'!trace | !tr\nAutomatically possesses a specific unit type when it becomes available.\n\n!trace toggle <1/0?> | !tr t <1/0?>\nToggles trace mode on/off.\n\n!trace set <unit> | !tr s <unit>\nSets a specific unit type to automatically possess.\n\n!trace find | !tr f\nAutomatically possesses the best available unit based on a priority list.\n\n!trace status | !tr st\nShows the current trace status and priority list.',
						'features/mining':
							"!mining | !m\nTakes all free units on the map (that are enabled in your settings) and distributes them to mine the enabled resources.\n\n!mining set <sec> | !m s <sec>\nStarts the unit distribution algorithm and updates it every <sec> seconds. The best option is to set it to 4-10 seconds. Type 0 in <sec> to run the distribution only once.\n\n!mining stop | !m stop\nStops the distribution algorithm.\n\n!mining <units/items?> <1/0?> | !m <units/items?> <1/0?>\nToggles the setting of a unit or resource to the opposite of what it currently is (or explicitly sets it). Supports entering multiple at once: !mining scrap poly beryllium or !mining scrap poly 1\n\n!mining status | !m st\nShows the status of the algorithm, enabled/disabled units and resources, and the current unit distribution.\n\n!mining free <%> | !m f <%>\nSets the % (0-100) of free units. Any player can take <%> of the units from the miner, and it won't take them back. To give the units back to the miner, you must give them a rts task to mine, or the units must not move for 5 seconds (within a 2-tile radius).\n\n!mining ignore <unit> <items.../clear> <1/0?> | !m ig <unit? <items.../clear> <1/0?>\nToggles the setting of a unit which items it will ignore to mine\nSupports entering multiple items at once:\n!m ig poly scrap lead\n!!! settings of !m <items?> >>> then !m ig !!!\n\n!mining save | !m save\nSaves the current enabled/disabled settings for units, resources, and the % of free units as default settings.",
						'features/autograb':
							'!grab | !gr\nAutomatically grabs a specific item from any blocks in your radius.\n\n!grab <item> | !gr <item>\nSets the item to grab and enables it.\n\n!grab toggle <1/0?> | !gr t <1/0?>\nToggles autograb on/off.\n\n!grab min <val> | !gr min <val>\nSets the minimum amount of item in block to grab it.\n\n!grab status | !gr s\nShows the current grab status.\n\n!grab effects | !gr e\nToggles blocks effect display.',
						'features/ai':
							'!ai\nAI for automatic mining, building help and unit lock.\n\n!ai mining <item?> <1/0?> | !ai m <item?> <1/0?>\nToggles automatic mining  (can toggle specific items to mine).\n\n!ai build <name? | -1> <1/0?> | !ai b <name? | -1> <1/0?>\nToggles automatic building to help another playere to build. If a player name is provided, your unit will follow and help them build. Use -1 for AUTO mode.\n\n!ai lock <1/0?> | !ai l <1/0?>\nToggles lock mode, will fix your unit coordinates and mining coords.\n\n!ai status | !ai s\nShows the current AI status.',
						'features/mlog':
							"!mlog\nInjects mlog code from the /qol/mlog/ folder (in Mindustry directory) into processors.\n\n!mlog list\nLists all available .txt files in the mlog/ folder.\n\n!mlog <filename>\nInjects the code from the specified file into the first empty processor found on your team.\n\n!mlog <filename> set\nPrepares the code to be injected into a processor you shoot at.\n\n!mlog <filename> set\nDeletes .txt file\n\nMlog Editor Extensions\nRequires 'Features mlog' enabled in settings. This feature is experimental and lightly tested; bugs may occur. Always backup your processor code before merging.\nAvailable at the processors Edit menu:\n- Copy with Labels: Converts absolute line numbers in jump commands into text labels, and copies the result to the clipboard.\n- Save/Load to QoL: Saves the current processor code to the Mindustry/qol/mlog/ folder (survives mod updates), or opens a menu to load/delete existing one.\n- Save Range to QoL: Saves a specific chunk of code by defining start and end lines (0-indexed). (Jumps within the range are converted to labels, jumps pointing outside the range are set to -1)\n- Insert Code: Injects code from the clipboard or a saved file after a specified line (use -1 to insert at the very beginning). Automatically assigns unique label prefixes to both the existing and inserted code to prevent jump conflicts.\n- Replace Code: Finds and replaces specific lines or multi-line blocks of code throughout all processor. Automatically protects and updates all jump targets using labels, ensuring that replacing code blocks of different lengths wont break your existing jumps.\n\nProcessor Tracker & Variables\nProvides real-time visualization and debugging for logic processors.\n- Visual Connections: Tracks processor variables, drawing target lines from the processor to the blocks/units.\n- Variables Window: View live variable values, pause the processor execution, refresh config, and search through variables.\n- Tracker Window: Add track rules to variables. Set conditions (==, !=, >, <, >=, <=, changed, typeof, contains) and actions (none, pause, highlight, count, notify, camera) to trigger when variable changes. The camera action can track block/unit coordinates or custom x,y.",
						'features/assist':
							'!assist | !as\nUnits around you within an n tile radius will help you build, even if they are currently mining.\n\n!assist toggle <1/0?> | !as t <1/0?>\nToggles assist mode on/off.\n\n!assist toggle <unit> <1/0?> | !as t <unit> <1/0?>\nToggles assist mode for a specific unit type.\n\n!assist max <unit> <val> | !as m <unit> <val>\nSets the maximum number of a specific unit type that can assist you.\n\n!assist range <val> | !as r <val>\nSets the assist radius in blocks.\n\n!assist status | !as s\nShows the current assist settings and status.\n\n!assist save | !as save\nSaves the current assist settings as default.',
						'features/autofill':
							'!autofill <1/0?> | !af <1/0?>\nToggles autofilling of turrets with resources from the core / your inventory.',
						'features/logger':
							'!log\nLogs block placements, destructions and changed by players in your team. (may cause FPS drops and longer load in world)\n\n!log toggle <1/0?> | !log t <1/0?>\nToggles the logger on/off.\n\n!log status\nShows the current logger status.\n\n!log <name?>\nShows the logs, optionally filtered by player name.\n\n!log show <name?>\nDraws the logged actions on the map, optionally filtered by player name.\n\n!log revert <name>\nReverts all block destructions made by a specific player.\n\n!log chat\nShow chat loga (join/leave/ingame name change also).\n\n!log save\nSaves the logs to a file in Mindustry directory (/qol/).',
						'features/server':
							'!server\nFast join to servers which you added to it.',
						'features/mute':
							'!mute\nLocal chat mute for specific players. Hides their messages from your chat (dont work for bubble chat).\n\n!mute list\nShows all currently muted players (both exact and partial mutes).\n\n!mute add <name>\nMutes a player by their exact name (ignoring color tags. You can write only part of a name, it will search for player on server with it and add full name in mute list).\n\n!mute addp <name>\nMutes any player whose name contains the specified <name> (partial match).\n\n!mute remove <name> | !mute rem <name>\nUnmutes a player by removing them from the mute list.',
						'features/map': '!map\nShows current map stats.',
						'features/wave':
							'!wave <num?>\nSkip 1 or N waves immediately, bypassing the waitEnemies map rule that hides the skip button while enemies are alive.\n\n!wave <num?>\nSkip 1 wave, or N waves one per second. Call again while skipping to cancel.\n\nRequires admin or host on multiplayer servers.',
						'features/aimbot':
							'!aim\nAimbot - automatically aims and shoots at enemies based on your preset config.\n\n!aim\nOpens the settings UI (draggable widget).\n\nPer-preset options:\nAttack Units / Blocks - toggle enemy unit and building targeting\nHeal Blocks - target damaged friendly buildings\nPredict Fire - leads moving targets based on bullet speed and ping\nPredict Tiles - extra search radius beyond weapon range for prediction\nConstant Fire - always shoots forward with no target needed\nDisable Shoot on Reload - stops shooting while reloading\nPriority - Nearest / Farthest / Min-Max Current HP / Min-Max Max HP\nType Order - priority order between units, blocks, heal\nTarget Filter - Default / Ground-Air / Air-Ground / Ground Only / Air Only\n\nIgnored targets (missiles, world processors, etc) can be set as CSV in the settings dialog.\n\nTap a unit/block to lock it as priority target. Tap empty space to release.\n\nMay contains bugs with some units/weapons.',
						'core/users':
							'!users | !user\nDetects other players on the server who are also using QoL Control. Detection is passive and automatic, no action needed. You get a notification in chat when a new mod user is found.',
						'features/track':
							"!track <name?>\nShows cursor position of all players / selected player and unit controlled by RTS and unit factory's set path.\n\n!track <rts/rec>\nTurns on/off displays of players rts / reconstructor rally.",
						'features/plan_range':
							'Plan Range & Block Highlight\nHighlights the range of planned blocks, as well as currently selected overdrive projectors (and domes) and mass drivers.',
						'features/multitask':
							'Multitask (Shoot while Building/Mining)\nAllows you to shoot enemies without interrupting your mining or building processes. Your unit will automatically rotate its weapons to shoot at your cursor or the nearest enemy while still finishing the current build/mine task.',
						'ui/render':
							'!render <bullet/unit/block/layer> <1/0?>\nToggles render of <?> (may have some issues on PC, or with using other mods, layers cursed af).',
						'ui/camera':
							'Camera lock button\nLocks your unit, while you can move your camera anywhere.',
						'ui/table':
							'!table\nTable of schematics which can be changed and moved.\n\n!table rows/cols <val>\nSets rows / columns of table.\n\n!table size <val>\nSets button size.\n\n!table reset\nResets table.\n\n!table toggle <1/0?>\nToggles On / Off table display.',
						'ui/buildpause': 'Build pause button\nPauses building.',
						'ui/binfo':
							'Build info\nShows build info (name, team, hp, itmes, liquids, power, battery) when hover/tap on it',
						'ui/core':
							'!core <#team>\nDisplays core resourses of team #id you selected, can displays multiple.\nSupports sharded, crux, malis, green, blue also.!core will show core resourses of your team.',
						'ui/quickchat':
							'Quick chat button.\nYou can add your own quick text buttons to send them in chat.\nYou can send multiple messages with a single just write them on separate lines.\nLong texts that exceed the games 150 character limit are automatically split into several messages.\nIncludes a default Auto Execute button that automatically sends your text or commands every time you join server/world. It has crash protection that disables it if the game crashes during execution.',
						'ui/map':
							'Custom map\nAdds a draggable real time minimap that displays terrain, better units, other players (eye icons / nicknames), and your current camera viewport.\nUse !cmap to setting it.\nLeft-click / Tap: Opens the standard full-screen map.\nLeft-drag / Tap & drag: Moves the minimap widget around the screen.\nRight-click / Long-press (0.4s): Instantly teleports your camera to the selected location.\nRight-drag / Long-press & drag: Smoothly pans your camera across the map.',
					};

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

		Vars.content.units().each((u) => {
			u.rotateSpeed = 9999;
			u.omniMovement = true;
		});
	})
);

Events.on(
	WorldLoadEvent,
	cons((e) => {
		Vars.content.units().each((u) => {
			u.rotateSpeed = 9999;
			u.omniMovement = true;
		});
	})
);
