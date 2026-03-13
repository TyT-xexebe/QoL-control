const notify = require("qol-control/core/logger").notify;
const interceptor = require("qol-control/core/interceptor");

const state = {
    units: { mono: true, poly: false, pulsar: true, mega: true, quasar: true },
    items: { copper: true, lead: true, sand: true, coal: true, titanium: true, beryllium: true, scrap: false },
    itemTiers: { copper: 1, lead: 1, sand: 1, scrap: 1, coal: 2, titanium: 3, beryllium: 3 },
    interval: 0,
    freePercent: 50
};

try {
    let u = Core.settings.getString("qol-mining-units", "");
    if(u) Object.assign(state.units, JSON.parse(u));
    let i = Core.settings.getString("qol-mining-items", "");
    if(i) Object.assign(state.items, JSON.parse(i));
    let f = Core.settings.getInt("qol-mining-free", 50);
    state.freePercent = f;
} catch(e) {}

const itemColors = {
    copper: "[#d99d73]", 
    lead: "[#8c7fa9]", 
    sand: "[#e8d174]",
    coal: "[#595959]", 
    titanium: "[#8da1e3]", 
    beryllium: "[#54b582]", 
    scrap: "[#9b9b9b]"
};

let miningTask = null;
let idleTrackerTask = null;
let unitIdleData = {};
let lastDistribution = {};

function startIdleTracker() {
    if (idleTrackerTask) return;
    unitIdleData = {};
    idleTrackerTask = Timer.schedule(() => {
        if (!Vars.state.isGame()) return;
        let currentIds = {};
        const playerTeam = Vars.player.team();
        Groups.unit.each(u => {
            if (u.team === playerTeam && !u.dead && u.type.mineTier > 0) {
                currentIds[u.id] = true;
                let data = unitIdleData[u.id];
                if (!data) {
                    unitIdleData[u.id] = { x: u.x, y: u.y, time: 0 };
                } else {
                    if (Mathf.dst2(u.x, u.y, data.x, data.y) < 256) {
                        data.time += 1;
                    } else {
                        data.x = u.x;
                        data.y = u.y;
                        data.time = 0;
                    }
                }
            }
        });
        for (let id in unitIdleData) {
            if (!currentIds[id]) delete unitIdleData[id];
        }
    }, 0, 1);
}

function stopIdleTracker() {
    if (idleTrackerTask) {
        idleTrackerTask.cancel();
        idleTrackerTask = null;
    }
    unitIdleData = {};
}

function runMining() {
    const player = Vars.player;
    if (!player || !Vars.state.isGame()) return;
    
    const playerTeam = player.team();
    if (!playerTeam) return;
    
    const core = playerTeam.core();
    if (!core) return;

    const validItems = [];
    const priorities = new ObjectMap();
    
    let capacity = core.storageCapacity || 4000;
    let limit = Math.max(0, capacity - 500);
    
    Vars.content.items().each(it => {
        if (state.items[it.name] && (Vars.indexer.hasOre(it) || (Vars.indexer.hasWallOre && Vars.indexer.hasWallOre(it)))) {
            let amount = core.items.get(it);
            if (amount < limit) {
                validItems.push(it);
                priorities.put(it, 1 / Math.max(amount, 1));
            }
        }
    });

    if (validItems.length === 0) {
        lastDistribution = {};
        return;
    }

    const unitGroups = {};
    const playerCommandedGroups = {};

    Groups.unit.each(u => {
        let isAssisting = global.qolAssistingUnits && global.qolAssistingUnits[u.id];

        if (u.team === playerTeam && !u.dead && u.type.mineTier > 0 && 
            u.player == null && state.units[u.type.name] && !(u.controller() instanceof LogicAI) && 
            !isAssisting) {
            
            let typeName = u.type.name;
            if (!unitGroups[typeName]) {
                unitGroups[typeName] = [];
                playerCommandedGroups[typeName] = [];
            }

            let isPlayerCommanded = false;
            try {
                let ctrl = u.controller();
                if (ctrl) {
                    let cmd = ctrl.command;
                    if (cmd && cmd !== UnitCommand.mineCommand) {
                        isPlayerCommanded = true;
                    } else {
                        let leader = ctrl.leader;
                        if (leader && leader.controller) {
                            let lCtrl = leader.controller();
                            if (lCtrl && lCtrl.command && lCtrl.command !== UnitCommand.mineCommand) {
                                isPlayerCommanded = true;
                            }
                        }
                    }
                }
            } catch(e) {}

            if (isPlayerCommanded) {
                let idleData = unitIdleData[u.id];
                if (idleData && idleData.time >= 5) {
                    isPlayerCommanded = false;
                }
            }

            if (isPlayerCommanded) {
                playerCommandedGroups[typeName].push(u);
            } else {
                unitGroups[typeName].push(u);
            }
        }
    });

    for (let typeName in playerCommandedGroups) {
        let playerUnits = playerCommandedGroups[typeName];
        let miningUnits = unitGroups[typeName];
        let total = playerUnits.length + miningUnits.length;
        let maxPlayerUnits = Math.floor(total * (state.freePercent / 100));

        while (playerUnits.length > maxPlayerUnits) {
            miningUnits.push(playerUnits.pop());
        }
    }

    lastDistribution = {};

    for (let typeName in unitGroups) {
        let list = unitGroups[typeName];
        if (list.length === 0) continue;
        
        let tier = list[0].type.mineTier;
        let availableForUnit = validItems.filter(it => (state.itemTiers[it.name] || 1) <= tier);
        if (availableForUnit.length === 0) continue;

        let totalPriority = 0;
        availableForUnit.forEach(it => totalPriority += priorities.get(it));

        let sumAssigned = 0, assignments = [];

        availableForUnit.forEach(it => {
            let count = Math.floor((priorities.get(it) / totalPriority) * list.length);
            assignments.push({ item: it, count: count, mod: ((priorities.get(it) / totalPriority) * list.length) - count });
            sumAssigned += count;
        });

        if (sumAssigned < list.length) {
            assignments.sort((a, b) => b.mod - a.mod);
            for (let i = 0; i < (list.length - sumAssigned); i++) assignments[i].count++;
        }

        lastDistribution[typeName] = {};
        assignments.forEach(as => {
            if (as.count > 0) {
                lastDistribution[typeName][as.item.name] = as.count;
            }
        });

        let itemNeeds = {};
        let unitsToCommand = {};
        
        assignments.forEach(as => {
            itemNeeds[as.item.name] = as.count;
            unitsToCommand[as.item.name] = { item: as.item, ids: new IntSeq() };
        });

        let unassignedUnits = [];

        list.forEach(u => {
            let currentItem = null;
            if (u.mineTile && u.mineTile.drop()) {
                currentItem = u.mineTile.drop();
            }
            if (!currentItem && u.controller() && u.controller().targetItem) {
                currentItem = u.controller().targetItem;
            }

            if (currentItem && itemNeeds[currentItem.name] > 0) {
                itemNeeds[currentItem.name]--;
            } else {
                unassignedUnits.push(u);
            }
        });

        assignments.forEach(as => {
            let needed = itemNeeds[as.item.name];
            let cmdObj = unitsToCommand[as.item.name];
            for (let i = 0; i < needed; i++) {
                if (unassignedUnits.length > 0) {
                    let u = unassignedUnits.pop();
                    cmdObj.ids.add(u.id);
                }
            }
            
            if (cmdObj.ids.size > 0) {
                Call.setUnitCommand(player, cmdObj.ids.toArray(), UnitCommand.mineCommand);
                let stance = ItemUnitStance.getByItem(cmdObj.item);
                if (stance) {
                    Call.setUnitStance(player, cmdObj.ids.toArray(), UnitStance.mineAuto, false);
                    Call.setUnitStance(player, cmdObj.ids.toArray(), stance, true);
                }
            }
        });
    }
}

Events.on(WorldLoadEvent, () => {
    lastDistribution = {};
    if (miningTask) {
        miningTask.cancel();
        miningTask = null;
    }
    stopIdleTracker();
});

const miningHandler = (args) => {
    if (args[1] === "stop") {
        if (miningTask) {
            miningTask.cancel();
            miningTask = null;
            stopIdleTracker();
            notify("[scarlet]Mining stopped");
        } else notify("[lightgrey]Mining not running");
        return;
    }

    if (args[1] === "save") {
        Core.settings.put("qol-mining-units", JSON.stringify(state.units));
        Core.settings.put("qol-mining-items", JSON.stringify(state.items));
        Core.settings.put("qol-mining-free", state.freePercent);
        notify("[green]Mining settings saved");
        return;
    }

    if (args[1] === "free" || args[1] === "f") {
        let pct = parseInt(args[2]);
        if (isNaN(pct) || pct < 0 || pct > 100) return notify("[lightgrey]!mining free <0-100>");
        state.freePercent = pct;
        notify("[green]Free units set to [accent]" + pct + "%");
        return;
    }

    if (args[1] === "set" || args[1] === "s") {
        let time = parseFloat(args[2]);
        if (isNaN(time) || time < 0) return notify("[lightgrey]!mining set <sec>");
        
        state.interval = time;
        if (time === 0) {
            runMining();
            notify("[green]Mining executed once");
        } else {
            if (miningTask) miningTask.cancel();
            miningTask = Timer.schedule(() => {
                try { runMining(); } catch(err) { if (miningTask) miningTask.cancel(); miningTask = null; stopIdleTracker(); }
            }, 0, time);
            startIdleTracker();
            notify("[green]Mining started ([accent]" + time + "[green]s)");
        }
        return;
    }

    if (args[1] === "status" || args[1] === "st") {
        let uStr = "", iStr = "";
        for (let k in state.units) uStr += (state.units[k] ? "[green]" : "[scarlet]") + k + " ";
        for (let k in state.items) iStr += (state.items[k] ? "[green]" : "[scarlet]") + k + " ";
        
        let statsStr = "";
        for (let uName in state.units) {
            if (!state.units[uName] || !lastDistribution[uName]) continue;
            
            let row = "";
            let uStats = lastDistribution[uName];
            
            for (let iName in itemColors) {
                if (uStats[iName]) {
                    row += itemColors[iName] + uStats[iName] + " ";
                }
            }
            
            if (row !== "") {
                statsStr += "\n[lightgrey]" + uName + " | " + row;
            }
        }
        
        let finalMsg = "\n[lightgrey]State " + (miningTask ? "[lightgrey]Active ([accent]" + state.interval + "[lightgrey]s)" : "[scarlet]Inactive") +
                       "\n[lightgrey]Units " + uStr +
                       "\n[lightgrey]Items " + iStr +
                       "\n[lightgrey]Free " + "[accent]" + state.freePercent + "%";
                       
        if (statsStr !== "") finalMsg += "\n\n[lightgrey]Stats:" + statsStr;
        
        notify(finalMsg);
        return;
    }

    if (args.length > 1) {
        let changed = [];
        let lastArg = args[args.length - 1];
        let explicitState = null;
        
        if (lastArg === "1" || lastArg === "true" || lastArg === "on") explicitState = true;
        else if (lastArg === "0" || lastArg === "false" || lastArg === "off") explicitState = false;
        
        let limit = explicitState !== null ? args.length - 1 : args.length;
        
        for (let i = 1; i < limit; i++) {
            let key = args[i];
            if (state.units.hasOwnProperty(key)) {
                state.units[key] = explicitState !== null ? explicitState : !state.units[key];
                changed.push((state.units[key] ? "[green]" : "[scarlet]") + key);
            } else if (state.items.hasOwnProperty(key)) {
                state.items[key] = explicitState !== null ? explicitState : !state.items[key];
                changed.push((state.items[key] ? "[green]" : "[scarlet]") + key);
            }
        }
        if (changed.length > 0) return notify("[lightgrey]Toggle " + changed.join(" "));
    }

    notify("[lightgray]!mining status\n!mining <units/items?> <1/0?>\n!mining set <sec>\n!mining free <0-100>\n!mining stop\n!mining save\n\n!m st\n!m <units/items?> <1/0?>\n!m s <sec>\n!m f <0-100>\n!m stop\n!m save");
};

interceptor.add("mining", miningHandler);
interceptor.add("m", miningHandler);
