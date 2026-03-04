const notify = require("qol-control/core/logger").notify;

const grab = {
    active: false,
    item: null,
    min: 10,
    targets: [],
    index: 0,
    lastGrab: 0,
    lastSearch: 0,
    range: 216
};

function findTargets() {
    grab.targets = [];
    let u = Vars.player.unit();
    if (!u) return;
    Vars.indexer.allBuildings(u.x, u.y, grab.range, b => {
        if (b.team === Vars.player.team() && b.items) grab.targets.push(b);
    });
}

Events.on(EventType.WorldLoadEvent, () => {
    grab.active = false;
    grab.item = null;
    grab.targets = [];
});

Events.run(Trigger.draw, () => {
    if (!grab.active || !grab.item || grab.targets.length === 0) return;
    
    Draw.color(Pal.accent);
    Draw.alpha(Math.abs(Math.sin(Time.time / 15)));
    
    for (let b of grab.targets) {
        if (b.isValid() && b.items.get(grab.item) >= grab.min) {
            Drawf.select(b.x, b.y, b.block.size * 4, Pal.accent);
        }
    }
    Draw.reset();
});

Events.run(Trigger.update, () => {
    let u = Vars.player.unit();
    if (!u || !grab.active || !grab.item) return;

    let now = Time.millis();

    if (now > grab.lastSearch) {
        findTargets();
        grab.lastSearch = now + 1000;
    }

    if (grab.targets.length === 0 || now - grab.lastGrab < 250) return;

    let space = u.type.itemCapacity - u.stack.amount;
    if (u.stack.amount > 0 && u.stack.item !== grab.item) space = 0;

    if (space > 0) {
        let checked = 0;
        let r2 = grab.range * grab.range;

        while (checked < grab.targets.length) {
            grab.index = (grab.index + 1) % grab.targets.length;
            let b = grab.targets[grab.index];

            if (b && b.isValid() && b.team === Vars.player.team()) {
                if (u.dst2(b) <= r2) {
                    let has = b.items.get(grab.item);
                    if (has >= grab.min) {
                        Call.requestItem(Vars.player, b, grab.item, Math.min(has, space));
                        grab.lastGrab = now;
                        return;
                    }
                }
            } else if (b) {
                grab.targets.splice(grab.index, 1);
                continue;
            }
            checked++;
        }
    }
});

Events.on(EventType.ClientChatEvent, e => {
    let args = String(e.message).trim().toLowerCase().split(" ");
    if (args[0] !== "/grab") return;

    if (args[1] === "toggle") {
        grab.active = !grab.active;
        return notify("[lightgrey]Grab " + (grab.active ? "[green]ON" : "[scarlet]OFF"));
    }

    if (args[1] === "min" && args[2]) {
        let val = parseInt(args[2]);
        if (isNaN(val) || val < 1) return notify("[scarlet]<min> invalid");
        grab.min = val;
        return notify("[lightgrey]Grab <min> [accent]" + val);
    }

    if (args[1] === "status") {
        return notify("[lightgrey]State " + (grab.active ? "[green]ON" : "[scarlet]OFF") +
                      "\n[lightgrey]Item [accent]" + (grab.item ? grab.item.name : "none") +
                      "\n[lightgrey]Min [accent]" + grab.min);
    }

    if (args[1]) {
        let found = Vars.content.getByName(ContentType.item, args[1]);
        if (found) {
            grab.item = found;
            grab.active = true;
            return notify("[lightgrey]Grab [green]ON [lightgrey]([accent]" + found.name + "[lightgrey])");
        } else {
            return notify("[scarlet]Item " + args[1] + " not found");
        }
    }

    notify("[lightgray]/grab <item>\n/grab toggle\n/grab min <val>\n/grab status");
});
