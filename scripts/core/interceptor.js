const commands = {};

function registerCommand(name, handler) {
    commands[name.toLowerCase()] = handler;
}

function handleCommand(msg) {
    if (!msg.startsWith("!") && !msg.startsWith("?")) return false;
    let args = msg.substring(1).split(" ");
    let cmd = args[0].toLowerCase();
    
    if (commands.hasOwnProperty(cmd)) {
        try {
            commands[cmd](args, msg);
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
                        
                        if (msg && msg.startsWith("!")) {
                            if (handleCommand(msg)) {
                                return;
                            }
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
                if (player === Vars.player && text && (text.startsWith("!") || text.startsWith("?"))) {
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

module.exports = {
    add: registerCommand
};
