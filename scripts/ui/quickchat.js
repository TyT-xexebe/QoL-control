const interceptor = require("qol-control/core/interceptor");
const SETTINGS_KEY = "qol-quickchat";
let dialog = null;

let isDragging = false;
let startX = 0;
let startY = 0;

let btnX = Core.settings.getFloat("quickchat-btn-x", 150);
let btnY = Core.settings.getFloat("quickchat-btn-y", 200);

function loadData() {
    try {
        return JSON.parse(Core.settings.getString(SETTINGS_KEY, "[]"));
    } catch (e) {
        return [];
    }
}

function saveData(data) {
    Core.settings.put(SETTINGS_KEY, JSON.stringify(data));
}

let allIcons = [];

Events.on(ClientLoadEvent, () => {
    Vars.content.getBy(ContentType.block).each(c => {
        if(c.uiIcon && c.uiIcon !== Core.atlas.find("error") && c.uiIcon !== Core.atlas.find("clear")) allIcons.push({ name: String(c.name), icon: c.uiIcon, order: c.category ? c.category.ordinal() * 100 : 0 });
    });
    
    const addIcons = (type, typeOrder) => {
        Vars.content.getBy(type).each(c => {
            if(c.uiIcon && c.uiIcon !== Core.atlas.find("error") && c.uiIcon !== Core.atlas.find("clear")) allIcons.push({ name: String(c.name), icon: c.uiIcon, order: typeOrder });
        });
    };
    
    addIcons(ContentType.item, 10000);
    addIcons(ContentType.liquid, 10001);
    addIcons(ContentType.unit, 10002);
    allIcons.sort((a, b) => a.order !== b.order ? a.order - b.order : a.name.localeCompare(b.name));

    buildHUD();
});

function buildHUD() {
    let table = new Table();
    Vars.ui.hudGroup.addChild(table);
    table.setPosition(btnX, btnY);

    let btn = table.button(Icon.chat, Styles.clearNonei, () => {
        if(!isDragging){
            if (!dialog) buildUI();
            else showMainMenu();
            dialog.show();
        }
    }).size(50).get();

    btn.addListener(extend(InputListener, {
        touchDown(event, x, y, pointer, button) {
            isDragging = false;
            startX = x;
            startY = y;
            return true;
        },
        touchDragged(event, x, y, pointer) {
            if(!isDragging && (Math.abs(x - startX) > 5 || Math.abs(y - startY) > 5)){
                isDragging = true;
            }
            if(isDragging){
                btnX = Mathf.clamp(event.stageX, 25, Core.graphics.getWidth() - 25);
                btnY = Mathf.clamp(event.stageY, 25, Core.graphics.getHeight() - 25);
                table.setPosition(btnX, btnY);
            }
            return true;
        },
        touchUp(event, x, y, pointer) {
            Core.settings.put("quickchat-btn-x", new java.lang.Float(btnX));
            Core.settings.put("quickchat-btn-y", new java.lang.Float(btnY));
            Timer.schedule(() => { isDragging = false; }, 0.1);
            return true;
        }
    }));

    table.update(() => {
        table.setPosition(btnX, btnY);
        let visible = Vars.state.isGame() && Vars.ui.hudfrag.shown;
        if(table.visible !== visible) table.visible = visible;
    });
}

function buildUI() {
    dialog = new BaseDialog("Quick Chat");
    dialog.addCloseButton();
    showMainMenu();
}

function showMainMenu() {
    let data = loadData();
    dialog.cont.clear();
    
    let table = new Table();
    table.top().left();
    
    if (data.length === 0) {
        table.add("[lightgray]No messages found. Create one!").pad(10).row();
    } else {
        data.forEach((cmd, index) => {
            let rowTable = new Table();
            
            let btnCell = rowTable.button(cons(b => {
                b.left();
                let infoCell = b.add(cmd.name).left().growX().minWidth(0);
                infoCell.get().setEllipsis(true);
            }), () => {
                dialog.hide();
                let lines = cmd.text.split("\n");
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
            });
            
            btnCell.size(300, 60).left().padRight(10);
            btnCell.get().setStyle(Styles.cleart);
            
            rowTable.button(Icon.edit, Styles.cleari, () => showEditDialog(index, cmd)).size(45, 60);
            
            rowTable.button(Icon.trash, Styles.cleari, () => {
                Vars.ui.showConfirm("Delete Message", "Are you sure you want to delete '" + cmd.name + "'?", () => {
                    let currentData = loadData();
                    currentData.splice(index, 1);
                    saveData(currentData);
                    showMainMenu();
                });
            }).size(45, 60);
            
            table.add(rowTable).padBottom(5).row();
        });
    }
    
    dialog.cont.add(new ScrollPane(table)).width(420).height(400).row();
    
    dialog.cont.button("Add Message", Icon.add, () => {
        showEditDialog(-1, {name: "", text: ""});
    }).size(420, 50).padTop(10);
}

function showEditDialog(index, cmdData) {
    let d = new BaseDialog(index === -1 ? "Add Message" : "Edit Message");
    let name = cmdData.name;
    let text = cmdData.text;
    
    let t = new Table();
    
    t.add("Name: ").padRight(5).right();
    let nameField = t.field(name, n => name = n).size(200, 50).get();
    
    t.button(Icon.add, Styles.cleari, () => {
        showIconPicker(ic => {
            let unicode = Fonts.getUnicodeStr(ic.name);
            if(unicode) {
                name += unicode;
                nameField.setText(name);
            }
        });
    }).size(50, 50).padLeft(5);
    t.row();
    
    t.add("Text: ").padRight(5).right().padTop(5);
    let textField = t.area(text, txt => text = txt).size(350, 200).padTop(5).colspan(2).get();
    t.row();
    
    d.cont.add(t).row();
    
    d.buttons.button("@cancel", Icon.cancel, () => d.hide()).size(150, 50);
    d.buttons.button("@ok", Icon.ok, () => {
        if (!name || !text) {
            Vars.ui.showInfo("Name and Text cannot be empty.");
            return;
        }
        let data = loadData();
        let newCmd = {name: name, text: text};
        
        if (index === -1) {
            data.push(newCmd);
        } else {
            data[index] = newCmd;
        }
        
        saveData(data);
        d.hide();
        showMainMenu();
    }).size(150, 50);
    
    d.show();
}

function showIconPicker(callback) {
    let d = new BaseDialog("Pick Icon");
    d.addCloseButton();
    
    let iconPane = new Table();
    let colsCount = 0;
    for(let i = 0; i < allIcons.length; i++){
        let ic = allIcons[i];
        iconPane.button(new TextureRegionDrawable(ic.icon), Styles.clearNonei, 32, () => {
            callback(ic);
            d.hide();
        }).size(40);
        if(++colsCount % 10 === 0) iconPane.row();
    }
    
    d.cont.add(new ScrollPane(iconPane)).size(520, 300).padTop(10).row();
    d.show();
}

interceptor.add("quickchat", () => {
    if (!dialog) buildUI();
    else showMainMenu();
    dialog.show();
});
