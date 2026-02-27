const notify = (text) => Vars.ui.chatfrag.addMessage(text);

const state = {
    units: { mono: true, poly: true, pulsar: true, mega: true, quasar: true },
    items: { copper: true, lead: true, sand: true, coal: true, titanium: true, beryllium: true, scrap: true },
    itemTiers: { copper: 1, lead: 1, sand: 1, scrap: 1, beryllium: 1, coal: 2, titanium: 3 },
    interval: 0
};

let miningTask = null;

function runMining() {
    const player = Vars.player;
    if (!player || !player.team() || !Vars.state.isGame()) return;
    
    const core = player.team().core();
    if (!core) return;

    const validItems = [];
    const priorities = new ObjectMap();
    
    Vars.content.items().each(it => {
        if (state.items[it.name] && (Vars.indexer.hasOre(it) || (Vars.indexer.hasWallOre && Vars.indexer.hasWallOre(it)))) {
            validItems.push(it);
            priorities.put(it, 1 / Math.max(core.items.get(it), 1));
        }
    });

    if (validItems.length === 0) return;

    const unitGroups = {};
    Groups.unit.each(u => {
        if (u.team === player.team() && !u.dead && u.type.mineTier > 0 && 
            u.player == null && state.units[u.type.name] && !(u.controller() instanceof LogicAI)) {
            if (!unitGroups[u.type.name]) unitGroups[u.type.name] = [];
            unitGroups[u.type.name].push(u);
        }
    });

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
            let cmd = unitsToCommand[as.item.name];
            for (let i = 0; i < needed; i++) {
                if (unassignedUnits.length > 0) {
                    let u = unassignedUnits.pop();
                    cmd.ids.add(u.id);
                }
            }
            
            if (cmd.ids.size > 0) {
                Call.setUnitCommand(player, cmd.ids.toArray(), UnitCommand.mineCommand);
                let stance = ItemUnitStance.getByItem(cmd.item);
                if (stance) {
                    Call.setUnitStance(player, cmd.ids.toArray(), UnitStance.mineAuto, false);
                    Call.setUnitStance(player, cmd.ids.toArray(), stance, true);
                }
            }
        });
    }
}

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
        
        notify("\n[lightgrey]State " + (miningTask ? "[lightgrey]Active ([accent]" + state.interval + "[lightgrey]s)" : "[scarlet]Inactive") +
               "\n[lightgrey]Units " + uStr +
               "\n[lightgrey]Items " + iStr);
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

    notify("[lightgray]/mining status\n/mining <units/items?>\n/mining set <sec>\n/mining stop");
});
