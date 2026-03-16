const notify = require("qol-control/core/logger").notify;
const interceptor = require("qol-control/core/interceptor");

const helpData = {
    "features/trace": { cmd: "trace", desc: "[lightgrey]Finds a unit [in your team and not controlled by player/processor] and tries to possess it\n\n[accent]!trace\ntoggle <1/0?>[lightgrey] - on/off\n[accent]set <unitType>[lightgrey] - set specific unit type to search and possess\n[accent]find[lightgrey] - possess the highest-priority unit found [preset list in status]\n[accent]status[lightgrey] - show trace status\n\n[accent]Shortcuts:[lightgrey] !tr t <1/0?> | !tr s <unit> | !tr f | !tr st" },
    "features/ai": { cmd: "ai", desc: "[lightgrey]AI control for your unit\n\n[accent]!ai\nmining <items?> <1/0?>[lightgrey] - mine lowest core resources available on map [vanilla mineable only]\nwrite items separated by space to toggle them [status shows: green[ON] red[OFF] grey[NOT FOUND]]\n[accent]build <name? | -1> <1/0?>[lightgrey] - assist building/deconstructing; write part of nickname to help specific player [-1 to reset]\n[accent]lock <1/0?>[lightgrey] - lock position and mining target\n[accent]status[lightgrey] - show AI status\n\n[accent]Shortcuts:[lightgrey] !ai m <item?> <1/0?> | !ai b <name? | -1> <1/0?> | !ai l <1/0?> | !ai s" },
    "features/mining": { cmd: "mining", desc: "[lightgrey]Mining control for mono/poly/pulsar/quasar/mega\n\n[accent]!mining\n<units/items> <1/0?>[lightgrey] - toggle units/items [ON/OFF], multiple allowed\n[accent]set <sec>[lightgrey] - enable mining algorithm (repeats every <sec> sec)\n[accent]stop[lightgrey] - stop mining algorithm\n[accent]save[lightgrey] - saves current settings as default\n[accent]free <val%>[lightgrey] - sets % of units that can be taken from mining by rts by any player\n[accent]ignore <unit> <items.../clear> <1/0?>[lightgrey] - toggle items for specific unit type\n\n[accent]Shortcuts:[lightgrey] !m <units/items?> <1/0?> | !m s <sec> | !m stop | !m save | !m s | !m f <val%> | !m ig <unit> <items.../clear>" },
    "features/assist": { cmd: "assist", desc: "[lightgrey]Builder mode (units will only build your blueprints)\n\n[accent]!assist\ntoggle <1/0?>[lightgrey] - on/off\n[accent]toggle <unit> <1/0?>[lightgrey] - toggle specific unit\n[accent]max <unit> <val>[lightgrey] - set max units to use\n[accent]range <val>[lightgrey] - set search radius (in blocks)\n[accent]status[lightgrey] - show settings\n[accent]save[lightgrey] - saves current settings as default\n\n[accent]Shortcuts:[lightgrey] !as t <1/0?> | !as t <unit> <1/0?> | !as m <unit> <val> | !as r <val> | !as s | !as save" },
    "features/lookat": { cmd: "lookat", desc: "[accent]!lookat <x> <y>[lightgrey] - move camera to coordinates\n[accent]!lookat last <n?>[lightgrey] - use one of last 9 found coordinates from chat history\n\n[accent]Shortcuts:[lightgrey] !la <x> <y> | !ls l <n?>" },
    "features/cghost": { cmd: "cghost", desc: "[accent]!cghost[lightgrey] - clear ghost blocks in enemy turret range" },
    "features/hp": { cmd: "hp", desc: "[accent]!hp <name?> <1/0?>[lightgrey] - toggle HP/shield/DPS display of last shot unit; nickname sets priority target" },
    "features/autograb": { cmd: "grab", desc: "[lightgrey]Auto-grab <item> from blocks in unit range\n\n[accent]!grab\ntoggle <1/0?>[lightgrey] - on/off\n[accent]<item>[lightgrey] - set item to grab [auto-enables]\n[accent]min <val>[lightgrey] - minimum amount to grab\n[accent]status[lightgrey] - grab status\n\n[accent]Shortcuts:[lightgrey] !gr <item> | !gr t <1/0?> | !gr min <val> | !gr s" },
    "features/trange": { cmd: "trange", desc: "[accent]!trange <1/0?>[lightgrey] - toggle nearby enemy turret range display blue[AIR] brown[GROUND] purple[BOTH] (uses FPS)" },
    "features/mlog": { cmd: "mlog", desc: "[lightgrey]Mlog inserter\n\n[accent]!mlog <filename>[lightgrey] - insert /qol/mlog/<filename>.txt into any empty processor\n[accent]!mlog <filename> set[lightgrey] - select processor manually by shooting it\n[accent]!mlog list[lightgrey] - see aviable mlog codes\n[accent]!mlog remove <filename>[lightgrey] - removes .txt file" },
    "features/detector": { cmd: "detector", desc: "[accent]!detector <regexName>[lightgrey] - remove all code-like processors [regexs & config: !mlog/attem.json]\n[accent]!detector log[lightgrey] - shows last coords of all removed codes\n\n[accent]Shortcuts:[lightgrey] !dt <name> | !dt log" },
    "features/autofill": { cmd: "autofill", desc: "[accent]!autofill <1/0?>[lightgrey] - autofills turrets\n\n[accent]Shortcuts:[lightgrey] !af <1/0?>" },
    "ui/render": { cmd: "render", desc: "[accent]!render <unit|block|bullet|layer> <1/0?>[lightgrey] - off/on some render things" },
    "ui/table": { cmd: "table", desc: "[lightgrey]Schematic table\n\n[accent]!table\ntoggle <1/0?>[lightgrey] - on/off\n[accent]<rows | cols> <val>[lightgrey] - changes rows / collumns of table\n[accent]size <val>[lightgrey] - sets table buttoms size\n[accent]reset[lightgrey] - resets table to default" },
    "features/logger": { cmd: "log", desc: "Logs all player (in your team) actions in the UI & .txt\n\n[accent]!log\n[lightgrey]toggle <1/0?> - on/off\n[accent]<name?>[lightgrey] - shows all players' actions (or by name)\n[accent]show <name?>[lightgrey] - shows all logs on the map (or of one player), may cause FPS drops\n[accent]revert <name>[lightgrey] - adds all destroyed buildings (by <name>) to your build plan\n[accent]status[lightgrey] - logger status\n[accent]save[lightgrey] - saves logs as a separate .txt file" },
    "features/here": {cmd: "here", desc: "[accent]!here <text?>[lightgrey] - send camera coordinates to global chat (optional text allowed)" },
    "features/server": { cmd: "server", desc: "[lightgrey]Server manager\n\n[accent]!server[lightgrey] - opens UI to manage and connect to servers" },
    "features/mute": { cmd: "mute", desc: "[lightgrey]Local chat mute for specific players\n\n[accent]!mute\nlist[lightgrey] - show all muted players\n[accent]add <name>[lightgrey] - mute exact player name\n[accent]addp <name>[lightgrey] - mute any player containing this name (partial)\n[accent]remove <name>[lightgrey] - unmute player\n\n[accent]Shortcuts:[lightgrey] !mute rem <name>" },
    "features/map": { cmd: "map", desc: "[lightgrey]Shows current map stats" },
    "core/bind": { cmd: "bind", desc: "[lightgrey]Keybinding for PC users" }
};

interceptor.add("qol", (args) => {
    let activeModules = global.qolActiveModules || [];
    let subcmd = args[1];
    
    if (subcmd === "features") {
        notify("[lightgrey]Fast rotation & omni-movement for all units\nCamera lock button\nbuild pause button\nquick chat button\nHeavy optimisation\nno Zoom limit\nAuto-leaves onho's units [FISH Servers]");
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
                availableCmds.push("[lightgrey]" + helpData[mod].cmd);
            }
        }
        if (activeModules.includes("features/lookat")) availableCmds.push("[lightgrey]here");
        
        let cmdsStr = availableCmds.join("[accent] | ");
        notify("[accent]!qol <cmd>[lightgrey] - command info\n\n[accent]Available commands[lightgrey]\n" + cmdsStr + "\n\n[accent]features\n\nyou may read more detailed commands information on github mod page (dont forget a star)\n\n[all commands use ! or ? prefix]");
    }
});
