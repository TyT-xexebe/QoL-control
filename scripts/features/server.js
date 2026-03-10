const interceptor = require("qol-control/core/interceptor");
const SETTINGS_KEY = "qol-custom-servers";
let dialog = null;

function normalizeServer(ip, port) {
    let resIp = String(ip || "");
    let resPort = parseInt(port);
    if (isNaN(resPort)) resPort = 6567;
    
    if (resIp.indexOf(":") !== -1) {
        let parts = resIp.split(":");
        resIp = parts[0];
        let p = parseInt(parts[1]);
        if (!isNaN(p)) resPort = p;
    }
    
    if (resIp.startsWith("/")) resIp = resIp.substring(1);
    
    return { ip: resIp, port: resPort };
}

Events.on(Packages.mindustry.game.EventType.ClientPreConnectEvent, cons(e => {
    if (e.host) {
        let norm = normalizeServer(e.host.address, e.host.port);
        Core.settings.put("qol-last-ip", norm.ip);
        Core.settings.put("qol-last-port", String(norm.port));
    }
}));

function loadData() {
    try {
        return JSON.parse(Core.settings.getString(SETTINGS_KEY, "{}"));
    } catch (e) {
        return {};
    }
}

function saveData(data) {
    Core.settings.put(SETTINGS_KEY, JSON.stringify(data));
}

function getCurrentServer() {
    try {
        if (Vars.net.active() && Vars.net.client()) {
            let ip = "";
            let port = 6567;
            
            try {
                let hostField = Vars.netClient.getClass().getDeclaredField("host");
                hostField.setAccessible(true);
                let currentHost = hostField.get(Vars.netClient);
                if (currentHost) {
                    ip = String(currentHost.address);
                    port = parseInt(currentHost.port);
                }
            } catch(e) {}
            
            if (!ip || ip === "undefined" || ip === "") {
                ip = String(Core.settings.getString("qol-last-ip", ""));
                port = parseInt(Core.settings.getString("qol-last-port", "6567"));
            }
            
            if (!ip || ip === "undefined" || ip === "") {
                ip = String(Core.settings.getString("ip", ""));
                port = Core.settings.getInt("port", 6567);
            }
            
            let norm = normalizeServer(ip, port);
            
            if (norm.ip && norm.ip !== "undefined" && norm.ip !== "null" && norm.ip !== "") {
                return norm;
            }
        }
    } catch(e) {}
    return null;
}

function buildUI() {
    dialog = new BaseDialog("Servers Menu");
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
        table.add("[lightgray]No categories found. Create one!").pad(10).row();
    } else {
        keys.forEach(cat => {
            let rowTable = new Table();
            
            rowTable.button("[accent]" + cat, Styles.cleart, () => showCategory(cat)).size(300, 50).left().padRight(10);
            
            rowTable.button(Icon.edit, Styles.cleari, () => {
                Vars.ui.showTextInput("Edit Category", "Name", cat, text => {
                    if (text && text !== cat && !data[text]) {
                        data[text] = data[cat];
                        delete data[cat];
                        saveData(data);
                        showMainMenu();
                    }
                });
            }).size(45, 50);
            
            rowTable.button(Icon.trash, Styles.cleari, () => {
                Vars.ui.showConfirm("Delete Category", "Are you sure you want to delete category '" + cat + "' and all its servers?", () => {
                    delete data[cat];
                    saveData(data);
                    showMainMenu();
                });
            }).size(45, 50);
            
            table.add(rowTable).padBottom(5).row();
        });
    }
    
    dialog.cont.add(new ScrollPane(table)).width(420).height(400).row();
    
    dialog.cont.button("Add Category", Icon.add, () => {
        Vars.ui.showTextInput("New Category", "Name", "", text => {
            if (text && !data[text]) {
                data[text] = [];
                saveData(data);
                showMainMenu();
            }
        });
    }).size(420, 50).padTop(10);
}

function showCategory(catName) {
    let data = loadData();
    dialog.cont.clear();
    
    let servers = data[catName] || [];
    let header = new Table();
    
    header.button(Icon.left, Styles.cleari, () => showMainMenu()).size(50, 50).padRight(10);
    header.add("[accent]" + catName + " Servers").growX().left();
    dialog.cont.add(header).width(420).padBottom(10).row();
    
    let table = new Table();
    table.top().left();
    
    let current = getCurrentServer();
    
    if (servers.length === 0) {
        table.add("[lightgray]No servers in this category.").pad(10).row();
    } else {
        servers.forEach((srv, srvIndex) => {
            let rowTable = new Table();
            
            let normSrv = normalizeServer(srv.ip, srv.port);
            let isCurrent = current && current.ip === normSrv.ip && current.port === normSrv.port;
            let nameColor = isCurrent ? "[accent]" : "[white]";
            
            let btnCell = rowTable.button(cons(b => {
                b.left();
                
                let infoCell = b.add(nameColor + srv.name + "\n[lightgray]" + normSrv.ip + ":" + normSrv.port).left().growX().minWidth(0);
                infoCell.get().setEllipsis(true);
                
                let pingLabel = b.add("[lightgray]Pinging...").right().padLeft(5).get();
                pingLabel.setAlignment(16);
                
                try {
                    Vars.net.pingHost(normSrv.ip, normSrv.port, cons(host => {
                        Core.app.post(run(() => {
                            if (pingLabel) pingLabel.setText("[green]" + host.players + " [lightgray]online");
                        }));
                    }), cons(err => {
                        Core.app.post(run(() => {
                            if (pingLabel) pingLabel.setText("[scarlet]Offline");
                        }));
                    }));
                } catch(e) {
                    if (pingLabel) pingLabel.setText("[scarlet]Error");
                }
                
            }), () => {
                dialog.hide();
                connectToServer(normSrv.ip, normSrv.port);
            });
            
            btnCell.size(300, 60).left().padRight(10);
            btnCell.get().setStyle(Styles.cleart);
            
            rowTable.button(Icon.edit, Styles.cleari, () => showEditServerDialog(catName, srvIndex, srv)).size(45, 60);
            
            rowTable.button(Icon.trash, Styles.cleari, () => {
                Vars.ui.showConfirm("Delete Server", "Are you sure you want to delete '" + srv.name + "'?", () => {
                    let currentData = loadData();
                    currentData[catName].splice(srvIndex, 1);
                    saveData(currentData);
                    showCategory(catName);
                });
            }).size(45, 60);
            
            table.add(rowTable).padBottom(5).row();
        });
    }
    
    dialog.cont.add(new ScrollPane(table)).width(420).height(340).row();
    
    dialog.cont.button("Add Server", Icon.add, () => {
        showEditServerDialog(catName, -1, {name: "", ip: "", port: 6567});
    }).size(420, 50).padTop(10);
}

function showEditServerDialog(catName, index, srvData) {
    let d = new BaseDialog(index === -1 ? "Add Server" : "Edit Server");
    let name = srvData.name;
    let ip = srvData.ip;
    let port = srvData.port;
    
    let t = new Table();
    
    t.add("Name: ").padRight(5).right();
    let nameField = t.field(name, text => name = text).size(250, 50).get();
    t.row();
    
    t.add("IP: ").padRight(5).right().padTop(5);
    let ipField = t.field(ip, text => ip = text).size(250, 50).padTop(5).get();
    t.row();
    
    t.add("Port: ").padRight(5).right().padTop(5);
    let portField = t.field(port.toString(), text => {
        let p = parseInt(text);
        if(!isNaN(p)) port = p;
    }).size(250, 50).padTop(5).get();
    t.row();
    
    d.cont.add(t).row();
    
    let current = getCurrentServer();
    if (index === -1 && current) {
        d.cont.button("Fill Current Server", Icon.download, () => {
            try {
                ip = String(current.ip);
                port = parseInt(current.port);
                ipField.setText(ip);
                portField.setText(String(port));
                nameField.requestKeyboard();
            } catch(e) {}
        }).size(250, 50).padTop(10).row();
    }
    
    d.buttons.button("@cancel", Icon.cancel, () => d.hide()).size(150, 50);
    d.buttons.button("@ok", Icon.ok, () => {
        if (!name || !ip) {
            Vars.ui.showInfo("Name and IP cannot be empty.");
            return;
        }
        let data = loadData();
        let norm = normalizeServer(ip, port);
        let newSrv = {name: name, ip: norm.ip, port: norm.port};
        
        if (index === -1) {
            data[catName].push(newSrv);
        } else {
            data[catName][index] = newSrv;
        }
        
        saveData(data);
        d.hide();
        showCategory(catName);
    }).size(150, 50);
    
    d.show();
}

function connectToServer(ip, port) {
    let norm = normalizeServer(ip, port);
    Core.settings.put("qol-last-ip", norm.ip);
    Core.settings.put("qol-last-port", String(norm.port));
    
    if (Vars.net.active()) Vars.netClient.disconnectQuietly();
    Time.runTask(15, run(() => Vars.ui.join.connect(norm.ip, norm.port)));
}

interceptor.add("server", () => {
    if (!dialog) buildUI();
    else showMainMenu();
    dialog.show();
});
