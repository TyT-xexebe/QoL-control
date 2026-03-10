const notify = require("qol-control/core/logger").notify;
const interceptor = require("qol-control/core/interceptor");

const SETTINGS_KEY = "qol-local-mute";

function loadMuted() {
    try {
        let parsed = JSON.parse(Core.settings.getString(SETTINGS_KEY, "[]"));
        return parsed.map(item => typeof item === "string" ? { type: "exact", value: item } : item);
    } catch (e) {
        return [];
    }
}

function saveMuted(list) {
    Core.settings.put(SETTINGS_KEY, JSON.stringify(list));
}

function isMuted(name) {
    if (!name) return false;
    let muted = loadMuted();
    let cleanName = Strings.stripColors(name).toLowerCase();
    return muted.some(m => m.type === "exact" ? cleanName === m.value : cleanName.includes(m.value));
}

Events.on(Packages.mindustry.game.EventType.PlayerChatEvent, cons(e => {
    if (e.player && isMuted(e.player.name)) {
        Core.app.post(() => {
            try {
                if (!Vars.ui || !Vars.ui.chatfrag) return;
                
                let messagesField = Vars.ui.chatfrag.getClass().getDeclaredField("messages");
                messagesField.setAccessible(true);
                let messages = messagesField.get(Vars.ui.chatfrag);
                
                let targetIndex = -1;
                let cleanPlayerName = Strings.stripColors(e.player.name);
                
                for(let i = 0; i < messages.size; i++) {
                    let msgObj = messages.get(i);
                    if (msgObj == null) continue;
                    
                    let isMatch = false;
                    
                    if (typeof msgObj.getClass === "undefined") {
                        if (Strings.stripColors(String(msgObj)).indexOf(cleanPlayerName) !== -1) isMatch = true;
                    } else {
                        try {
                            let senderField = msgObj.getClass().getDeclaredField("sender");
                            senderField.setAccessible(true);
                            let sender = senderField.get(msgObj);
                            
                            if (sender) {
                                let senderName = typeof sender === "string" ? sender : sender.name;
                                if (senderName && Strings.stripColors(senderName) === cleanPlayerName) isMatch = true;
                            } else {
                                let textField = msgObj.getClass().getDeclaredField("message");
                                textField.setAccessible(true);
                                if (Strings.stripColors(textField.get(msgObj)).indexOf(cleanPlayerName) !== -1) isMatch = true;
                            }
                        } catch (ex) {
                            if (Strings.stripColors(String(msgObj)).indexOf(cleanPlayerName) !== -1) isMatch = true;
                        }
                    }
                    
                    if (isMatch) {
                        targetIndex = i;
                        break;
                    }
                }
                
                if (targetIndex !== -1) {
                    messages.remove(messages.get(targetIndex));
                    try {
                        Vars.ui.chatfrag.updateChat();
                    } catch (err1) {
                        try {
                            let updateChatMethod = Vars.ui.chatfrag.getClass().getDeclaredMethod("updateChat");
                            updateChatMethod.setAccessible(true);
                            updateChatMethod.invoke(Vars.ui.chatfrag);
                        } catch (err2) {}
                    }
                }
            } catch (err) {}
        });
    }
}));

interceptor.add("mute", (args) => {
    let cmd = args[1] ? args[1].toLowerCase() : "";
    let target = args[2] ? args[2].toLowerCase() : "";
    let muted = loadMuted();

    if (cmd === "list") {
        if (muted.length === 0) {
            notify("[lightgray]Mute list is empty");
        } else {
            let listStr = muted.map(m => (m.type === "exact" ? "[lightgrey][Exact][]" : "[lightgrey][Partial][]") + " [white]" + m.value).join("\n");
            notify("[accent]Muted players:\n" + listStr);
        }
    } 
    else if (cmd === "add") {
        if (!target) {
            notify("[scarlet]Specify a player name part");
            return;
        }
        
        let found = null;
        Groups.player.each(p => {
            if (Strings.stripColors(p.name).toLowerCase().includes(target)) {
                found = p;
            }
        });

        if (found) {
            let cleanName = Strings.stripColors(found.name).toLowerCase();
            if (!muted.some(m => m.type === "exact" && m.value === cleanName)) {
                muted.push({ type: "exact", value: cleanName });
                saveMuted(muted);
                notify("[green]Muted (Exact): [white]" + found.name);
            } else {
                notify("[lightgray]Player is already muted");
            }
        } else {
            notify("[scarlet]Player [white]" + target + " [scarlet]not found on server");
        }
    }
    else if (cmd === "addp") {
        if (!target) {
            notify("[scarlet]Please specify a partial name to mute");
            return;
        }
        
        if (!muted.some(m => m.type === "partial" && m.value === target)) {
            muted.push({ type: "partial", value: target });
            saveMuted(muted);
            notify("[green]Muted (Partial): [white]" + target);
        } else {
            notify("[lightgray]This partial mute already exists");
        }
    }
    else if (cmd === "remove" || cmd === "rem") {
        if (!target) {
            notify("[scarlet]Please specify a name part to remove");
            return;
        }

        let removed = false;
        let newList = muted.filter(m => {
            if (m.value.includes(target)) {
                removed = true;
                notify("[green]Unmuted (" + (m.type === "exact" ? "Exact" : "Partial") + "): [white]" + m.value);
                return false;
            }
            return true;
        });

        if (removed) {
            saveMuted(newList);
        } else {
            notify("[scarlet]No muted player found matching [white]" + target);
        }
    }
    else {
        notify("[lightgrey]!mute list\n!mute add <val>\n!mute addp <partial>\n!mute remove <val>");
    }
});
