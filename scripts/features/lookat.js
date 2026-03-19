const notify = require("qol-control/core/logger").notify;
const interceptor = require("qol-control/core/interceptor");

let coordHistory = [];

Events.on(PlayerChatEvent, e => {
    if (!e.player) return; 
    
    let raw = String(e.message);
    let match = raw.match(/(\d\d?\d?\d?)([ ,./|][ ,./|]?[ ,./|]?)(\d\d?\d?\d?)/);

    if (match) {
        let x = parseInt(match[1]), y = parseInt(match[3]);
        if (x >= 0 && x <= 1000 && y >= 0 && y <= 1000) {
            coordHistory.push({
                nick: Strings.stripColors(e.player.name),
                x: x,
                y: y,
                hidden: false
            });
            if (coordHistory.length > 9) coordHistory.shift();
        }
    }
});

Events.on(WorldLoadEvent, () => {
    coordHistory = [];
});

let touchTimer = 0;
let lastTouchX = 0;
let lastTouchY = 0;
let isTouching = false;

Events.run(Trigger.update, () => {
    if (Core.input.isTouched()) {
        let wx = Core.input.mouseWorldX();
        let wy = Core.input.mouseWorldY();
        
        if (!isTouching) {
            isTouching = true;
            touchTimer = 0;
            lastTouchX = wx;
            lastTouchY = wy;
        } else {
            if (Mathf.dst(wx, wy, lastTouchX, lastTouchY) > 8) {
                touchTimer = 0;
                lastTouchX = wx;
                lastTouchY = wy;
            } else {
                touchTimer += Time.delta;
                if (touchTimer > 30) {
                    checkLongPress(wx, wy);
                    touchTimer = -9999;
                }
            }
        }
    } else {
        isTouching = false;
        touchTimer = 0;
    }
});

function checkLongPress(wx, wy) {
    let scl = Core.camera.width / Core.graphics.getWidth();
    let r = Math.max(40, 150 * scl);

    for (let i = 0; i < coordHistory.length; i++) {
        let c = coordHistory[i];
        if (!c.hidden) {
            if (Mathf.dst(wx, wy, c.x * 8, c.y * 8) < r) {
                c.hidden = true;
                break;
            }
        }
    }
}

Events.run(Trigger.draw, () => {
    let scl = Core.camera.width / Core.graphics.getWidth();
    let r = Math.max(40, 150 * scl);
    let pulse = Mathf.absin(Time.time, 8, r * 0.05);
    let fScale = Math.max(0.25, 0.8 * scl);

    for (let i = 0; i < coordHistory.length; i++) {
        let c = coordHistory[i];
        if (c.hidden) continue;

        let wx = c.x * 8;
        let wy = c.y * 8;

        Draw.color(Pal.accent);
        Draw.alpha(0.3 + Mathf.absin(Time.time, 8, 0.7));
        Lines.stroke(2 + scl);
        Lines.circle(wx, wy, r + pulse);
        
        Draw.reset();

        let text = java.lang.String.valueOf(c.nick + " (" + c.x + ", " + c.y + ")");
        let font = Fonts.outline;
        
        let oldScaleX = font.getData().scaleX;
        let oldScaleY = font.getData().scaleY;
        
        try {
            font.getData().setScale(fScale);
            font.draw(text, wx, wy + r + pulse + (16 * fScale), 0, 1, false);
        } finally {
            font.getData().setScale(oldScaleX, oldScaleY);
        }
    }
});

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
                    let hiddenTag = c.hidden ? " [darkgrey](hidden)[]" : "";
                    str += "\n[lightgrey]" + (i + 1) + " - " + c.nick + "[lightgrey] - [accent]" + c.x + " " + c.y + hiddenTag;
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
