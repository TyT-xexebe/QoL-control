const interceptor = require("qol-control/core/interceptor");

interceptor.add("here", (args, msg) => {
    let x = Math.floor(Core.camera.position.x / 8);
    let y = Math.floor(Core.camera.position.y / 8);
    let comment = args.length > 1 ? " " + msg.substring(msg.indexOf(" ") + 1) : "";
    Call.sendChatMessage("[accent][" + x + " " + y + "] [white]" + comment);
});
