const notify = require("qol-control/core/logger").notify;
const interceptor = require("qol-control/core/interceptor");

var coordHistory = {};
var coordOrder = [];
var COORD_TTL = 2 * 60 * 1000;

function makeKey(x, y) {
    return x + "," + y;
}

function now() {
    return java.lang.System.currentTimeMillis();
}

function removeKey(key) {
    if (coordHistory[key] != null) {
        delete coordHistory[key];
    }

    for (var i = 0; i < coordOrder.length; i++) {
        if (coordOrder[i] === key) {
            coordOrder.splice(i, 1);
            break;
        }
    }
}

function trimHistory() {
    while (coordOrder.length > 9) {
        var oldestKey = coordOrder[0];
        removeKey(oldestKey);
    }
}

function purgeExpired() {
    var t = now();

    for (var i = coordOrder.length - 1; i >= 0; i--) {
        var key = coordOrder[i];
        var c = coordHistory[key];

        if (c == null) {
            coordOrder.splice(i, 1);
            continue;
        }

        if (t >= c.expiresAt) {
            removeKey(key);
        }
    }
}

Events.on(PlayerChatEvent, function(e) {
    if (!e.player) return;

    var raw = String(e.message);
    var match = raw.match(/(\d\d?\d?\d?)([ ,./|][ ,./|]?[ ,./|]?)(\d\d?\d?\d?)/);

    if (!match) return;

    var x = parseInt(match[1], 10);
    var y = parseInt(match[3], 10);

    if (x < 0 || x > 1000 || y < 0 || y > 1000) return;

    var key = makeKey(x, y);
    var t = now();
    var nick = Strings.stripColors(e.player.name);
    var existing = coordHistory[key];

    if (existing != null) {
        existing.hidden = false;
        existing.nick = nick;
        existing.expiresAt = t + COORD_TTL;
    } else {
        coordHistory[key] = {
            nick: nick,
            x: x,
            y: y,
            hidden: false,
            expiresAt: t + COORD_TTL
        };

        coordOrder.push(key);
        trimHistory();
    }
});

Events.on(WorldLoadEvent, function() {
    coordHistory = {};
    coordOrder = [];
});

var touchTimer = 0;
var isTouching = false;
var pressX = 0;
var pressY = 0;
var triggerUsed = false;

Events.run(Trigger.update, function() {
    purgeExpired();

    if (Core.input.isTouched()) {
        var wx = Core.input.mouseWorldX();
        var wy = Core.input.mouseWorldY();

        if (!isTouching) {
            isTouching = true;
            touchTimer = 0;
            triggerUsed = false;
            pressX = wx;
            pressY = wy;
        } else {
            if (Mathf.dst(wx, wy, pressX, pressY) > 8) {
                touchTimer = 0;
                pressX = wx;
                pressY = wy;
            } else if (!triggerUsed) {
                touchTimer += Time.delta;

                if (touchTimer > 30) {
                    checkLongPress(pressX, pressY);
                    triggerUsed = true;
                }
            }
        }
    } else {
        isTouching = false;
        touchTimer = 0;
        triggerUsed = false;
    }
});

function checkLongPress(wx, wy) {
    var scl = Core.camera.width / Core.graphics.getWidth();
    var r = Math.max(40, 150 * scl);

    var bestKey = null;
    var bestDst = 999999;

    for (var i = 0; i < coordOrder.length; i++) {
        var key = coordOrder[i];
        var c = coordHistory[key];

        if (c == null || c.hidden) continue;

        var dst = Mathf.dst(wx, wy, c.x * 8, c.y * 8);
        if (dst < r && dst < bestDst) {
            bestDst = dst;
            bestKey = key;
        }
    }

    if (bestKey != null) {
        coordHistory[bestKey].hidden = true;
    }
}

Events.run(Trigger.draw, function() {
    var scl = Core.camera.width / Core.graphics.getWidth();
    var r = Math.max(40, 150 * scl);
    var pulse = Mathf.absin(Time.time, 8, r * 0.05);
    var fScale = Math.max(0.25, 0.8 * scl);

    for (var i = 0; i < coordOrder.length; i++) {
        var key = coordOrder[i];
        var c = coordHistory[key];

        if (c == null || c.hidden) continue;

        var wx = c.x * 8;
        var wy = c.y * 8;

        Draw.color(Pal.accent);
        Draw.alpha(0.3 + Mathf.absin(Time.time, 8, 0.7));
        Lines.stroke(1 + scl);

        Lines.circle(wx, wy, r + pulse);

        var crossSize = r * 0.1;
        Lines.line(wx - crossSize, wy, wx + crossSize, wy);
        Lines.line(wx, wy - crossSize, wx, wy + crossSize);

        Draw.reset();

        var text = java.lang.String.valueOf(c.nick + " (" + c.x + ", " + c.y + ")");
        var font = Fonts.outline;

        var oldScaleX = font.getData().scaleX;
        var oldScaleY = font.getData().scaleY;

        try {
            font.getData().setScale(fScale);
            font.draw(text, wx, wy + r + pulse + (16 * fScale), 0, 1, false);
        } finally {
            font.getData().setScale(oldScaleX, oldScaleY);
        }
    }
});

var lookatHandler = function(args) {
    purgeExpired();

    if (args[1] === "last" || args[1] === "l") {
        if (args[2]) {
            var idx = parseInt(args[2], 10) - 1;

            if (idx >= 0 && idx < coordOrder.length) {
                var key = coordOrder[idx];
                var c = coordHistory[key];

                if (c != null) {
                    Core.camera.position.set(c.x * 8, c.y * 8);
                    notify("[lightgrey]Jump [accent]" + c.x + ", " + c.y);
                } else {
                    notify("[scarlet]Invalid index");
                }
            } else {
                notify("[scarlet]Invalid index");
            }
        } else {
            if (coordOrder.length === 0) {
                notify("[scarlet]History empty");
            } else {
                var str = "";
                for (var i = 0; i < coordOrder.length; i++) {
                    var key = coordOrder[i];
                    var c = coordHistory[key];

                    if (c == null) continue;

                    var hiddenTag = c.hidden ? " [darkgrey](hidden)[]" : "";
                    str += "\n[lightgrey]" + (i + 1) + " - " + c.nick + "[lightgrey] - [accent]" + c.x + " " + c.y + hiddenTag;
                }
                notify(str);
            }
        }
    } else {
        var x = parseFloat(args[1]);
        var y = parseFloat(args[2]);

        if (!isNaN(x) && !isNaN(y)) {
            Core.camera.position.set(x * 8, y * 8);
            notify("[lightgrey]Jump [accent]" + x + ", " + y);
        } else {
            notify("[lightgray]!lookat <x> <y>\n!lookat last <n?>\n\n!la <x> <y>\n!la l <n?>");
        }
    }
};

interceptor.add("lookat", lookatHandler);
interceptor.add("la", lookatHandler);
