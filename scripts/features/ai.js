let mineEnabled = false, buildEnabled = false, manualTarget = false, lockEnabled = false;
let followTarget = null, targetItem = null, targetTile = null;
let lockPos = null, lockTile = null;
let updateTimer = 0, transferTimer = 0;

let oreData = {}; 
const allowedItems = {
    "copper": true, "lead": true, "sand": true, "scrap": true,
    "coal": true, "titanium": true, "beryllium": true, "graphite": true
};

const notify = require("qol-control/core/logger").notify;

const buildOreTree = () => {
    let start = Time.millis();
    oreData = {};
    if (!Vars.world) return;
    
    for (let key in allowedItems) {
        oreData[key] = [];
    }
    
    let w = Vars.world.width(), h = Vars.world.height();
    let count = 0;
    let tiles = Vars.world.tiles;
    
    for (let x = 0; x < w; x++) {
        for (let y = 0; y < h; y++) {
            let tile = tiles.getn(x, y);
            let drop = tile.drop();
            if (drop && oreData[drop.name] !== undefined) {
                oreData[drop.name].push(tile);
                count++;
            }
        }
    }
    let elapsed = (Time.millis() - start) / 1000;
    notify("[lightgrey]Ore Tree - [accent]" + count + "[lightgrey] ores was found | [accent]" + elapsed.toFixed(4) + "[lightgrey]s");
};

const findClosestFreeOre = (u, item) => {
    let tiles = oreData[item.name];
    if (!tiles) return null;
    let closest = null, minDst = Infinity;
    let utx = u.tileX(), uty = u.tileY();
    let air = Blocks.air;
    
    for (let i = 0, len = tiles.length; i < len; i++) {
        let t = tiles[i];
        let dx = t.x - utx;
        let dy = t.y - uty;
        let d = dx * dx + dy * dy;
        
        if (d < minDst) {
            if (t.block() === air) {
                minDst = d; 
                closest = t; 
            }
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
        if (u.dst2(lockPos.x, lockPos.y) > 4) u.vel.trns(u.angleTo(lockPos.x, lockPos.y), u.type.speed);
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
            if (u.dst2(core) > 3600) u.vel.trns(u.angleTo(core), u.type.speed);
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

Events.on(ClientChatEvent, e => {
    let a = String(e.message).trim().toLowerCase().split(" ");
    if (a[0] !== "/ai") return;
    
    const showHelp = () => {
        notify("[lightgrey]/ai mining <item?>\n/ai build <name? | -1>\n/ai lock\n/ai status \n\n/ai m <item?>\n/ai b <name? | -1>\n/ai l\n/ai s");
    };

    switch(a[1]) {
        case "lock":
        case "l":
            lockEnabled = !lockEnabled;
            if (lockEnabled) {
                let u = Vars.player.unit();
                lockPos = {x: u.x, y: u.y};
                lockTile = u.mineTile;
                mineEnabled = buildEnabled = false;
            }
            notify("[lightgrey]Lock " + (lockEnabled ? "[green]ON" : "[scarlet]OFF"));
            break;
        case "build":
        case "b":
            if (a[2] === "-1") {
                manualTarget = false; followTarget = null;
                notify("[lightgrey]Build [green]AUTO");
            } else if (a[2]) {
                let f = null;
                Groups.player.each(pl => {
                    if (Strings.stripColors(pl.name).toLowerCase().includes(a[2])) f = pl;
                });
                if (f && f.team() == Vars.player.team()) {
                    followTarget = f; manualTarget = buildEnabled = true; mineEnabled = lockEnabled = false;
                    notify("[lightgrey]Build Follow " + f.name);
                } else notify("[scarlet]player [white]" + a[2] + " [scarlet]not found or not in your team");
            } else {
                buildEnabled = !buildEnabled;
                if (buildEnabled) mineEnabled = lockEnabled = false;
                notify("[lightgrey]Build " + (buildEnabled ? "[green]ON" : "[scarlet]OFF"));
            }
            break;
        case "mining":
        case "m":
            if (a.length > 2) {
                let changed = [];
                for (let i = 2; i < a.length; i++) {
                    if (allowedItems.hasOwnProperty(a[i])) {
                        allowedItems[a[i]] = !allowedItems[a[i]];
                        changed.push((allowedItems[a[i]] ? "[green]" : "[scarlet]") + a[i]);
                    }
                }
                targetItem = targetTile = null;
                notify("[lightgrey]Toggle " + changed.join(" "));
            } else {
                mineEnabled = !mineEnabled;
                if (mineEnabled) buildEnabled = lockEnabled = false;
                notify("[lightgrey]Mining " + (mineEnabled ? "[green]ON" : "[scarlet]OFF"));
            }
            break;
        case "status":
        case "s":
            let u = Vars.player.unit(), res = "", items = Vars.content.items();
            let isErekir = u == null ? false : u.type.name.match(/evoke|incite|emanate/);
            for (let i = 0; i < items.size; i++) {
                let it = items.get(i);
                let mineTier = u == null ? 0 : u.type.mineTier;           
                if (!allowedItems.hasOwnProperty(it.name) || it.hardness > mineTier) continue;             
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
            notify("[lightgrey]Lock " + (lockEnabled ? "[green]ON" : "[scarlet]OFF") + 
                   "\n[lightgrey]Build " + (buildEnabled ? "[green]ON" : "[scarlet]OFF") + " | " + bTrg +
                   "\n[lightgrey]Mining " + (mineEnabled ? "[green]ON" : "[scarlet]OFF") + "\n[lightgrey]Ores " + res);
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
