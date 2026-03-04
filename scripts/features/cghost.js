const notify = require("qol-control/core/logger").notify;

Events.on(ClientChatEvent, e => {
    let msg = String(e.message);
    let args = msg.trim().toLowerCase().split(" ");
    let cmd = args[0];

    if (cmd === "/cghost" || cmd === "/cg") {
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
});
