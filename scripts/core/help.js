const notify = require('qol-control/core/logger').notify;
const interceptor = require('qol-control/core/interceptor');

const helpData = {
	'features/trace': {
		cmd: 'trace',
		desc: '[lightgrey]Finds a unit [in your team and not controlled by player/processor] and tries to possess it\n\n[accent]!trace <1/0?>[lightgrey] - on/off\n[accent]set <unitType>[lightgrey] - set specific unit type to search and possess\n[accent]find[lightgrey] - possess the highest-priority unit found [preset list in status]\n[accent]status[lightgrey] - show trace status\n\n[accent]Shortcuts:[lightgrey] !tr <1/0?> | !tr s <unit> | !tr f | !tr st',
	},
	'features/ai': {
		cmd: 'ai',
		desc: '[lightgrey]AI control for your unit\n\n[accent]!ai\nmining <items?> <1/0?>[lightgrey] - mine lowest core resources available on map [vanilla mineable only]\nwrite items separated by space to toggle them [status shows: green[ON] red[OFF] grey[NOT FOUND]]\n[accent]build <name? | -1> <1/0?>[lightgrey] - assist building/deconstructing; write part of nickname to help specific player [-1 to reset]\n[accent]lock <1/0?>[lightgrey] - lock position and mining target\n[accent]status[lightgrey] - show AI status\n\n[accent]Shortcuts:[lightgrey] !ai m <item?> <1/0?> | !ai b <name? | -1> <1/0?> | !ai l <1/0?> | !ai s',
	},
	'features/mining': {
		cmd: 'mining',
		desc: '[lightgrey]Mining control for mono/poly/pulsar/quasar/mega\n\n[accent]!mining ui[lightgrey] - opens visual settings UI\n[accent]!mining <units/items> <1/0?>[lightgrey] - toggle units/items [ON/OFF], multiple allowed\n[accent]set <sec>[lightgrey] - enable mining algorithm (repeats every <sec> sec)\n[accent]stop[lightgrey] - stop mining algorithm\n[accent]save[lightgrey] - saves current settings as default\n[accent]free <val%>[lightgrey] - sets % of units that can be taken from mining by rts by any player\n[accent]ignore <unit> <items.../clear> <1/0?>[lightgrey] - toggle items for specific unit type\n\n[accent]Shortcuts:[lightgrey] !m ui | !m <units/items?> <1/0?> | !m s <sec> | !m stop | !m save | !m f <val%> | !m ig <unit> <items.../clear>',
	},
	'features/playermine': {
		cmd: 'mine',
		desc: '[lightgrey]Player Auto-Mine (automated player copper/lead mining with dynamic balance when core resources are low)\n\n[accent]!mine <1/0?>[lightgrey] - toggle player auto-mine\n[accent]!mine <s/settings>[lightgrey] - open auto-mine threshold configuration UI',
	},
	'features/select': {
		cmd: 'select',
		desc: '[lightgrey]Select Units\n\n[accent]!select <units...>[lightgrey] - Enables RTS control and selects all specified units on the map belonging to your team\nExample: !select poly mega',
	},
	'features/assist': {
		cmd: 'assist',
		desc: '[lightgrey]Builder mode (units will only build your blueprints)\n\n[accent]!assist <1/0?>[lightgrey] - on/off\n[accent]!assist <unit> <1/0?>[lightgrey] - toggle specific unit\n[accent]!assist max <unit> <val>[lightgrey] - set max units to use\n[accent]!assist range <val>[lightgrey] - set search radius (in blocks)\n[accent]!assist status[lightgrey] - show settings\n[accent]!assist save[lightgrey] - saves current settings as default\n\n[accent]Shortcuts:[lightgrey] !as <1/0?> | !as <unit> <1/0?> | !as m <unit> <val> | !as r <val> | !as s | !as save',
	},
	'features/lookat': {
		cmd: 'lookat',
		desc: '[accent]!lookat <x> <y>[lightgrey] - move camera to coordinates\n[accent]!lookat last <n?>[lightgrey] - use one of last 9 found coordinates from chat history\n\n[accent]Shortcuts:[lightgrey] !la <x> <y> | !ls l <n?>',
	},
	'features/cghost': {
		cmd: 'cghost',
		desc: '[accent]!cghost[lightgrey] - clear ghost blocks in enemy turret range',
	},
	'features/hp': {
		cmd: 'hp',
		desc: '[accent]!hp <name?> <1/0?>[lightgrey] - toggle HP/shield/DPS display of last shot unit; nickname sets priority target',
	},
	'features/autograb': {
		cmd: 'grab',
		desc: '[lightgrey]Auto-grab <item> from blocks in unit range\n\n[accent]!grab <1/0?>[lightgrey] - on/off\n[accent]!grab <item>[lightgrey] - set item to grab [auto-enables]\n[accent]!grab min <val>[lightgrey] - minimum amount to grab\n[accent]!grab status[lightgrey] - grab status\n[accent]!grab effects <1/0?>[lightgrey] - on/off blocks effect display\n\n[accent]Shortcuts:[lightgrey] !gr <item> | !gr <1/0?> | !gr min <val> | !gr s | !gr e',
	},
	'features/trange': {
		cmd: 'trange',
		desc: '[accent]!trange <1/0?>[lightgrey] - toggle nearby enemy turret range display blue[AIR] brown[GROUND] purple[BOTH] (uses FPS)',
	},
	'features/urange': {
		cmd: 'urange',
		desc: '[accent]!urange <1/0?>[lightgrey] - toggle nearby enemy unit range display blue[AIR] brown[GROUND] purple[BOTH] (uses FPS)',
	},
	'features/mlog': {
		cmd: 'mlog',
		desc: '[lightgrey]Mlog inserter\n\n[accent]!mlog <filename>[lightgrey] - insert /qol/mlog/<filename>.txt into any empty processor\n[accent]!mlog <filename> set[lightgrey] - select processor manually by shooting it\n[accent]!mlog list[lightgrey] - see aviable mlog codes\n[accent]!mlog remove <filename>[lightgrey] - removes .txt file',
	},
	'features/detector': {
		cmd: 'detector',
		desc: '[accent]!detector <regexName>[lightgrey] - remove all code-like processors [regexs & config: !mlog/attem.json]\n[accent]!detector log[lightgrey] - shows last coords of all removed codes\n\n[accent]Shortcuts:[lightgrey] !dt <name> | !dt log',
	},
	'features/autofill': {
		cmd: 'autofill',
		desc: '[accent]!autofill <1/0?>[lightgrey] - toggle autofill turrets, factories, reconstructors, and projectors\n[accent]!autofill <s/settings>[lightgrey] - open autofill priority & visual configuration GUI\n\n[accent]Shortcuts:[lightgrey] !af <1/0?> | !af s',
	},
	'ui/render': {
		cmd: 'render',
		desc: '[accent]!render <unit|block|bullet|layer> <1/0?>[lightgrey] - off/on some render things',
	},
	'ui/table': {
		cmd: 'table',
		desc: '[lightgrey]Schematic table\n\n[accent]!table <1/0?>[lightgrey] - on/off\n[accent]!table <rows | cols> <val>[lightgrey] - changes rows / collumns of table\n[accent]!table size <val>[lightgrey] - sets table buttoms size\n[accent]!table reset[lightgrey] - resets table to default',
	},
	'features/logger': {
		cmd: 'log',
		desc: "Logs all player (in your team) actions in the UI & .txt\n\n[accent]!log <1/0?>[lightgrey] - on/off\n[accent]!log <name?>[lightgrey] - shows all players' actions (or by name)\n[accent]!log show <name?>[lightgrey] - shows all logs on the map (or of one player), may cause FPS drops\n[accent]!log revert <name>[lightgrey] - adds all destroyed buildings (by <name>) to your build plan\n[accent]!log status[lightgrey] - logger status\n[accent]!log chat[lightgrey] - chat logs (join/leave/ingame name change)\n[accent]!log save [path?][lightgrey] - saves logs as a separate .txt file (optional custom path)\n[accent]!log path [path/reset?][lightgrey] - view or set custom directory/file path for saves",
	},
	'features/here': {
		cmd: 'here',
		desc: '[accent]!here <text?>[lightgrey] - send camera coordinates to global chat (optional text allowed)\n[accent]!herec <text?>[lightgrey] - send cursor coordinates to global chat (optional text allowed)',
	},
	'features/server': {
		cmd: 'server',
		desc: '[lightgrey]Server manager\n\n[accent]!server[lightgrey] - opens UI to manage and connect to servers',
	},
	'features/mute': {
		cmd: 'mute',
		desc: '[lightgrey]Local chat mute for specific players\n\n[accent]!mute\nlist[lightgrey] - show all muted players\n[accent]add <name>[lightgrey] - mute exact player name\n[accent]addp <name>[lightgrey] - mute any player containing this name (partial)\n[accent]remove <name>[lightgrey] - unmute player\n\n[accent]Shortcuts:[lightgrey] !mute rem <name>',
	},
	'features/map': { cmd: 'map', desc: '[lightgrey]Shows current map stats' },
	'core/bind': { cmd: 'bind', desc: '[lightgrey]Keybinding for PC users' },
	'features/track': {
		cmd: 'track',
		desc: "[lightgrey]Shows cursor and RTS control of players and unit factory's set path\n\n[accent]!track <name?>[lightgrey] - all players / selected by name\n[accent]!track <rts/rec>[lightgrey] - on/off displays of player rts/reconstructor rally\n[accent]!track <notify/n> <1/0?>[lightgrey] - toggle chat alerts for RTS and Rally moves",
	},
	'features/wave': {
		cmd: 'wave',
		desc: '[lightgrey]Skip waves, bypassing the waitEnemies map rule\n\n[accent]!wave <num?>[lightgrey] - skip 1 or N waves (call again to cancel)\n[accent]!wave status[lightgrey] - show wave info and current rules\n\n[lightgrey]Requires admin or host on servers.',
	},
	'features/aimbot': {
		cmd: 'aim',
		desc: '[lightgrey]Aimbot - auto aims and shoots at enemies\n\n[accent]!aim[lightgrey] - opens settings UI\n\nPer-preset options: attack units/blocks, heal blocks, predict fire, predict tiles, constant fire, disable shoot on reload, priority (Nearest/Farthest/Min-Max HP), type order (units/blocks/heal), target filter (Default/Ground/Air/etc)\n\nIgnored targets: set as CSV in the settings dialog (missiles, world processors, etc)\n\nTap a unit/block to lock it as priority target. Tap empty space to release.\n\nMay contains bugs with some units/weapons.',
	},
	'features/omnirot': {
		cmd: 'omnirot',
		desc: '[lightgrey]Fast rotation and omni-directional movement for all units',
	},
	'core/users': {
		cmd: 'users',
		desc: '[lightgrey]Detects other QoL Control users on the server\n\nDetection is passive and automatic, no action needed. You get a notification when a new mod user is found.\n\n[accent]!users[lightgrey] | [accent]!user[lightgrey] - list all currently detected QoL users on server',
	},
	'ui/core': {
		cmd: 'core',
		desc: '[lightgrey]Shows core resources of teams on map\n\n[accent]!core <#team>[lightgrey] - toggles core resources display of team #id or name\n[accent]!core all[lightgrey] - toggles core resource panels for ALL teams with active cores on the map',
	},
	'ui/map': {
		cmd: 'cmap',
		desc: '[lightgrey]Custom map with some features\n[accent]!cmap[lightgrey] - settings\n\nOptions: Enable Minimap, Unit Outlines, Sort Units by HP (disable on low-end devices), Player Display (Icon/Name), Map Size, Unit Size',
	},
	'ui/cbinds': {
		cmd: 'cbinds',
		desc: '[lightgrey]Custom Screen Binds\nCreate draggable on-screen buttons with custom sizes, icons, and commands.\n\n[accent]!cbinds[lightgrey] - opens settings UI to create/edit custom buttons\n[accent]!cbinds lock <1/0?>[lightgrey] - lock or unlock custom button positions to prevent accidental dragging\n\n[accent]Shortcuts:[lightgrey] !cbind | !cbind lock',
	},
	'core/colors': {
		cmd: 'colors',
		desc: '[accent]!colors [lightgrey] - customise your mindustry colors from Pal.java',
	},
};

interceptor.add('qol', (args) => {
	let activeModules = global.qolActiveModules || [];
	let subcmd = args[1];

	if (subcmd === 'features') {
		notify(
			"[lightgrey]Camera lock button\nbuild pause button\nquick chat button\nHeavy optimisation\nno Zoom limit"
		);
		return;
	}

	if (subcmd === 'status' || subcmd === 'st') {
		const toggleableFeatures = [
			{ key: 'qol-assist-enabled', def: false, msg: '[lightgrey]Assist [green]ON' },
			{ key: 'qol-track-enabled', def: false, msg: '[lightgray]Tracking [green]ON' },
			{ key: 'qol-logger-enabled', def: false, msg: '[lightgrey]Logger [green]ON' },
			{ key: 'qol-playermine-enabled', def: false, msg: '[lightgray]Player Auto-Mine:[] [green]ON[]' },
			{ key: 'qol-autofill-enabled', def: false, msg: '[lightgrey]Autofill [green]ON' },
			{ key: 'qol-grab-active', def: false, msg: '[lightgrey]Grab [green]ON' },
			{ key: 'qol-aim-active', def: false, msg: '[lightgrey]Aimbot [green]ON' },
			{ key: 'qol-trange-enabled', def: false, msg: '[lightgrey]Turret Ranges [green]ON' },
			{ key: 'qol-urange-enabled', def: false, msg: '[lightgrey]Enemy Unit Ranges [green]ON' },
			{ key: 'qol-hp-enabled', def: true, msg: '[lightgrey]HP Display [green]ON' }
		];
		let any = false;
		toggleableFeatures.forEach((t) => {
			if (Core.settings.getBool(t.key, t.def)) {
				notify(t.msg);
				any = true;
			}
		});
		if (!any) notify('[lightgray]No active toggles');
		return;
	}

	let found = false;
	for (let mod of activeModules) {
		if (helpData[mod] && helpData[mod].cmd === subcmd) {
			notify(helpData[mod].desc);
			found = true;
			break;
		}
	}

	if (!found) {
		let availableCmds = [];
		for (let mod of activeModules) {
			if (helpData[mod]) {
				availableCmds.push('[lightgrey]' + helpData[mod].cmd);
			}
		}
		if (activeModules.includes('features/lookat'))
			availableCmds.push('[lightgrey]here');

		let cmdsStr = availableCmds.join('[accent] | ');
		notify(
			'[accent]!qol <cmd>[lightgrey] - command info\n\n[accent]Available commands[lightgrey]\n' +
				cmdsStr +
				'\n\n[accent]features\n\nyou may read more detailed commands information on github mod page (dont forget a star)\n\n[all commands use ! or ? prefix]'
		);
	}
});
