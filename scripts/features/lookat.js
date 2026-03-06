const notify = require("qol-control/core/logger").notify;

let coordHistory = [];

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
});

const interceptor = require("qol-control/core/interceptor");

const lookatHandler = (args) => {
    if (args[1] === "last" || args[1] === "l") {
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
        } else notify("[lightgray]!lookat <x> <y>\n!lookat last <n?>\n\n!la <x> <y>\n!la l <n?>");
    }
};

interceptor.add("lookat", lookatHandler);
interceptor.add("la", lookatHandler);

interceptor.add("here", (args, msg) => {
    let x = Math.floor(Core.camera.position.x / 8);
    let y = Math.floor(Core.camera.position.y / 8);
    let comment = args.length > 1 ? " " + msg.substring(msg.indexOf(" ") + 1) : "";
    Call.sendChatMessage("[accent][" + x + " " + y + "] [white]" + comment);
});
