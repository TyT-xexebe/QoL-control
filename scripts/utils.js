 const notify = (text) => Vars.ui.chatfrag.addMessage(text);

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
	if (!e.player) return; 
	
    let raw = String(e.message);
let match = raw.match(/(\d\d?\d?\d?)([ ,./|][ ,./|]?[ ,./|]?)(\d\d?\d?\d?)/);

    if (match) {
        let x = parseInt(match[1]), y = parseInt(match[3]);
        if (x >= 0 && x <= 9999 && y >= 0 && y <= 9999) {
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
                notify("Tracking " + found.name);
            } else notify("[scarlet]Player [white]" + args[1] +" [scarlet]not found");
        } else {
            hpEnabled = !hpEnabled;
            if (!hpEnabled) { targetCache = null; trackedPlayer = null; dpsData = {}; }
            notify("[lightgrey]HP Display " + (hpEnabled ? "[green]ON" : "[scarlet]OFF"));
        }
    }

    if (cmd === "/trange") {
        trangeEnabled = !trangeEnabled;
        if (!trangeEnabled) cachedTurrets = [];
        notify("[lightgrey]Turret Ranges " + (trangeEnabled ? "[green]ON" : "[scarlet]OFF"));
    }

    if (cmd === "/lookat") {
        if (args[1] === "last") {
            if (args[2]) {
                let idx = parseInt(args[2]) - 1;
                if (coordHistory[idx]) {
                    let c = coordHistory[idx];
                    Core.camera.position.set(c.x * 8, c.y * 8);
                    notify("[lightgrey]Jump [accent]" + c.x + ", " + c.y);
                } else notify("[scarlet]Invalid index");
            } else {
                if (coordHistory.length === 0) {
                    notify("[scarlet]History empty");
                } else {
                	let str = "";
                    for (let i = 0; i < coordHistory.length; i++) {
                        let c = coordHistory[i];
                        str += "\n[lightgrey]" + (i + 1) + " - " + c.nick + "[lightgrey] - [accent]" + c.x + " " + c.y;
                    }
                    notify(str);
                }
            }
        } else {
            let x = parseFloat(args[1]), y = parseFloat(args[2]);
            if (!isNaN(x) && !isNaN(y)) {
                Core.camera.position.set(x * 8, y * 8);
                notify("[lightgrey]Jump [accent]" + x + ", " + y);
            } else notify("[lightgray]/lookat <x> <y>\n/lookat last <n?>");
        }
    }

    if (cmd === "/here") {
        let x = Math.floor(Core.camera.position.x / 8);
        let y = Math.floor(Core.camera.position.y / 8);
        let comment = args.length > 1 ? " " + args.slice(1).join(" ") : "";
        Call.sendChatMessage("[accent][" + x + " " + y + "] [white]" + comment);
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
            notify("[lightgrey]Cleared [accent]" + toRemove.size + " [lightgrey]ghosts");
        } else notify("[lightgrey]Ghosts clear");
    }

if (cmd === "/qol") {
		switch (args[1]) {
		case "trace":
		   notify("[lightgrey]Finds a unit [in your team and not controlled by player/processor] and tries to possess it\n\n[accent]/trace\ntoggle[lightgrey] - on/off\n[accent]set <unitType>[lightgrey] - set specific unit type to search and possess\n[accent]find[lightgrey] - possess the highest-priority unit found [preset list in status]\n[accent]status[lightgrey] - show trace status");
		   break;

		case "ai":
		   notify("[lightgrey]AI control for your unit\n\n[accent]/ai\nmining <items?>[lightgrey] - mine lowest core resources available on map [vanilla mineable only]\nwrite items separated by space to toggle them [status shows: green[ON] red[OFF] grey[NOT FOUND]]\n[accent]build <name?>[lightgrey] - assist building/deconstructing; write part of nickname to help specific player [-1 to reset]\n[accent]lock[lightgrey] - lock position and mining target\n[accent]status[lightgrey] - show AI status");
		   break;

		case "mining":
		   notify("[lightgrey]Mining control for mono/poly/pulsar/quasar/mega\n\n[accent]/mining\n<units/items>[lightgrey] - toggle units/items [ON/OFF], multiple allowed\n[accent]set <sec>[lightgrey] - enable mining algorithm (repeats every <sec> sec)\n[accent]stop[lightgrey] - stop mining algorithm");
		   break;

		case "assist":
		   notify("[lightgrey]Builder mode (units will only build your blueprints)\n\n[accent]/assist\ntoggle[lightgrey] - on/off\n[accent]toggle <unit>[lightgrey] - toggle specific unit\n[accent]max <unit> <val>[lightgrey] - set max units to use\n[accent]range <val>[lightgrey] - set search radius (in blocks)\n[accent]status[lightgrey] - show settings");
		   break;

		case "here":
		   notify("[accent]/here <text?>[lightgrey] - send camera coordinates to global chat (optional text allowed)");
		   break;

		case "lookat":
		   notify("[accent]/lookat <x> <y>[lightgrey] - move camera to coordinates\n[accent]/lookat last <n?>[lightgrey] - use one of last 9 found coordinates from chat history");
		   break;

		case "cghost":
		   notify("[accent]/cghost[lightgrey] - clear ghost blocks in enemy turret range");
		   break;

		case "hp":
		   notify("[accent]/hp <name?>[lightgrey] - toggle HP/shield/DPS display of last shot unit; nickname sets priority target");
		   break;

		case "grab":
		   notify("[lightgrey]Auto-grab <item> from blocks in unit range\n\n[accent]/grab\ntoggle[lightgrey] - on/off\n[accent]<item>[lightgrey] - set item to grab [auto-enables]\n[accent]min <val>[lightgrey] - minimum amount to grab\n[accent]status[lightgrey] - grab status");
		   break;

		case "trange":
		   notify("[accent]/trange[lightgrey] - toggle nearby enemy turret range display blue[AIR] brown[GROUND] purple[BOTH] (uses FPS)");
		   break;

		case "features":
		   notify("[lightgrey]Fast rotation & omni-movement for all units\nCamera lock button\nHeavy optimisation\nAuto-leaves onho's units [FISH Servers]");
		   break;

		case "mlog":
		   notify("[lightgrey]Mlog inserter\n\n[accent]/mlog <filename>[lightgrey] - insert /mlog/<filename>.txt into any empty processor\n[accent]/mlog <filename> set[lightgrey] - select processor manually by shooting it\n[accent]/mlog list[lightgrey] - see aviable mlog codes");
		   break;

		case "attem":
		   notify("[accent]/attem[lightgrey] - remove all attem-like processors [regex & config: /mlog/attem.json]");
		   break;

		default:
		   notify("[accent]/qol <cmd>[lightgrey] - command info\n\n[accent]Available commands[lightgrey]\ngrab[accent] | [lightgrey]ai[accent] | [lightgrey]trace[accent] | [lightgrey]mining[accent] | [lightgrey]assist[accent] | [lightgrey]hp[accent] | [lightgrey]lookat[accent] | [lightgrey]here[accent] | [lightgrey]cghost[accent] | [lightgrey]trange[accent] | [lightgrey]mlog[accent] | [lightgrey]attem\n\n[accent]features");
		   break;
		}
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
