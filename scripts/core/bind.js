const interceptor = require("qol-control/core/interceptor");
const SETTINGS_KEY = "qol-binds";

const allKeys = KeyCode.values();
let dialog = null;
let bindsCache = {};
let listeningCallback = null;
let listeningDialog = null;

function loadData() {
    try {
        let data = JSON.parse(Core.settings.getString(SETTINGS_KEY, "{}"));
        bindsCache = data;
        return data;
    } catch (e) {
        bindsCache = {};
        return {};
    }
}

function saveData(data) {
    bindsCache = data;
    Core.settings.put(SETTINGS_KEY, JSON.stringify(data));
}

loadData();

function executeChat(text) {
    if (!text) return;
    let lines = text.split("\n");
    for(let i = 0; i < lines.length; i++){
        let line = lines[i];
        if(line.length > 0){
            while(line.length > 150) {
                Call.sendChatMessage(line.substring(0, 150));
                line = line.substring(150);
            }
            if(line.length > 0) {
                Call.sendChatMessage(line);
            }
        }
    }
}

function buildUI() {
    dialog = new BaseDialog("Key Binds Menu");
    dialog.addCloseButton();
    showMainMenu();
}

function showMainMenu() {
    let data = loadData();
    dialog.cont.clear();
    
    let table = new Table();
    table.top().left();
    
    let keys = Object.keys(data);
    if (keys.length === 0) {
        table.add("[lightgray]No keybinds found. Create one!").pad(10).row();
    } else {
        keys.forEach(key => {
            let cmd = data[key];
            let displayCmd = cmd.replace(/\n/g, " | ");
            let rowTable = new Table();
            
            let btnCell = rowTable.button(cons(b => {
                b.left();
                b.add("[accent]" + key).width(140).left().padRight(10);
                
                let infoCell = b.add("[white]" + displayCmd).left().growX().minWidth(0);
                infoCell.get().setEllipsis(true);
            }), () => {
                showEditBindDialog(key, cmd);
            });
            
            btnCell.size(300, 60).left().padRight(10);
            btnCell.get().setStyle(Styles.cleart);
            
            rowTable.button(Icon.edit, Styles.cleari, () => {
                showEditBindDialog(key, cmd);
            }).size(45, 60);
            
            rowTable.button(Icon.trash, Styles.cleari, () => {
                Vars.ui.showConfirm("Delete Bind", "Are you sure you want to delete the bind for '" + key + "'?", () => {
                    let currentData = loadData();
                    delete currentData[key];
                    saveData(currentData);
                    showMainMenu();
                });
            }).size(45, 60);
            
            table.add(rowTable).padBottom(5).row();
        });
    }
    
    dialog.cont.add(new ScrollPane(table)).width(440).height(340).row();
    
    dialog.cont.button("Add Bind", Icon.add, () => {
        showEditBindDialog("", "");
    }).size(440, 50).padTop(10);
}

function showListeningDialog(callback) {
    listeningDialog = new BaseDialog("Listening...");
    listeningDialog.cont.add("Press any key combination...").row();
    listeningDialog.cont.button("Cancel", () => {
        listeningCallback = null;
        listeningDialog.hide();
    }).size(150, 50).padTop(10);
    listeningDialog.show();

    listeningCallback = (res) => {
        listeningDialog.hide();
        callback(res);
    };
}

function showEditBindDialog(existingKey, existingCmd) {
    let isNew = existingKey === "";
    let d = new BaseDialog(isNew ? "Add Bind" : "Edit Bind");
    
    let key = existingKey;
    let cmd = existingCmd;
    
    let t = new Table();
    
    t.add("Key: ").padRight(5).right();
    let keyBtnCell = t.button(key || "Click to set", () => {
        showListeningDialog((res) => {
            key = res;
            keyBtnCell.get().setText(key);
        });
    }).size(250, 50);
    t.row();
    
    t.add("Command: ").colspan(2).padTop(10).left().row();
    t.area(cmd, txt => cmd = txt).size(400, 200).colspan(2).padTop(5).row();
    
    d.cont.add(t).row();
    
    d.buttons.button("@cancel", Icon.cancel, () => d.hide()).size(150, 50);
    d.buttons.button("@ok", Icon.ok, () => {
        if (!key || !cmd) {
            Vars.ui.showInfo("Key and Command cannot be empty.");
            return;
        }
        
        let data = loadData();
        if (!isNew && existingKey !== key) {
            delete data[existingKey];
        }
        data[key] = cmd;
        saveData(data);
        
        d.hide();
        showMainMenu();
    }).size(150, 50);
    
    d.show();
}

interceptor.add("bind", () => {
    if (!dialog) buildUI();
    else showMainMenu();
    dialog.show();
});

Events.run(Trigger.update, () => {
    if (listeningCallback) {
        for (let i = 0; i < allKeys.length; i++) {
            let k = allKeys[i];
            if (k === KeyCode.controlLeft || k === KeyCode.controlRight ||
                k === KeyCode.shiftLeft || k === KeyCode.shiftRight ||
                k === KeyCode.altLeft || k === KeyCode.altRight ||
                k === KeyCode.unknown) continue;

            if (Core.input.keyTap(k)) {
                let ctrl = Core.input.keyDown(KeyCode.controlLeft) || Core.input.keyDown(KeyCode.controlRight);
                let shift = Core.input.keyDown(KeyCode.shiftLeft) || Core.input.keyDown(KeyCode.shiftRight);
                let alt = Core.input.keyDown(KeyCode.altLeft) || Core.input.keyDown(KeyCode.altRight);

                let prefix = "";
                if (ctrl) prefix += "ctrl+";
                if (alt) prefix += "alt+";
                if (shift) prefix += "shift+";

                let res = prefix + k.name();
                let cb = listeningCallback;
                listeningCallback = null;
                cb(res);
                break;
            }
        }
        return;
    }

    if (!Vars.state.isGame() || Vars.state.isMenu()) return;
    if (Core.scene.hasKeyboard() || Vars.ui.chatfrag.shown()) return;

    for (let bindStr in bindsCache) {
        let parts = bindStr.split("+");
        let baseKeyStr = parts.pop();
        let needsCtrl = parts.indexOf("ctrl") !== -1;
        let needsAlt = parts.indexOf("alt") !== -1;
        let needsShift = parts.indexOf("shift") !== -1;

        let baseKey;
        try {
            baseKey = KeyCode.valueOf(baseKeyStr);
        } catch(e) {
            continue;
        }

        if (Core.input.keyTap(baseKey)) {
            let hasCtrl = Core.input.keyDown(KeyCode.controlLeft) || Core.input.keyDown(KeyCode.controlRight);
            let hasAlt = Core.input.keyDown(KeyCode.altLeft) || Core.input.keyDown(KeyCode.altRight);
            let hasShift = Core.input.keyDown(KeyCode.shiftLeft) || Core.input.keyDown(KeyCode.shiftRight);

            if (needsCtrl === hasCtrl && needsAlt === hasAlt && needsShift === hasShift) {
                let cmd = bindsCache[bindStr];
                executeChat(cmd);
            }
        }
    }
});
