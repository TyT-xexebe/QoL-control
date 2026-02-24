const notify = (text) => Vars.ui.chatfrag.addMessage("[accent]󰚩 [white] " + text);

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
        return notify("Grab: " + (grab.active ? "[green]ON" : "[scarlet]OFF"));
    }

    if (args[1] === "min" && args[2]) {
        let val = parseInt(args[2]);
        if (isNaN(val) || val < 1) return notify("Min: [scarlet]Invalid");
        grab.min = val;
        return notify("Grab Min: [accent]" + val);
    }

    if (args[1] === "status") {
        return notify("\n[accent]STATUS" +
                      "\n[white]State: " + (grab.active ? "[green]ON" : "[scarlet]OFF") +
                      "\n[white]Item: [accent]" + (grab.item ? grab.item.name : "none") +
                      "\n[white]Min: [accent]" + grab.min);
    }

    if (args[1] && args[1] !== "help") {
        let found = Vars.content.getByName(ContentType.item, args[1]);
        if (found) {
            grab.item = found;
            grab.active = true;
            return notify("Grab: [green]ON [white](" + found.name + ")");
        } else {
            return notify("Item: [scarlet]Not found");
        }
    }

    notify("[accent]Grab:\n[lightgray]/grab <item>\n/grab toggle\n/grab min <val>\n/grab status");
});
