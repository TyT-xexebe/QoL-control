const notify = require('qol-control/core/logger').notify;
const interceptor = require('qol-control/core/interceptor');

const helpData = {
	'features/trace': {
		cmd: 'trace',
		desc: '[lightgray]Finds a unit [in your team and not controlled by player/processor] and tries to possess it\n\n[accent]!trace\ntoggle <1/0?>[lightgray] - on/off\n[accent]set <unitType>[lightgray] - set specific unit type to search and possess\n[accent]find[lightgray] - possess the highest-priority unit found [preset list in status]\n[accent]status[lightgray] - show trace status\n\n[gray]Shortcuts:[] !tr t <1/0?> | !tr s <unit> | !tr f | !tr st',
	},
	'features/ai': {
		cmd: 'ai',
		desc: '[lightgray]AI control for your unit\n\n[accent]!ai\nmining <items?> <1/0?>[lightgray] - mine lowest core resources available on map [vanilla mineable only]\nwrite items separated by space to toggle them [status shows: green[ON] red[OFF] grey[NOT FOUND]]\n[accent]build <name? | -1> <1/0?>[lightgray] - assist building/deconstructing; write part of nickname to help specific player [-1 to reset]\n[accent]lock <1/0?>[lightgray] - lock position and mining target\n[accent]status[lightgray] - show AI status\n\n[gray]Shortcuts:[] !ai m <item?> <1/0?> | !ai b <name? | -1> <1/0?> | !ai l <1/0?> | !ai s',
	},
	'features/mining': {
		cmd: 'mining',
		desc: '[lightgray]Mining control for mono/poly/pulsar/quasar/mega\n\n[accent]!mining\n<units/items> <1/0?>[lightgray] - toggle units/items [ON/OFF], multiple allowed\n[accent]set <sec>[lightgray] - enable mining algorithm (repeats every <sec> sec)\n[accent]stop[lightgray] - stop mining algorithm\n[accent]save[lightgray] - saves current settings as default\n[accent]free <val%>[lightgray] - sets % of units that can be taken from mining by rts by any player\n[accent]ignore <unit> <items.../clear> <1/0?>[lightgray] - toggle items for specific unit type\n\n[gray]Shortcuts:[] !m <units/items?> <1/0?> | !m s <sec> | !m stop | !m save | !m s | !m f <val%> | !m ig <unit> <items.../clear>',
	},
	'features/assist': {
		cmd: 'assist',
		desc: '[lightgray]Builder mode (units will only build your blueprints)\n\n[accent]!assist\ntoggle <1/0?>[lightgray] - on/off\n[accent]toggle <unit> <1/0?>[lightgray] - toggle specific unit\n[accent]max <unit> <val>[lightgray] - set max units to use\n[accent]range <val>[lightgray] - set search radius (in blocks)\n[accent]status[lightgray] - show settings\n[accent]save[lightgray] - saves current settings as default\n\n[gray]Shortcuts:[] !as t <1/0?> | !as t <unit> <1/0?> | !as m <unit> <val> | !as r <val> | !as s | !as save',
	},
	'features/lookat': {
		cmd: 'lookat',
		desc: '[accent]!lookat <x> <y>[lightgray] - move camera to coordinates\n[accent]!lookat last <n?>[lightgray] - use one of last 9 found coordinates from chat history\n\n[gray]Shortcuts:[] !la <x> <y> | !ls l <n?>',
	},
	'features/cghost': {
		cmd: 'cghost',
		desc: '[accent]!cghost[lightgray] - clear ghost blocks in enemy turret range',
	},
	'features/hp': {
		cmd: 'hp',
		desc: '[accent]!hp <name?> <1/0?>[lightgray] - toggle HP/shield/DPS display of last shot unit; nickname sets priority target',
	},
	'features/autograb': {
		cmd: 'grab',
		desc: '[lightgray]Auto-grab <item> from blocks in unit range\n\n[accent]!grab\ntoggle <1/0?>[lightgray] - on/off\n[accent]<item>[lightgray] - set item to grab [auto-enables]\n[accent]min <val>[lightgray] - minimum amount to grab\n[accent]status[lightgray] - grab status\n[accent]effects <1/0?>[lightgray] - on/off blocks effect display\n\n[gray]Shortcuts:[] !gr <item> | !gr t <1/0?> | !gr min <val> | !gr s | !gr e',
	},
	'features/trange': {
		cmd: 'trange',
		desc: '[accent]!trange <1/0?>[lightgray] - toggle nearby enemy turret range display blue[AIR] brown[GROUND] purple[BOTH] (uses FPS)',
	},
	'features/mlog': {
		cmd: 'mlog',
		desc: '[lightgray]Mlog inserter\n\n[accent]!mlog <filename>[lightgray] - insert /qol/mlog/<filename>.txt into any empty processor\n[accent]!mlog <filename> set[lightgray] - select processor manually by shooting it\n[accent]!mlog list[lightgray] - see aviable mlog codes\n[accent]!mlog remove <filename>[lightgray] - removes .txt file',
	},
	'features/detector': {
		cmd: 'detector',
		desc: '[accent]!detector <regexName>[lightgray] - remove all code-like processors [regexs & config: !mlog/attem.json]\n[accent]!detector log[lightgray] - shows last coords of all removed codes\n\n[gray]Shortcuts:[] !dt <name> | !dt log',
	},
	'features/autofill': {
		cmd: 'autofill',
		desc: '[accent]!autofill <1/0?>[lightgray] - autofills turrets\n\n[gray]Shortcuts:[] !af <1/0?>',
	},
	'ui/render': {
		cmd: 'render',
		desc: '[accent]!render <unit|block|bullet|layer> <1/0?>[lightgray] - off/on some render things',
	},
	'ui/table': {
		cmd: 'table',
		desc: '[lightgray]Schematic table\n\n[accent]!table\ntoggle <1/0?>[lightgray] - on/off\n[accent]<rows | cols> <val>[lightgray] - changes rows / collumns of table\n[accent]size <val>[lightgray] - sets table buttoms size\n[accent]reset[lightgray] - resets table to default',
	},
	'features/logger': {
		cmd: 'log',
		desc: "Logs all player (in your team) actions in the UI & .txt\n\n[accent]!log\n[lightgray]toggle <1/0?> - on/off\n[accent]<name?>[lightgray] - shows all players' actions (or by name)\n[accent]show <name?>[lightgray] - shows all logs on the map (or of one player), may cause FPS drops\n[accent]revert <name>[lightgray] - adds all destroyed buildings (by <name>) to your build plan\n[accent]status[lightgray] - logger status\n[accent]chat[lightgray] - chat logs (join/leave/ingame name change)\n[accent]save[lightgray] - saves logs as a separate .txt file",
	},
	'features/here': {
		cmd: 'here',
		desc: '[accent]!here <text?>[lightgray] - send camera coordinates to global chat (optional text allowed)\n[accent]!herec <text?>[lightgray] - send cursor coordinates to global chat (optional text allowed)',
	},
	'features/server': {
		cmd: 'server',
		desc: '[lightgray]Server manager\n\n[accent]!server[lightgray] - opens UI to manage and connect to servers',
	},
	'features/mute': {
		cmd: 'mute',
		desc: '[lightgray]Local chat mute for specific players\n\n[accent]!mute\nlist[lightgray] - show all muted players\n[accent]add <name>[lightgray] - mute exact player name\n[accent]addp <name>[lightgray] - mute any player containing this name (partial)\n[accent]remove <name>[lightgray] - unmute player\n\n[gray]Shortcuts:[] !mute rem <name>',
	},
	'features/map': { cmd: 'map', desc: '[lightgray]Shows current map stats' },
	'core/bind': { cmd: 'bind', desc: '[lightgray]Keybinding for PC users' },
	'features/track': {
		cmd: 'track',
		desc: "[lightgray]Shows cursor and RTS control of players and unit factory's set path\n\n[accent]!track <name?>[lightgray] - all players / selected by name\n[accent]!track <rts/rec>[lightgray] - on/off displays of player rts/recpnstructor rally",
	},
	'ui/core': {
		cmd: 'core',
		desc: '[lightgray]Shows core resourses of any team on map\n\n[accent]!core <#team>[lightgray] - toggles core resourses display of team #id you selected (sharded, crux, blue, malis, green also supported)',
	},
	'ui/map': {
		cmd: 'cmap',
		desc: '[lightgray]Custom map with some features\n[accent]!cmap[lightgray] - settings',
	},
	'core/colors': {
		cmd: 'colors',
		desc: '[accent]!colors [lightgray] - customise your mindustry colors from Pal.java',
	},
};

interceptor.add('qol', (args) => {
	let activeModules = global.qolActiveModules || [];
	let subcmd = args[1];

	if (subcmd === 'features') {
		notify(
			"[lightgray]Fast rotation & omni-movement for all units\nCamera lock button\nbuild pause button\nquick chat button\nHeavy optimisation\nno Zoom limit\nAuto-leaves onho's units [FISH Servers]"
		);
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
				availableCmds.push('[lightgray]' + helpData[mod].cmd);
			}
		}
		if (activeModules.includes('features/lookat'))
			availableCmds.push('[lightgray]here');

		let cmdsStr = availableCmds.join('[accent] | ');
		notify(
			'[accent]!qol <cmd>[lightgray] - command info\n\n[accent]Available commands[lightgray]\n' +
				cmdsStr +
				'\n\n[accent]features\n\nyou may read more detailed commands information on github mod page (dont forget a star)\n\n[all commands use ! or ? prefix]'
		);
	}
});
