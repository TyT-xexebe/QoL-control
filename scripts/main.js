const logger = require("qol-control/core/logger");

let settings = {};
try {
    let mod = Vars.mods.getMod("qol-control");
    if (mod) {
        let file = mod.root.child("scripts").child("settings.json");
        if (file.exists()) {
            settings = JSON.parse(file.readString());
        } else {
            logger.err("settings.json not found!");
        }
    }
} catch(e) {
    logger.err("Failed to read settings.json: " + e);
}

const activeModules = [];
for (let mod in settings) {
    if (settings[mod]) {
        activeModules.push(mod);
    }
}

global.qolActiveModules = activeModules;

require("qol-control/core/help");

for (let module of activeModules) {
    try {
        require("qol-control/" + module);
        logger.info("Loaded qol-control/" + module);
    } catch (e) {
        logger.err("Failed to load " + module);
        logger.err(e);
    }
}
