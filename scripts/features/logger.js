const { notify } = require("qol-control/core/logger");
const interceptor = require("qol-control/core/interceptor");

let enabled = false, logs = {}, buffers = {}, shadowMap = {}, pids = {}, reqTraces = {}, failTraces = {}, traceAdded = false, lastUpdate = 0, drawName = null;
let cachedDraws = [], lastDrawCount = 0, lastDrawName = null;

const setShadow = (t, b, c, r) => {
    if (!t) return;
    let s = b.size, off = Math.floor((s - 1) / 2), rot = r !== undefined ? r : (t.build ? t.build.rotation : 0);
    let obj = { b: b, c: c, r: rot, cx: t.x, cy: t.y };
    for (let dx = 0; dx < s; dx++) for (let dy = 0; dy < s; dy++) shadowMap[(t.x - off + dx) + "," + (t.y - off + dy)] = obj;
};

const initShadowMap = () => {
    shadowMap = {};
    if (!Vars.world || !Vars.world.tiles) return;
    for (let x = 0; x < Vars.world.width(); x++) {
        for (let y = 0; y < Vars.world.height(); y++) {
            let t = Vars.world.tile(x, y);
            if (t && t.build && t.isCenter()) setShadow(t, t.block(), getConfig(t.build), t.build.rotation);
        }
    }
};

const fTime = ms => {
    let d = new Date(ms), h = d.getHours(), m = d.getMinutes(), s = d.getSeconds();
    return (h < 10 ? "0" + h : h) + ":" + (m < 10 ? "0" + m : m) + ":" + (s < 10 ? "0" + s : s);
};

const fConf = (v, b) => {
    if (v == null) return "no config";
    if (b && (b.name.indexOf("node") !== -1 || b.name.indexOf("power") !== -1)) return "connections";
    if (v instanceof Item || v instanceof Liquid || v instanceof Block) return v.emoji();
    if (v instanceof java.lang.Integer) return String(v);
    if (v instanceof java.lang.String) return '"' + v + '"';
    if (v.getClass && v.getClass().isArray()) return b && (b.name.indexOf("processor") !== -1 || b.name.indexOf("logic") !== -1) ? "code changed" : "array changed";
    return "changed";
};

const getConfig = b => {
    if (!b) return null;
    try {
        let c = b.config;
        return typeof c === "function" ? b.config() : c;
    } catch (e) {
        return null;
    }
};

const getP = u => {
    if (!u || !u.isPlayer()) return null;
    let p = u.getPlayer();
    if (!pids[p.id] && !failTraces[p.id]) {
        pids[p.id] = "?";
        try { reqTraces[p.id] = Date.now(); Call.adminRequest(p, Packages.mindustry.net.Packets.AdminAction.trace, null); } 
        catch(e) { failTraces[p.id] = true; }
    }
    return { n: p.name, t: p.team().name, id: p.id };
};

const flush = (id, k) => {
    if (!buffers[id] || !buffers[id][k]) return;
    (logs[id] = logs[id] || []).push(buffers[id][k]);
    delete buffers[id][k];
};

const flushAll = () => { for (let id in buffers) for (let k in buffers[id]) flush(id, k); };

const addLog = (id, n, t, act, b, cStr, cObj, r, x, y) => {
    let bName = b ? b.name : "air", key = act + "_" + bName + "_" + cStr + "_" + r, now = Date.now(), buf = buffers[id] = buffers[id] || {};
    if (buf[key] && now - buf[key].time < 30000) {
        buf[key].count++; buf[key].coords.push({x: x, y: y}); buf[key].time = now;
    } else {
        if (buf[key]) flush(id, key);
        buf[key] = { n: n, t: t, act: act, b: b, cStr: cStr, cObj: cObj, r: r, coords: [{x: x, y: y}], count: 1, time: now, start: now };
    }
};

const wLog = f => {
    let out = "";
    let arr = [">", "^", "<", "v"];
    for (let id in logs) {
        let lgs = logs[id];
        if (!lgs.length) continue;
        out += Strings.stripColors(lgs[0].n) + (pids[id] && pids[id] !== "?" ? " #" + pids[id] : "") + " (" + lgs[0].t + ")\n";
        lgs.forEach(l => {
            let cStr = l.coords[0].x + "," + l.coords[0].y + (l.count > 1 ? " ... " + l.coords[l.coords.length-1].x + "," + l.coords[l.coords.length-1].y : "");
            let rot = Number(l.r) % 4;
            let rStr = (l.b && l.b.rotate !== false && (l.act === "build" || l.act === "destroy" || l.act === "changed")) ? " | " + (arr[rot] !== undefined ? arr[rot] : l.r) : "";
            if (l.act === "rotated") rStr = " | " + l.cStr;
            let displayConf = l.act === "rotated" ? "" : " | " + l.cStr;
            out += fTime(l.start) + " | " + l.act + " | " + (l.b ? l.b.name : "unknown") + rStr + displayConf + " | " + cStr + " | x" + l.count + "\n";
        });
        out += "\n";
    }
    f.writeString(out);
};

const updLog = () => {
    flushAll();
    let hasLogs = false;
    for (let id in logs) { if (logs[id].length) { hasLogs = true; break; } }
    if (!hasLogs) return;
    let d = Core.settings.getDataDirectory().child("qol");
    if (!d.exists()) d.mkdirs();
    wLog(d.child("main_log.txt"));
};

const showLogs = fName => {
    flushAll();
    let d = new BaseDialog("Logs");
    d.addCloseButton();
    let t = new Table();
    let arr = [">", "^", "<", "v"];
    for (let id in logs) {
        let lgs = logs[id];
        if (!lgs.length || (fName && Strings.stripColors(lgs[0].n).toLowerCase().indexOf(fName.toLowerCase()) === -1)) continue;
        t.add("[accent]" + lgs[0].n + (pids[id] && pids[id] !== "?" ? " [accent]#" + pids[id] : "") + " [lightgrey](" + lgs[0].t + ")").left().row();
        lgs.forEach(l => {
            let col = l.act === "build" ? "[green]" : (l.act === "destroy" ? "[red]" : "[accent]");
            let cStr = l.coords[0].x + "," + l.coords[0].y + (l.count > 1 ? " ... " + l.coords[l.coords.length-1].x + "," + l.coords[l.coords.length-1].y : "");
            let rot = Number(l.r) % 4;
            let rStr = (l.b && l.b.rotate !== false && (l.act === "build" || l.act === "destroy" || l.act === "changed")) ? " | [lightgrey]" + (arr[rot] !== undefined ? arr[rot] : l.r) : "";
            if (l.act === "rotated") rStr = " | [lightgrey]" + l.cStr;
            let displayConf = l.act === "rotated" ? "" : " | [lightgrey]" + l.cStr;
            t.add("[lightgrey]" + fTime(l.start) + " | " + col + l.act + "[] | " + (l.b ? l.b.emoji() : "") + rStr + displayConf + " | [white]" + cStr + " | [accent]x" + l.count).left().row();
        });
        t.add("").padBottom(10).row();
    }
    d.cont.add(new ScrollPane(t)).width(Core.graphics.getWidth() * 0.8).height(Core.graphics.getHeight() * 0.8);
    d.show();
};

const rmShadow = s => {
    if (!s || !s.b) return;
    let sz = s.b.size, off = Math.floor((sz - 1) / 2);
    for (let dx = 0; dx < sz; dx++) for (let dy = 0; dy < sz; dy++) delete shadowMap[(s.cx - off + dx) + "," + (s.cy - off + dy)];
};

Events.on(BlockBuildEndEvent, e => {
    if (!enabled) return;
    let p = getP(e.unit);
    if (!p) return;
    let act = e.breaking ? "destroy" : "build", k = e.tile.x + "," + e.tile.y;
    if (e.breaking) {
        let s = shadowMap[k], b = s ? s.b : Blocks.air, cStr = s ? fConf(s.c, b) : "no config";
        if (!b || b.name === "air" || b instanceof Packages.mindustry.world.blocks.environment.Floor || b instanceof Packages.mindustry.world.blocks.environment.OverlayFloor) return;
        addLog(p.id, p.n, p.t, act, b, cStr, s ? s.c : null, s ? s.r : 0, s ? s.cx : e.tile.x, s ? s.cy : e.tile.y);
        rmShadow(s);
    } else {
        let b = e.tile.block(), ct = e.tile.build ? e.tile.build.tile : e.tile, c = e.tile.build ? getConfig(e.tile.build) : null;
        if (!b || b.name === "air" || b instanceof Packages.mindustry.world.blocks.environment.Floor || b instanceof Packages.mindustry.world.blocks.environment.OverlayFloor) return;
        let r = e.tile.build ? e.tile.build.rotation : 0;
        let cStr = c != null ? fConf(c, b) : "no config";
        setShadow(ct, b, c, r);
        addLog(p.id, p.n, p.t, act, b, cStr, c, r, ct.x, ct.y);
    }
});

Events.on(ConfigEvent, e => {
    if (!enabled || !e.player) return;
    let p = { n: e.player.name, t: e.player.team().name, id: e.player.id };
    if (!pids[p.id] && !failTraces[p.id]) {
        pids[p.id] = "?";
        try { reqTraces[p.id] = Date.now(); Call.adminRequest(e.player, Packages.mindustry.net.Packets.AdminAction.trace, null); } 
        catch(err) { failTraces[p.id] = true; }
    }
    let b = e.tile.block, k = e.tile.tile.x + "," + e.tile.tile.y, s = shadowMap[k];
    let oStr = s ? fConf(s.c, b) : "unknown", nStr = fConf(e.value, b);
    let r = s ? s.r : e.tile.rotation;
    if (s) s.c = e.value; else setShadow(e.tile.tile, b, e.value, r);
    addLog(p.id, p.n, p.t, "changed", b, oStr === nStr ? nStr : oStr + " -> " + nStr, e.value, r, e.tile.tile.x, e.tile.tile.y);
});

Events.on(BuildRotateEvent, e => {
    if (!enabled) return;
    let p = getP(e.unit);
    if (!p) return;
    let arr = [">", "^", "<", "v"], n = e.build.rotation;
    let s = shadowMap[e.build.tileX() + "," + e.build.tileY()];
    let o = s ? s.r : (e.previous !== undefined ? e.previous : "?");
    if (s) s.r = n;
    let oRot = Number(o) % 4, nRot = Number(n) % 4;
    addLog(p.id, p.n, p.t, "rotated", e.build.block, (arr[oRot] !== undefined ? arr[oRot] : o) + " -> " + (arr[nRot] !== undefined ? arr[nRot] : n), null, n, e.build.tileX(), e.build.tileY());
});

Events.on(PickupEvent, e => {
    if (!enabled || !e.build) return;
    let p = getP(e.carrier);
    if (!p) return;
    let s = shadowMap[e.build.tileX() + "," + e.build.tileY()];
    addLog(p.id, p.n, p.t, "pickup", e.build.block, "no config", null, e.build.rotation, e.build.tileX(), e.build.tileY());
    if (s) rmShadow(s);
});

Events.on(PayloadDropEvent, e => {
    if (!enabled || !e.build) return;
    let p = getP(e.carrier);
    if (!p) return;
    let b = e.build.block, c = getConfig(e.build), cStr = c != null ? fConf(c, b) : "no config";
    setShadow(e.build.tile, b, c, e.build.rotation);
    addLog(p.id, p.n, p.t, "drop", b, cStr, c, e.build.rotation, e.build.tileX(), e.build.tileY());
});

Events.on(WorldLoadEvent, () => {
    logs = {}; buffers = {}; pids = {}; reqTraces = {}; failTraces = {}; drawName = null;
    cachedDraws = []; lastDrawCount = 0; lastDrawName = null;
    initShadowMap();
    let f = Core.settings.getDataDirectory().child("qol").child("main_log.txt");
    if (f.exists()) f.writeString("");
});

if (Vars.world && Vars.world.tiles) initShadowMap();

const updateCachedDraws = () => {
    if (drawName === null) return;
    let allLogs = [];
    let currentCount = 0;
    for (let id in logs) {
        let lgs = logs[id];
        currentCount += lgs.length;
        if (!lgs.length || (drawName !== "" && Strings.stripColors(lgs[0].n).toLowerCase().indexOf(drawName.toLowerCase()) === -1)) continue;
        lgs.forEach(l => allLogs.push(l));
    }
    if (currentCount === lastDrawCount && drawName === lastDrawName) return;
    lastDrawCount = currentCount;
    lastDrawName = drawName;
    
    allLogs.sort((a, b) => a.start - b.start);
    let grid = {};
    allLogs.forEach(l => {
        if (!l.b || l.b.name === "air") return;
        l.coords.forEach(c => {
            let s = l.b.size, off = Math.floor((s - 1) / 2);
            let drawObj = { act: l.act, b: l.b, r: l.r, x: c.x, y: c.y, id: Math.random() };
            for (let dx = 0; dx < s; dx++) {
                for (let dy = 0; dy < s; dy++) {
                    let k = (c.x - off + dx) + "," + (c.y - off + dy);
                    let existing = grid[k];
                    if (existing) {
                        let es = existing.b.size, eoff = Math.floor((es - 1) / 2);
                        for (let edx = 0; edx < es; edx++) {
                            for (let edy = 0; edy < es; edy++) {
                                delete grid[(existing.x - eoff + edx) + "," + (existing.y - eoff + edy)];
                            }
                        }
                    }
                }
            }
            for (let dx = 0; dx < s; dx++) {
                for (let dy = 0; dy < s; dy++) {
                    grid[(c.x - off + dx) + "," + (c.y - off + dy)] = drawObj;
                }
            }
        });
    });
    cachedDraws = [];
    for (let k in grid) {
        let obj = grid[k];
        if (cachedDraws.indexOf(obj) === -1) cachedDraws.push(obj);
    }
};

Events.run(Trigger.update, () => {
    if (enabled && Date.now() - lastUpdate > 5000) { lastUpdate = Date.now(); updLog(); }
});

Events.run(Trigger.draw, () => {
    if (!enabled || drawName === null) return;
    updateCachedDraws();
    let bnd = Core.camera.bounds(Tmp.r1);
    cachedDraws.forEach(d => {
        let col = d.act === "build" ? Color.green : (d.act === "destroy" ? Color.red : Pal.accent);
        let offset = d.b.size % 2 === 0 ? Vars.tilesize / 2 : 0;
        let wx = d.x * Vars.tilesize + offset, wy = d.y * Vars.tilesize + offset, off = (d.b.size * Vars.tilesize) / 2;
        if (wx + off < bnd.x || wy + off < bnd.y || wx - off > bnd.x + bnd.width || wy - off > bnd.y + bnd.height) return;
        Draw.color(col, 0.5); Draw.rect(d.b.uiIcon, wx, wy, d.b.size * Vars.tilesize, d.b.size * Vars.tilesize, d.r * 90); Draw.color();
    });
});

const setupTrace = () => {
    if (traceAdded || !Vars.ui || !Vars.ui.traces) return;
    Vars.ui.traces.shown(() => {
        if (!enabled) return;
        try {
            let txts = [];
            const ext = el => {
                if (!el) return;
                if (typeof el.getText === "function") { let t = el.getText(); if (t) txts.push(t.toString()); }
                if (typeof el.getChildren === "function") { let a = el.getChildren(); for(let i=0; i<a.size; i++) ext(a.get(i)); }
            };
            ext(Vars.ui.traces.cont);
            let pid = "?", n = "?", idP = Strings.stripColors(Core.bundle.get("trace.id").split("{0}")[0]).trim(), nP = Strings.stripColors(Core.bundle.get("trace.playername").split("{0}")[0]).trim();
            txts.forEach(t => {
                let s = Strings.stripColors(t).trim();
                if (s.indexOf(idP) === 0) pid = s.substring(idP.length).trim();
                else if (s.indexOf(nP) === 0) n = s.substring(nP.length).trim();
            });
            let fp = null;
            if (n !== "?") Groups.player.each(p => { if (Strings.stripColors(p.name).trim() === n) fp = p; });
            if (!fp) {
                let rec = Object.keys(reqTraces).filter(id => Date.now() - reqTraces[id] < 3000);
                if (rec.length === 1) fp = Groups.player.getByID(parseInt(rec[0]));
            }
            if (fp) {
                if (pid !== "?") { pids[fp.id] = pid; delete failTraces[fp.id]; } else failTraces[fp.id] = true;
                if (reqTraces[fp.id]) { delete reqTraces[fp.id]; Core.app.post(() => Vars.ui.traces.hide()); }
            }
        } catch (e) {}
    });
    traceAdded = true;
};

Events.on(ClientLoadEvent, setupTrace);
if (Vars.ui && Vars.ui.traces) setupTrace();

Events.on(PlayerJoin, e => {
    if (enabled && e.player) {
        try { if (!failTraces[e.player.id]) { reqTraces[e.player.id] = Date.now(); Call.adminRequest(e.player, Packages.mindustry.net.Packets.AdminAction.trace, null); } } 
        catch(err) { failTraces[e.player.id] = true; }
    }
});

interceptor.add("log", args => {
    let sub = args[1], f = sub || "";
    if (sub === "toggle" || sub === "t") {
        enabled = interceptor.parseToggle(enabled, args[2]);
        if (enabled) {
            failTraces = {};
            Groups.player.each(p => {
                if (p !== Vars.player) {
                    try { reqTraces[p.id] = Date.now(); Call.adminRequest(p, Packages.mindustry.net.Packets.AdminAction.trace, null); } 
                    catch(err) { failTraces[p.id] = true; }
                }
            });
        } else drawName = null;
        notify("[lightgrey]Logger " + (enabled ? "[green]ON" : "[scarlet]OFF"));
    } else if (sub === "status") {
        let tot = 0, pls = [];
        for (let id in logs) if (logs[id].length) { tot += logs[id].length; pls.push(logs[id][0].n); }
        notify("[accent]Logger Status\n[lightgrey]Enabled: " + (enabled ? "[green]Yes" : "[scarlet]No") + "\n[lightgrey]Logs: [accent]" + tot + "\n[lightgrey]Players: [white]" + (pls.length ? pls.join("[lightgrey], [white]") : "None"));
    } else if (sub === "show") {
        let target = args[2] || "";
        if (drawName !== null && (target === "" || drawName === target)) {
            drawName = null;
            notify("[lightgrey]Map drawing [scarlet]OFF");
        } else {
            drawName = target;
            notify("[lightgrey]Drawing logs for " + (target ? "[accent]" + target : "[accent]all"));
        }
    } else if (sub === "revert") {
        let tName = args[2];
        if (!tName) return notify("[scarlet]Specify player: !log revert <name>");
        let u = Vars.player.unit(), cnt = 0;
        if (!u || !u.canBuild()) return notify("[scarlet]Cannot build right now.");
        for (let id in logs) {
            let lgs = logs[id];
            if (!lgs.length || Strings.stripColors(lgs[0].n).toLowerCase().indexOf(tName.toLowerCase()) === -1) continue;
            lgs.forEach(l => {
                if (l.act === "destroy" && l.b && l.b.name !== "air" && !l.reverted) {
                    l.coords.forEach(c => { u.addBuild(new Packages.mindustry.entities.units.BuildPlan(c.x, c.y, l.r, l.b, l.cObj)); cnt++; });
                    l.reverted = true;
                }
            });
        }
        notify("[green]Reverted [accent]" + cnt + " [green]blocks.");
    } else if (sub === "save") {
        flushAll();
        let hasLogs = false;
        for (let id in logs) { if (logs[id].length) { hasLogs = true; break; } }
        if (!hasLogs) return notify("[scarlet]No logs to save.");
        let d = Core.settings.getDataDirectory().child("qol");
        if (!d.exists()) d.mkdirs();
        let dt = new Date(), fn = "log_" + dt.getFullYear() + "-" + (dt.getMonth()+1) + "-" + dt.getDate() + "_" + dt.getHours() + "-" + dt.getMinutes() + "-" + dt.getSeconds() + ".txt", f = d.child(fn);
        wLog(f); notify("[lightgrey]Saved to " + f.absolutePath());
    } else if (sub === "help") {
        notify("[lightgrey]!log toggle <1/0?>\n!log status\n!log <name?>\n!log show <name?>\n!log revert <name>\n!log save");
    } else {
        showLogs(f !== "" ? f : null);
    }
});

Events.on(WorldLoadEvent, e => {
    enabled = false;
});
