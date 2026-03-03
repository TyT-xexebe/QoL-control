const notify = (text) => Vars.ui.chatfrag.addMessage(text);

const state = {
    units: { mono: true, poly: false, pulsar: true, mega: true, quasar: true },
    items: { copper: true, lead: true, sand: true, coal: true, titanium: true, beryllium: true, scrap: false },
    itemTiers: { copper: 1, lead: 1, sand: 1, scrap: 1, coal: 2, titanium: 3, beryllium: 3 },
    interval: 0
};

try {
    let u = Core.settings.getString("qol-mining-units", "");
    if(u) Object.assign(state.units, JSON.parse(u));
    let i = Core.settings.getString("qol-mining-items", "");
    if(i) Object.assign(state.items, JSON.parse(i));
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
let lastDistribution = {};

function runMining() {
    const player = Vars.player;
    if (!player || !player.team() || !Vars.state.isGame()) return;
    
    const core = player.team().core();
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
    Groups.unit.each(u => {
        let isAssisting = global.qolAssistingUnits && global.qolAssistingUnits[u.id];

        if (u.team === player.team() && !u.dead && u.type.mineTier > 0 && 
            u.player == null && state.units[u.type.name] && !(u.controller() instanceof LogicAI) && 
            !isAssisting) {
            
            if (!unitGroups[u.type.name]) unitGroups[u.type.name] = [];
            unitGroups[u.type.name].push(u);
        }
    });

    lastDistribution = {};

    for (let typeName in unitGroups) {
        let list = unitGroups[typeName];
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

Events.on(EventType.WorldLoadEvent, () => {
    lastDistribution = {};
    if (miningTask) {
        miningTask.cancel();
        miningTask = null;
    }
});

Events.on(EventType.ClientChatEvent, e => {
    let args = String(e.message).trim().toLowerCase().split(" ");
    if (args[0] !== "/mining") return;

    if (args[1] === "stop") {
        if (miningTask) {
            miningTask.cancel();
            miningTask = null;
            notify("[scarlet]Mining stopped");
        } else notify("[lightgrey]Mining not running");
        return;
    }

    if (args[1] === "save") {
        Core.settings.put("qol-mining-units", JSON.stringify(state.units));
        Core.settings.put("qol-mining-items", JSON.stringify(state.items));
        notify("[green]Mining settings saved");
        return;
    }

    if (args[1] === "set") {
        let time = parseFloat(args[2]);
        if (isNaN(time) || time < 0) return notify("[lightgrey]/mining set <sec>");
        
        state.interval = time;
        if (time === 0) {
            runMining();
            notify("[green]Mining executed once");
        } else {
            if (miningTask) miningTask.cancel();
            miningTask = Timer.schedule(() => {
                try { runMining(); } catch(err) { if (miningTask) miningTask.cancel(); miningTask = null; }
            }, 0, time);
            notify("[green]Mining started ([accent]" + time + "[green]s)");
        }
        return;
    }

    if (args[1] === "status") {
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
                       "\n[lightgrey]Items " + iStr;
                       
        if (statsStr !== "") finalMsg += "\n\n[lightgrey]Stats:" + statsStr;
        
        notify(finalMsg);
        return;
    }

    if (args.length > 1) {
        let changed = [];
        for (let i = 1; i < args.length; i++) {
            let key = args[i];
            if (state.units.hasOwnProperty(key)) {
                state.units[key] = !state.units[key];
                changed.push((state.units[key] ? "[green]" : "[scarlet]") + key);
            } else if (state.items.hasOwnProperty(key)) {
                state.items[key] = !state.items[key];
                changed.push((state.items[key] ? "[green]" : "[scarlet]") + key);
            }
        }
        if (changed.length > 0) return notify("[lightgrey]Toggle " + changed.join(" "));
    }

    notify("[lightgray]/mining status\n/mining <units/items?>\n/mining set <sec>\n/mining stop\n/mining save");
});
