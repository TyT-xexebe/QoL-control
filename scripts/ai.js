let mineEnabled = false, buildEnabled = false, manualTarget = false, lockEnabled = false;
let followTarget = null, targetItem = null, targetTile = null;
let lockPos = null, lockTile = null;
let updateTimer = 0, transferTimer = 0;

let oreData = {}; 
const allowedItems = {
    "copper": true, "lead": true, "sand": true, "scrap": true,
    "coal": true, "titanium": true, "beryllium": true, "graphite": true
};

const notify = (msg) => Vars.ui.chatfrag.addMessage("[accent]󰚩 [white] " + msg);

const buildOreTree = () => {
    let start = Time.millis();
    oreData = {};
    if (!Vars.world) return;
    let w = Vars.world.width(), h = Vars.world.height();
    let count = 0;
    for (let x = 0; x < w; x++) {
        for (let y = 0; y < h; y++) {
            let tile = Vars.world.tile(x, y);
            if (!tile) continue;
            let drop = tile.drop();
            if (drop) {
                if (!oreData[drop.name]) oreData[drop.name] = [];
                oreData[drop.name].push(tile);
                count++;
            }
        }
    }
    let elapsed = (Time.millis() - start) / 1000;
    notify("[lightgrey]Ore Tree: [accent]" + count + "[lightgrey] ores was found | [accent]" + elapsed.toFixed(4) + "[lightgrey]s");
};

const findClosestFreeOre = (u, item) => {
    let tiles = oreData[item.name];
    if (!tiles) return null;
    let closest = null, minDst = Infinity;
    for (let i = 0, len = tiles.length; i < len; i++) {
        let t = tiles[i];
        if (t.block() === Blocks.air) {
            let d = u.dst2(t.worldx(), t.worldy());
            if (d < minDst) { minDst = d; closest = t; }
        }
    }
    return closest;
};

const refreshTarget = (u) => {
    if (lockEnabled || buildEnabled) return; 
    let core = u.closestCore();
    if (!u.canMine() || !core) return;

    let isErekir = u.type.name.match(/evoke|incite|emanate/);
    let items = [], contentItems = Vars.content.items();

    for (let i = 0; i < contentItems.size; i++) {
        let it = contentItems.get(i);
        if (!allowedItems[it.name] || it.hardness > u.type.mineTier) continue;
        
        let hasWall = Vars.indexer.hasWallOre(it);
        let hasFloor = oreData[it.name] && oreData[it.name].length > 0;

        if (isErekir && hasWall) {
            items.push({ it: it, amt: core.items.get(it), wall: true });
        } else if (!isErekir && hasFloor) {
            items.push({ it: it, amt: core.items.get(it), wall: false });
        }
    }

    items.sort((a, b) => a.amt - b.amt);

    for (let i = 0; i < items.length; i++) {
        let e = items[i];
        let tile = e.wall ? Vars.indexer.findClosestWallOre(u, e.it) : findClosestFreeOre(u, e.it);
        if (tile) { targetItem = e.it; targetTile = tile; return; }
    }
    targetItem = targetTile = null;
};

Events.run(Trigger.update, () => {
    if (!Vars.state.isGame()) return;
    let p = Vars.player, u = p.unit();
    if (!u || u.dead) return;

    if (lockEnabled) {
        u.mineTile = lockTile;
        if (u.dst(lockPos.x, lockPos.y) > 2) u.vel.trns(u.angleTo(lockPos.x, lockPos.y), u.type.speed);
        else u.vel.set(0, 0);
        u.lookAt(lockTile ? lockTile.worldx() : lockPos.x, lockTile ? lockTile.worldy() : lockPos.y);
        return; 
    }

    if (buildEnabled) {
        u.mineTile = null;
        if (!manualTarget && (!followTarget || !followTarget.unit() || followTarget.unit().plans.isEmpty())) {
            let closest = null, minD = Infinity;
            Groups.player.each(other => {
                if (other !== p && other.team() === p.team() && other.unit()) {
                    let oU = other.unit();
                    if (oU.isBuilding() || !oU.plans.isEmpty()) {
                        let d2 = u.dst2(other);
                        if (d2 < minD) { minD = d2; closest = other; }
                    }
                }
            });
            followTarget = closest;
        }
        if (followTarget && followTarget.unit()) {
            let l = followTarget.unit();
            u.plans.clear(); 
            l.plans.each(pl => u.plans.add(pl));
            if (u.dst2(l) > 2500) u.vel.trns(u.angleTo(l), u.type.speed); else u.vel.set(0, 0);
            u.lookAt(l); return;
        }
    }

    if (mineEnabled && u.canMine()) {
        let core = u.closestCore();
        if (!core) return;
        if (updateTimer++ >= 30) { refreshTarget(u); updateTimer = 0; }
        
        let isFull = u.stack.amount >= u.type.itemCapacity;
        if (isFull || (targetItem && u.stack.amount > 0 && u.stack.item !== targetItem)) {
            u.mineTile = null;
            if (u.dst(core) > 60) u.vel.trns(u.angleTo(core), u.type.speed);
            else { u.vel.set(0, 0); if (transferTimer++ >= 15) { Call.transferInventory(p, core); transferTimer = 0; } }
            u.lookAt(core);
        } else if (targetTile) {
            u.mineTile = targetTile;
            let tx = targetTile.worldx(), ty = targetTile.worldy();
            if (!u.within(tx, ty, u.type.mineRange * 0.8)) u.vel.trns(u.angleTo(tx, ty), u.type.speed);
            else u.vel.set(0, 0);
            u.lookAt(tx, ty);
        }
    }
});

Events.on(EventType.ClientChatEvent, e => {
    let a = String(e.message).trim().toLowerCase().split(" ");
    if (a[0] !== "/ai") return;
    
    const showHelp = () => {
        notify("\n[accent]USAGE\n[lightgrey]/ai mining <item?>\n/ai build <name? | -1>\n/ai lock\n/ai status");
    };

    switch(a[1]) {
        case "lock":
            lockEnabled = !lockEnabled;
            if (lockEnabled) {
                let u = Vars.player.unit();
                lockPos = {x: u.x, y: u.y};
                lockTile = u.mineTile;
                mineEnabled = buildEnabled = false;
            }
            notify("Lock: " + (lockEnabled ? "[green]ON" : "[scarlet]OFF"));
            break;
        case "build":
            if (a[2] === "-1") {
                manualTarget = false; followTarget = null;
                notify("Build: [green]AUTO");
            } else if (a[2]) {
                let f = null;
                Groups.player.each(pl => {
                    if (Strings.stripColors(pl.name).toLowerCase().includes(a[2])) f = pl;
                });
                if (f && f.team() == Vars.player.team()) {
                    followTarget = f; manualTarget = buildEnabled = true; mineEnabled = lockEnabled = false;
                    notify("Build Follow: " + f.name);
                } else notify("Build: [scarlet]Not found or not in your team");
            } else {
                buildEnabled = !buildEnabled;
                if (buildEnabled) mineEnabled = lockEnabled = false;
                notify("Build: " + (buildEnabled ? "[green]ON" : "[scarlet]OFF"));
            }
            break;
        case "mining":
            if (a.length > 2) {
                let changed = [];
                for (let i = 2; i < a.length; i++) {
                    if (allowedItems.hasOwnProperty(a[i])) {
                        allowedItems[a[i]] = !allowedItems[a[i]];
                        changed.push((allowedItems[a[i]] ? "[green]" : "[scarlet]") + a[i]);
                    }
                }
                targetItem = targetTile = null;
                notify("Toggle: " + changed.join("[white], "));
            } else {
                mineEnabled = !mineEnabled;
                if (mineEnabled) buildEnabled = lockEnabled = false;
                notify("Mine: " + (mineEnabled ? "[green]ON" : "[scarlet]OFF"));
            }
            break;
        case "status":
            let u = Vars.player.unit(), isErekir = u.type.name.match(/evoke|incite|emanate/), res = "", items = Vars.content.items();
            for (let i = 0; i < items.size; i++) {
                let it = items.get(i);
                if (!allowedItems.hasOwnProperty(it.name) || it.hardness > u.type.mineTier) continue;
                
                let wall = Vars.indexer.hasWallOre(it);
                let floor = oreData[it.name] && oreData[it.name].length > 0;
                
                let canMineCurrentType = isErekir ? wall : floor;
                if (!canMineCurrentType) continue; 

                let active = allowedItems[it.name];
                let color = active ? "[green]" : "[scarlet]";
                if (targetItem === it) color = "[accent]";
                
                res += color + it.name + " ";
            }
            let bTrg = followTarget ? (manualTarget ? "[accent]" : "[green]") + Strings.stripColors(followTarget.name) : "[scarlet]none";
            notify("\n[accent]STATUS\n[white]Lock: " + (lockEnabled ? "[green]ON" : "[scarlet]OFF") + 
                   "\n[white]Build: " + (buildEnabled ? "[green]ON" : "[scarlet]OFF") + " | " + bTrg +
                   "\n[white]Mine: " + (mineEnabled ? "[green]ON" : "[scarlet]OFF") + "\n[white]Items: " + res);
            break;
        default:
            showHelp();
            break;
    }
});

Events.on(WorldLoadEvent, () => {
    buildOreTree();
    mineEnabled = buildEnabled = lockEnabled = false;
    targetItem = targetTile = null;
});

if (Vars.state.isGame()) buildOreTree();
