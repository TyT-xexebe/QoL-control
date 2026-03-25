const notify = require("qol-control/core/logger").notify;
const interceptor = require("qol-control/core/interceptor");

const assistState = {
    enabled: false,
    range: 400,
    units: { poly: true, mega: true, pulsar: true, quasar: false },
    max: { poly: 3, mega: 10, pulsar: 5, quasar: 0 }
};

try {
    let u = Core.settings.getString("qol-assist-units", "");
    if(u) Object.assign(assistState.units, JSON.parse(u));
    let m = Core.settings.getString("qol-assist-max", "");
    if(m) Object.assign(assistState.max, JSON.parse(m));
    let r = Core.settings.getFloat("qol-assist-range", -1);
    if(r > 0) assistState.range = r;
} catch(e) {}

let assistTimer = null;
global.qolAssistingUnits = {};
let assistingUnits = global.qolAssistingUnits;

function releaseSingleUnit(u) {
    try { u.clearCommand(); } catch(e) {}
    try { u.resetController(); } catch(e) {}
}

function releaseAssistUnits() {
    Groups.unit.each(u => {
        if (assistingUnits[u.id]) {
            releaseSingleUnit(u);
        }
    });
    assistingUnits = {};
}

function runAssist() {
    const player = Vars.player;
    if (!player || !player.team() || !Vars.state.isGame()) {
        releaseAssistUnits();
        return;
    }

    const pUnit = player.unit();
    if (!pUnit || pUnit.dead) {
        releaseAssistUnits();
        return;
    }

    const plans = pUnit.plans;
    let isBuildingNear = false;

    if (plans.size > 0) {
        let bRange = pUnit.type.buildRange + 8; 
        for (let i = 0; i < plans.size; i++) {
            let plan = plans.get(i);
            if (pUnit.dst(plan.x * 8, plan.y * 8) <= bRange) {
                isBuildingNear = true;
                break;
            }
        }
    }

    let counts = { poly: 0, mega: 0, pulsar: 0, quasar: 0 };
    let needsCommandUpdate = new IntSeq();
    let px = new java.lang.Float(pUnit.x);
    let py = new java.lang.Float(pUnit.y);

    Groups.unit.each(u => {
        if (assistingUnits[u.id]) {
            let stolen = (u.player != null) || (u.controller() instanceof LogicAI);
            let type = u.type.name;
            
            if (u.team === player.team() && !u.dead && !stolen) {
                if (type === "nova") {
                    let cmd = null;
                    try { cmd = u.command(); } catch(e) {}
                    if (cmd !== UnitCommand.assistCommand) needsCommandUpdate.add(u.id);
                } else if (isBuildingNear && assistState.units[type]) {
                    counts[type]++;
                    let cmd = null;
                    try { cmd = u.command(); } catch(e) {}
                    if (cmd !== UnitCommand.assistCommand) needsCommandUpdate.add(u.id);
                } else {
                    delete assistingUnits[u.id];
                    releaseSingleUnit(u);
                }
            } else {
                delete assistingUnits[u.id];
                releaseSingleUnit(u);
            }
        }
    });

    Groups.unit.each(u => {
        if (!assistingUnits[u.id] && u.team === player.team() && !u.dead && u.player == null && !(u.controller() instanceof LogicAI)) {
            let type = u.type.name;
            if (type === "nova") {
                assistingUnits[u.id] = true;
                needsCommandUpdate.add(u.id);
            } else if (isBuildingNear && u.canBuild() && assistState.units[type] && counts[type] < assistState.max[type]) {
                if (u.dst(pUnit) <= assistState.range) {
                    counts[type]++;
                    assistingUnits[u.id] = true;
                    needsCommandUpdate.add(u.id);
                }
            }
        }
    });

    if (needsCommandUpdate.size > 0) {
        try {
            Call.setUnitCommand(player, needsCommandUpdate.toArray(), UnitCommand.assistCommand, px, py);
        } catch(e) {
            try {
                Call.setUnitCommand(player, needsCommandUpdate.toArray(), UnitCommand.assistCommand);
            } catch(e2) {}
        }
    }
}

const assistHandler = (args) => {
    if (args.length === 1) {
        notify("[lightgrey]!assist toggle <1/0?>\n!assist toggle <unit> <1/0?>\n!assist max <unit> <val>\n!assist range <val>\n!assist status\n!assist save\n\n!as t <1/0?>\n!as t <unit> <1/0?>\n!as m <unit> <val>\n!as r <val>\n!as s\n!as save");
        return;
    }

    if (args[1] === "save") {
        Core.settings.put("qol-assist-units", JSON.stringify(assistState.units));
        Core.settings.put("qol-assist-max", JSON.stringify(assistState.max));
        Core.settings.put("qol-assist-range", new java.lang.Float(assistState.range));
        notify("[green]Assist settings saved");
        return;
    }

    if (args[1] === "toggle" || args[1] === "t") {
        if (args.length === 2 || (args.length === 3 && (args[2] === "1" || args[2] === "0" || args[2] === "true" || args[2] === "false" || args[2] === "on" || args[2] === "off"))) {
            assistState.enabled = interceptor.parseToggle(assistState.enabled, args[2]);
            if (assistState.enabled) {
                if (!assistTimer) {
                    assistTimer = Timer.schedule(() => {
                        try { 
                            runAssist(); 
                        } catch(err) { 
                            notify("[scarlet]Assist Error: " + err);
                            if (assistTimer) assistTimer.cancel(); 
                            assistTimer = null; 
                        }
                    }, 0, 0.5);
                }
                notify("[lightgrey]Assist [green]ON");
            } else {
                if (assistTimer) assistTimer.cancel();
                assistTimer = null;
                releaseAssistUnits();
                notify("[lightgrey]Assist [scarlet]OFF");
            }
        } else {
            let type = args[2];
            if (assistState.units.hasOwnProperty(type)) {
                assistState.units[type] = interceptor.parseToggle(assistState.units[type], args[3]);
                notify("[lightgrey]Assist for " + type + " is now " + (assistState.units[type] ? "[green]ON" : "[scarlet]OFF"));
            } else {
                notify("[scarlet]Unknown unit type");
            }
        }
        return;
    }

    if (args[1] === "max" || args[1] === "m") {
        let type = args[2];
        let val = parseInt(args[3]);
        if (assistState.max.hasOwnProperty(type) && !isNaN(val) && val >= 0) {
            assistState.max[type] = val;
            notify("[lightgrey]Max " + type + " set to [accent]" + val);
        } else {
            notify("[scarlet]Invalid unit type or value\n[lightgrey]!assist max <unit> <val>");
        }
        return;
    }

    if (args[1] === "range" || args[1] === "r") {
        let val = parseFloat(args[2]);
        if (!isNaN(val) && val > 0) {
            assistState.range = val * 8;
            notify("[lightgrey]Assist range set to [accent]" + val + "[lightgrey] blocks");
        } else {
            notify("[scarlet]Invalid range\n[lightgrey]!assist range <val>");
        }
        return;
    }

    if (args[1] === "status" || args[1] === "s") {
        let uStr = "";
        for (let k in assistState.units) {
            uStr += (assistState.units[k] ? "[green]" : "[scarlet]") + k + "[lightgrey](" + assistState.max[k] + ") ";
        }
        notify("\n[lightgrey]Assist " + (assistState.enabled ? "[green]ON" : "[scarlet]OFF") +
               "\n[lightgrey]Range [accent]" + (assistState.range / 8) + " blocks" +
               "\n[lightgrey]Units " + uStr);
        return;
    }
};

interceptor.add("assist", assistHandler);
interceptor.add("as", assistHandler);
