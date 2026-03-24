const notify = require("qol-control/core/logger").notify;
const interceptor = require("qol-control/core/interceptor");

let camEnabled = false;
let trackedPlayer = null;

interceptor.add("cam", (args) => {
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
        camEnabled = interceptor.parseToggle(camEnabled, args[1] === "toggle" ? args[2] : args[1]);
        if (!camEnabled) trackedPlayer = null;
        notify("[lightgray]Camera Display " + (camEnabled ? "[green]ON" : "[scarlet]OFF"));
    }
});

Events.run(Trigger.draw, () => {
    if (!Vars.state.isGame() || !camEnabled) return;

    let w = 400;
    let h = 200;

    Groups.player.each(p => {
        if (p === Vars.player) return;
        if (trackedPlayer && p !== trackedPlayer) return;

        let c = p.color;
        Draw.z(Layer.max);
        
        Lines.stroke(1.5);
        Draw.color(c, 0.35);
        Lines.rect(p.x - w / 2, p.y - h / 2, w, h);

        Draw.color(c, 0.6);
        Lines.square(p.mouseX, p.mouseY, 4, 45);

        let u = p.unit();
        if (u && u.isAdded()) {
            Lines.stroke(1.2);
            Draw.color(c, 0.25);
            Lines.line(u.x, u.y, p.x, p.y);
            
            Draw.color(c, 0.45);
            Lines.line(u.x, u.y, p.mouseX, p.mouseY);
        }
        
        Draw.reset();
    });
});
