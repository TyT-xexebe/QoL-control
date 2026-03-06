const notify = require("qol-control/core/logger").notify;

let hpEnabled = true;
let targetCache = null;
let trackedPlayer = null;
let targetTimer = 0;
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

Events.on(WorldLoadEvent, () => {
    dpsData = {};
});

const interceptor = require("qol-control/core/interceptor");

interceptor.add("hp", (args) => {
    if (args[1]) {
        let found = null;
        Groups.player.each(p => {
            if (Strings.stripColors(p.name).toLowerCase().includes(args[1])) found = p;
        });
        if (found) {
            trackedPlayer = found;
            notify("Tracking " + found.name);
        } else notify("[scarlet]Player [white]" + args[1] +" [scarlet]not found");
    } else {
        hpEnabled = !hpEnabled;
        if (!hpEnabled) { targetCache = null; trackedPlayer = null; dpsData = {}; }
        notify("[lightgrey]HP Display " + (hpEnabled ? "[green]ON" : "[scarlet]OFF"));
    }
});

Events.run(Trigger.draw, () => {
    if (!Vars.state.isGame()) return;
    let u = Vars.player.unit();

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
