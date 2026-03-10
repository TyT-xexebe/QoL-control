const interceptor = require("qol-control/core/interceptor");
const SETTINGS_KEY = "qol-custom-servers";
let dialog = null;

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
            }).size(50, 50);
            
            rowTable.button(Icon.trash, Styles.cleari, () => {
                Vars.ui.showConfirm("Delete Category", "Are you sure you want to delete category '" + cat + "' and all its servers?", () => {
                    delete data[cat];
                    saveData(data);
                    showMainMenu();
                });
            }).size(50, 50);
            
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
    
    if (servers.length === 0) {
        table.add("[lightgray]No servers in this category.").pad(10).row();
    } else {
        servers.forEach((srv, srvIndex) => {
            let rowTable = new Table();
            
            rowTable.button("[white]" + srv.name + "\n[lightgray]" + srv.ip + ":" + srv.port, Styles.cleart, () => {
                dialog.hide();
                connectToServer(srv.ip, srv.port);
            }).size(300, 60).left().padRight(10);
            
            rowTable.button(Icon.edit, Styles.cleari, () => showEditServerDialog(catName, srvIndex, srv)).size(50, 60);
            
            rowTable.button(Icon.trash, Styles.cleari, () => {
                Vars.ui.showConfirm("Delete Server", "Are you sure you want to delete '" + srv.name + "'?", () => {
                    let currentData = loadData();
                    currentData[catName].splice(srvIndex, 1);
                    saveData(currentData);
                    showCategory(catName);
                });
            }).size(50, 60);
            
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
    t.field(name, text => name = text).size(250, 50).row();
    
    t.add("IP: ").padRight(5).right().padTop(5);
    t.field(ip, text => ip = text).size(250, 50).padTop(5).row();
    
    t.add("Port: ").padRight(5).right().padTop(5);
    t.field(port.toString(), text => {
        let p = parseInt(text);
        if(!isNaN(p)) port = p;
    }).size(250, 50).padTop(5).row();
    
    d.cont.add(t).row();
    
    d.buttons.button("@cancel", Icon.cancel, () => d.hide()).size(150, 50);
    d.buttons.button("@ok", Icon.ok, () => {
        if (!name || !ip) {
            Vars.ui.showInfo("Name and IP cannot be empty.");
            return;
        }
        let data = loadData();
        let newSrv = {name: name, ip: ip, port: port};
        
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
    if (Vars.net.active()) Vars.netClient.disconnectQuietly();
    Time.runTask(15, run(() => Vars.ui.join.connect(ip, port)));
}

interceptor.add("server", () => {
    if (!dialog) buildUI();
    else showMainMenu();
    dialog.show();
});
