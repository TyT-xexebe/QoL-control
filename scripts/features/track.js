const notify = require("qol-control/core/logger").notify;
const interceptor = require("qol-control/core/interceptor");

let trackEnabled = false;
let trackedPlayer = null;

let unitCommanders = {};
let unitScanTimer = 0;

let rallyPoints = [];
let rallyScanTimer = 0;

const getPlayerObj = obj => {
    if (!obj) return null;
    if (obj instanceof Packages.mindustry.gen.Player) return obj;
    if (obj.isPlayer && obj.isPlayer()) return obj.getPlayer();
    return null;
};

Events.on(WorldLoadEvent, () => {
    unitCommanders = {};
    rallyPoints = [];
});

Events.run(Trigger.update, () => {
    if (!trackEnabled) return;
    
    unitScanTimer += Time.delta;
    if (unitScanTimer > 15) {
        unitScanTimer = 0;
        let newCommanders = {};
        
        let hasCommandAI = false;
        try { if (Packages.mindustry.ai.types.CommandAI) hasCommandAI = true; } catch(e) {}
        
        Groups.unit.each(u => {
            let p = null;
            let ctrl = u.controller();
            
            if (u.lastCommanded) {
                let cmdrName = String(u.lastCommanded);
                Groups.player.each(player => {
                    if (String(player.coloredName()) === cmdrName || String(player.name) === cmdrName) p = player;
                });
            }
            
            if (!p && ctrl instanceof Packages.mindustry.ai.types.FormationAI) {
                let leader = ctrl.leader;
                if (leader && leader.isPlayer && leader.isPlayer()) p = getPlayerObj(leader);
            }
            
            if (!p && hasCommandAI && ctrl instanceof Packages.mindustry.ai.types.CommandAI) {
                let cmdr = ctrl.commander;
                if (cmdr && cmdr.isPlayer && cmdr.isPlayer()) p = getPlayerObj(cmdr);
            }

            if (!p && u.team === Vars.player.team() && Vars.control && Vars.control.input && Vars.control.input.selectedUnits.contains(u)) {
                p = Vars.player;
            }

            if (p) {
                let tx = null, ty = null;
                try {
                    if (ctrl instanceof Packages.mindustry.ai.types.FormationAI && ctrl.leader) {
                        tx = ctrl.leader.x; ty = ctrl.leader.y;
                    } else if (ctrl.targetPos && ctrl.targetPos.x !== undefined) { 
                        tx = ctrl.targetPos.x; ty = ctrl.targetPos.y; 
                    } else if (u.targetFlag && u.targetFlag.x !== undefined) { 
                        tx = u.targetFlag.x; ty = u.targetFlag.y; 
                    } else if (ctrl.target && ctrl.target.x !== undefined) { 
                        tx = ctrl.target.x; ty = ctrl.target.y; 
                    }
                } catch(e) {}

                let isMining = false;
                try { if (u.mining && u.mining()) isMining = true; } catch(e) {}

                if (tx !== null && ty !== null && !isMining) {
                    if (tx !== 0 || ty !== 0) {
                        let dist = Math.abs(u.x - tx) + Math.abs(u.y - ty);
                        if (dist > 32) {
                            newCommanders[u.id] = { p: p, tx: tx, ty: ty };
                        }
                    }
                }
            }
        });
        
        unitCommanders = newCommanders;
    }

    rallyScanTimer += Time.delta;
    if (rallyScanTimer > 180) {
        rallyScanTimer = 0;
        let newPoints = [];
        
        Groups.build.each(b => {
            if (b.commandPos && b.commandPos.x !== undefined) {
                if (b.commandPos.x !== 0 || b.commandPos.y !== 0) {
                    newPoints.push({
                        x: b.x, y: b.y,
                        tx: b.commandPos.x, ty: b.commandPos.y,
                        color: b.team.color,
                        team: b.team
                    });
                }
            }
        });
        rallyPoints = newPoints;
    }
});

interceptor.add("track", (args) => {
    if (args[1] && args[1] !== "toggle" && args[1] !== "1" && args[1] !== "0" && args[1] !== "true" && args[1] !== "false" && args[1] !== "on" && args[1] !== "off") {
        let found = null;
        let search = args[1].toLowerCase();
        Groups.player.each(p => {
            if (Strings.stripColors(p.name).toLowerCase().includes(search)) found = p;
        });
        if (found) {
            trackedPlayer = found;
            notify("Tracking " + found.name);
        } else {
            notify("[scarlet]Player [white]" + args[1] + " [scarlet]not found");
        }
    } else {
        trackEnabled = interceptor.parseToggle(trackEnabled, args[1] === "toggle" ? args[2] : args[1]);
        if (!trackEnabled) {
            trackedPlayer = null;
            unitCommanders = {};
            rallyPoints = [];
        }
        notify("[lightgray]Tracking Display " + (trackEnabled ? "[green]ON" : "[scarlet]OFF"));
    }
});

Events.run(Trigger.draw, () => {
    if (!Vars.state.isGame() || !trackEnabled) return;

    let playerClusters = {};
    let chunkSize = 160; 

    Groups.unit.each(u => {
        let data = unitCommanders[u.id];
        if (data) {
            let p = data.p;
            if (p && (!trackedPlayer || p === trackedPlayer)) {
                let pu = p.unit();
                if (pu && u !== pu) {
                    if (!playerClusters[p.id]) playerClusters[p.id] = {};
                    
                    let cx = Math.floor(u.x / chunkSize);
                    let cy = Math.floor(u.y / chunkSize);
                    let key = cx + "," + cy;
                    
                    if (!playerClusters[p.id][key]) {
                        playerClusters[p.id][key] = { x: 0, y: 0, count: 0, tx: 0, ty: 0 };
                    }
                    playerClusters[p.id][key].x += u.x;
                    playerClusters[p.id][key].y += u.y;
                    playerClusters[p.id][key].count++;
                    playerClusters[p.id][key].tx += data.tx;
                    playerClusters[p.id][key].ty += data.ty;
                }
            }
        }
    });

    Groups.player.each(p => {
        if (trackedPlayer && p !== trackedPlayer) return;

        let c = p.color;
        Draw.z(Layer.max);
        
        if (p !== Vars.player) {
            Lines.stroke(1.5);
            Draw.color(c, 0.6);
            Lines.square(p.mouseX, p.mouseY, 4, 45);

            let u = p.unit();
            if (u && u.isAdded()) {
                Lines.stroke(1.2);
                Draw.color(c, 0.45);
                Lines.line(u.x, u.y, p.mouseX, p.mouseY);
            }
        }

        let u = p.unit();
        if (u && u.isAdded()) {
            let clusters = playerClusters[p.id];
            if (clusters) {
                for (let k in clusters) {
                    let cl = clusters[k];
                    let avgX = cl.x / cl.count;
                    let avgY = cl.y / cl.count;
                    let avgTx = cl.tx / cl.count;
                    let avgTy = cl.ty / cl.count;
    
                    Draw.color(c, 0.35);
                    Lines.stroke(1.2);
                    Lines.line(u.x, u.y, avgX, avgY);
                    
                    Draw.color(c, 0.6);
                    Lines.stroke(1.0);
                    
                    let dist = Math.abs(avgX - avgTx) + Math.abs(avgY - avgTy);
                    let segments = Math.floor(Math.max(2, dist / 8));
                    Lines.dashLine(avgX, avgY, avgTx, avgTy, segments);
                    
                    Lines.stroke(1.5);
                    Lines.line(avgTx - 3, avgTy - 3, avgTx + 3, avgTy + 3);
                    Lines.line(avgTx - 3, avgTy + 3, avgTx + 3, avgTy - 3);
                }
            }
        }
        
        Draw.reset();
    });

    if (rallyPoints.length > 0) {
        Draw.z(Layer.max);
        rallyPoints.forEach(p => {
            if (trackedPlayer && p.team !== trackedPlayer.team()) return;

            Draw.color(p.color, 0.4);
            Lines.stroke(1.5);
            
            let dist = Math.abs(p.x - p.tx) + Math.abs(p.y - p.ty);
            let segments = Math.floor(Math.max(2, dist / 8));
            Lines.dashLine(p.x, p.y, p.tx, p.ty, segments);
            
            Lines.square(p.tx, p.ty, 4, 45);
        });
        Draw.reset();
    }
});
