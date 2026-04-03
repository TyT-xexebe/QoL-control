const commands = {};

function registerCommand(name, handler) {
    commands[name.toLowerCase()] = handler;
}

function handleCommand(msg) {
    let fooState = Core.settings.getBool("qol-control-foo-client", false);
    if (fooState && msg.length > 1) {
        msg = msg.replace(/[\s\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\uE000-\uF8FF\uFFF0-\uFFFF\x00-\x1F\u0F80-\u107F]+$/, '');
    }

    let cleanMsg = msg.replace(/^\/(t|a)\s+/i, '');

    if (!cleanMsg.startsWith("!") && !cleanMsg.startsWith("?")) return false;
    let args = cleanMsg.substring(1).split(" ");
    let cmd = args[0].toLowerCase();
    
    if (commands.hasOwnProperty(cmd)) {
        try {
            commands[cmd](args, cleanMsg);
        } catch(e) {}
        
        return true;
    }
    return false;
}

try {
    const NetProvider = Packages.mindustry.net.Net.NetProvider;
    const providerField = Vars.net.getClass().getDeclaredField("provider");
    providerField.setAccessible(true);
    const originalProvider = providerField.get(Vars.net);

    if (String(originalProvider).indexOf("ChatInterceptorProxy") === -1) {
        const proxy = new JavaAdapter(NetProvider, {
            connectClient: function(ip, port, success) { originalProvider.connectClient(ip, port, success); },
            
            sendClient: function(object, reliable) {
                try {
                    let className = object.getClass().getSimpleName().toLowerCase();
                    if (className.indexOf("chat") !== -1 || className.indexOf("message") !== -1) {
                        let msgField = object.getClass().getField("message");
                        let msg = msgField.get(object);
                        
                        if (msg && handleCommand(msg)) {
                            return;
                        }
                    }
                } catch (e) {}
                
                originalProvider.sendClient(object, reliable);
            },
            
            disconnectClient: function() { originalProvider.disconnectClient(); },
            discoverServers: function(callback, done) { originalProvider.discoverServers(callback, done); },
            pingHost: function(address, port, valid, failed) { originalProvider.pingHost(address, port, valid, failed); },
            hostServer: function(port) { originalProvider.hostServer(port); },
            getConnections: function() { return originalProvider.getConnections(); },
            closeServer: function() { originalProvider.closeServer(); },
            dispose: function() { originalProvider.dispose(); },
            setConnectFilter: function(filter) { originalProvider.setConnectFilter(filter); },
            getConnectFilter: function() { return originalProvider.getConnectFilter(); },
            
            toString: function() { return "ChatInterceptorProxy"; }
        });

        providerField.set(Vars.net, proxy);
    }
} catch(e) {}

try {
    const ChatFilter = Packages.mindustry.net.Administration.ChatFilter;
    
    let filtersField = Vars.netServer.admins.getClass().getDeclaredField("chatFilters");
    filtersField.setAccessible(true);
    let filters = filtersField.get(Vars.netServer.admins);
    
    let alreadyAdded = false;
    for (let i = 0; i < filters.size; i++) {
        if (String(filters.get(i)).indexOf("HostChatInterceptor") !== -1) {
            alreadyAdded = true;
            break;
        }
    }
    
    if (!alreadyAdded) {
        let filter = new JavaAdapter(ChatFilter, {
            filter: function(player, text) {
                if (player === Vars.player && text) {
                    if (handleCommand(text)) {
                        return null;
                    }
                }
                return text;
            },
            toString: function() { return "HostChatInterceptor"; }
        });
        
        Vars.netServer.admins.addChatFilter(filter);
    }
} catch(e) {}

function parseToggle(current, arg) {
    if (!arg) return !current;
    arg = arg.toLowerCase();
    if (arg === "1" || arg === "true" || arg === "on" || arg === "yes") return true;
    if (arg === "0" || arg === "false" || arg === "off" || arg === "no") return false;
    return !current;
}

module.exports = {
    add: registerCommand,
    parseToggle: parseToggle
};
