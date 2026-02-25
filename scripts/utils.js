const notify = (text) => Vars.ui.chatfrag.addMessage("[accent]󰚩 [white] " + text);

let hpEnabled = true;
let trangeEnabled = false;
let targetCache = null;
let trackedPlayer = null;
let targetTimer = 0;
let trangeUpdateTimer = 0;
let cachedTurrets = [];
let coordHistory = [];

let dpsData = {};

function drawHP(unit) {
    if (!unit || !unit.isAdded() || unit.health <= 0) return;
    
    let id = unit.id;
    let now = Date.now();
    let data = dpsData[id];
    
    if (!data) {
        data = { lastHp: unit.health + unit.shield, lastTime: now, dps: 0 };
        dpsData[id] = data;
    }
    
    if (now - data.lastTime >= 1000) {
        let currentTotal = unit.health + unit.shield;
        data.dps = Math.max(0, data.lastHp - currentTotal);
        data.lastHp = currentTotal;
        data.lastTime = now;
    }

    let hpText = Math.floor(unit.health) + "/" + Math.floor(unit.maxHealth);
    if (unit.shield > 0) hpText += " [accent](" + Math.floor(unit.shield) + ")";
    if (data.dps > 0) hpText += " [scarlet]-" + Math.floor(data.dps);

    let scale = 0.24, yOffset = unit.hitSize * 1.1 + 4;
    Draw.z(Layer.max);
    Fonts.outline.draw(hpText, unit.x, unit.y + yOffset, Color.white, scale, true, Align.center);
}

Events.on(PlayerChatEvent, e => {
    let raw = Strings.stripColors(e.message);
    let match = raw.match(/(\d+)[^\d]+(\d+)/);
    if (match) {
        let x = parseInt(match[1]), y = parseInt(match[2]);
        if (x >= 0 && x <= 1000 && y >= 0 && y <= 1000) {
            coordHistory.push({
                nick: Strings.stripColors(e.player.name),
                x: x,
                y: y
            });
            if (coordHistory.length > 9) coordHistory.shift();
        }
    }
});

Events.on(WorldLoadEvent, () => {
    coordHistory = [];
    cachedTurrets = [];
    dpsData = {};
});

Events.on(ClientChatEvent, e => {
    let msg = String(e.message);
    let args = msg.trim().toLowerCase().split(" ");
    let cmd = args[0];

    if (cmd === "/hp") {
        if (args[1]) {
            let found = null;
            Groups.player.each(p => {
                if (Strings.stripColors(p.name).toLowerCase().includes(args[1])) found = p;
            });
            if (found) {
                trackedPlayer = found;
                notify("Tracking: " + found.name);
            } else notify("Player: [scarlet]Not found");
        } else {
            hpEnabled = !hpEnabled;
            if (!hpEnabled) { targetCache = null; trackedPlayer = null; dpsData = {}; }
            notify("HP Display: " + (hpEnabled ? "[green]ON" : "[scarlet]OFF"));
        }
    }

    if (cmd === "/trange") {
        trangeEnabled = !trangeEnabled;
        if (!trangeEnabled) cachedTurrets = [];
        notify("Turret Ranges: " + (trangeEnabled ? "[green]ON" : "[scarlet]OFF"));
    }

    if (cmd === "/lookat") {
        if (args[1] === "last") {
            if (args[2]) {
                let idx = parseInt(args[2]) - 1;
                if (coordHistory[idx]) {
                    let c = coordHistory[idx];
                    Core.camera.position.set(c.x * 8, c.y * 8);
                    notify("Jump: [accent]" + c.x + ", " + c.y);
                } else notify("Index: [scarlet]Invalid");
            } else {
                if (coordHistory.length === 0) {
                    notify("History: [scarlet]Empty");
                } else {
                    let str = "\n[accent]COORDS:";
                    for (let i = 0; i < coordHistory.length; i++) {
                        let c = coordHistory[i];
                        str += "\n[white]" + (i + 1) + " - [lightgray]" + c.nick + "[white] - " + c.x + " " + c.y;
                    }
                    notify(str);
                }
            }
        } else {
            let x = parseFloat(args[1]), y = parseFloat(args[2]);
            if (!isNaN(x) && !isNaN(y)) {
                Core.camera.position.set(x * 8, y * 8);
                notify("Camera: [accent]" + x + ", " + y);
            } else notify("Usage: [lightgray]/lookat <x> <y> | last <n?>");
        }
    }

    if (cmd === "/here") {
        let x = Math.floor(Core.camera.position.x / 8);
        let y = Math.floor(Core.camera.position.y / 8);
        let comment = args.length > 1 ? " " + args.slice(1).join(" ") : "";
        Call.sendChatMessage("[accent][" + x + ", " + y + "] [white]" + comment);
    }

    if (cmd === "/cghost") {
        let teamData = Vars.player.team().data();
        if (!teamData) return;
        let toRemove = new IntSeq();
        teamData.plans.each(plan => {
            if (!Vars.world.build(plan.x, plan.y)) {
                let wx = plan.x * 8, wy = plan.y * 8;
                let danger = false;
                Vars.indexer.allBuildings(wx, wy, 800, b => {
                    if (b.team !== Vars.player.team() && b.block.range && b.dst(wx, wy) <= b.block.range) danger = true;
                });
                if (danger) toRemove.add(Point2.pack(plan.x, plan.y));
            }
        });
        if (toRemove.size > 0) {
            Call.deletePlans(Vars.player, toRemove.toArray());
            notify("Cleared: [green]" + toRemove.size + " [white]ghosts");
        } else notify("Ghosts: [green]Clear");
    }
});

Events.run(Trigger.draw, () => {
    if (!Vars.state.isGame()) return;
    let u = Vars.player.unit();

    if (trangeEnabled && u) {
        if (trangeUpdateTimer++ >= 10) {
            trangeUpdateTimer = 0;
            cachedTurrets = [];
            Vars.indexer.allBuildings(u.x, u.y, 800, b => {
                if (b.team !== u.team && b.block.range) {
                    let r = b.block.range;
                    let limit = r + 100;
                    if (u.dst2(b) <= limit * limit) {
                        let color = Color.valueOf("eab678");
                        if (b.block.targetAir && b.block.targetGround) color = Color.valueOf("cc81f5");
                        else if (b.block.targetAir) color = Color.valueOf("84f5f5");
                        cachedTurrets.push({x: b.x, y: b.y, r: r, color: color});
                    }
                }
            });
        }

        Draw.z(Layer.max);
        Lines.stroke(0.9);
        for (let i = 0, len = cachedTurrets.length; i < len; i++) {
            let t = cachedTurrets[i];
            Draw.color(t.color, 0.3);
            Lines.circle(t.x, t.y, t.r);
        }
    }

    if (!hpEnabled) return;
    if (trackedPlayer && trackedPlayer.unit()) {
        let tu = trackedPlayer.unit();
        if (u && u.isAdded() && tu.isAdded()) {
            Draw.z(Layer.max);
            Lines.stroke(1.2);
            Draw.color(Pal.accent, 0.35);
            Lines.line(u.x, u.y, tu.x, tu.y);
            Draw.reset();
        }
        drawHP(tu);
    }
    if (u && u.isShooting) {
        if (targetTimer++ >= 5) {
            targetTimer = 0;
            let found = Units.closest(null, u.aimX, u.aimY, 40, e => true);
            if (found) targetCache = found;
        }
    }
    if (targetCache) {
        if (!targetCache.isAdded() || targetCache.health <= 0) {
            delete dpsData[targetCache.id];
            targetCache = null;
        } else {
            drawHP(targetCache);
        }
    }
});

Events.on(ClientLoadEvent, () => {
    Vars.content.units().each(u => { u.rotateSpeed = 1000; u.omniMovement = true; });
});

// Fish servers ohno's unit leave
Events.on(UnitChangeEvent, e => {
    if (e.player === Vars.player && e.unit && e.unit.type === UnitTypes.alpha && e.unit instanceof Legsc) e.player.clearUnit()
});
