const interceptor = require("qol-control/core/interceptor");

interceptor.add("here", (args, msg) => {
    let x = Math.floor(Core.camera.position.x / 8);
    let y = Math.floor(Core.camera.position.y / 8);
    let comment = args.length > 1 ? " " + msg.substring(msg.indexOf(" ") + 1) : "";
    Call.sendChatMessage("[accent][" + x + " " + y + "] [white]" + comment);
});

interceptor.add("herec", (args, msg) => {
    let mouse = Core.input.mouseWorld();
    let x = Math.floor(mouse.x / 8);
    let y = Math.floor(mouse.y / 8);
    let comment = args.length > 1 ? " " + msg.substring(msg.indexOf(" ") + 1) : "";
    Call.sendChatMessage("[accent][" + x + " " + y + "] [white]" + comment);
});
