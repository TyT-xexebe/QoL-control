const logger = require("qol-control/core/logger");

let defaultSettings = {};

try {
    let mod = Vars.mods.getMod("qol-control");
    if (mod) {
        let file = mod.root.child("scripts").child("settings.json");
        if (file.exists()) {
            defaultSettings = JSON.parse(file.readString());
        } else {
            logger.err("settings.json not found!");
        }
    }
} catch(e) {
    logger.err("Failed to read settings.json: " + e);
}

const activeModules = [];
for (let modName in defaultSettings) {
    let isEnabled = Core.settings.getBool("qol-control-" + modName, defaultSettings[modName]);
    if (isEnabled) {
        activeModules.push(modName);
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

if (!Vars.headless) {
    let hasChanged = false;

    Events.on(ClientLoadEvent, cons(e => {
        Vars.ui.settings.addCategory("QoL Control", Icon.logic, cons(table => {
            table.add("[accent]QoL Control Settings[]").padBottom(10).row();
            table.add("These settings only enable or disable the module import at startup.").padBottom(5).row();
            table.add("They do not affect the internal settings of the features themselves.").padBottom(5).row();
            table.add("[coral]The game will request a restart upon exiting settings![]").padBottom(20).row();
            
            for (let modName in defaultSettings) {
                let displayName = modName.split('/')
                    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                    .join(': ');
                
                let key = "qol-control-" + modName;
                let currentState = Core.settings.getBool(key, defaultSettings[modName]);
                
                table.check(displayName, b => {
                    Core.settings.put(key, b);
                    hasChanged = true;
                }).checked(currentState).left().padBottom(6).row();
            }
            
            let fooKey = "qol-control-foo-client";
            let fooState = Core.settings.getBool(fooKey, false);
            table.check("Turn on if you using Foo's client", b => {
                Core.settings.put(fooKey, b);
                hasChanged = true;
            }).checked(fooState).left().padBottom(6).row();
        }));

        Vars.ui.settings.hidden(run(() => {
            if (hasChanged) {
                hasChanged = false;
                
                if (typeof Core.settings.forceSave === "function") {
                    Core.settings.forceSave();
                }
                
                Vars.ui.showConfirm(
                    "Restart Required",
                    "You have changed QoL Control settings.\nA restart is required to apply them.\n\nExit the game now?",
                    run(() => {
                        Core.app.exit();
                    })
                );
            }
        }));
    }));
}

Events.on(ClientLoadEvent, cons(e => {
    Vars.maxSchematicSize = 512;
    Vars.renderer.minZoom = 0.1;
    Vars.renderer.maxZoom = 10.0;
}));
