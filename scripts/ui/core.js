const notify = require("qol-control/core/logger").notify;
const interceptor = require("qol-control/core/interceptor");

let setup = false;
let panels = {};
let timer = 0;

const formatNum = n => {
    let num = Number(n);
    let abs = Math.abs(num);
    if(abs >= 1000000) return (Math.round(num / 100000) / 10) + "m";
    if(abs >= 1000) return (Math.round(num / 100) / 10) + "k";
    return Math.floor(num).toString();
};

function togglePanel(team) {
    if (panels[team.id]) {
        panels[team.id].table.remove();
        delete panels[team.id];
        notify("[lightgray]Core info [#" + team.color.toString() + "]" + team.name + " [scarlet]OFF");
    } else {
        createPanel(team);
        notify("[lightgray]Core info [#" + team.color.toString() + "]" + team.name + " [green]ON");
    }
}

function createPanel(team) {
    if (!Vars.ui || !Vars.ui.hudGroup) return;
    
    let table = new Table(Styles.black5);
    table.touchable = Packages.arc.scene.event.Touchable.enabled;
    
    let label = new Label("");
    label.setWrap(true);
    label.setAlignment(Packages.arc.util.Align.topLeft);
    label.setFontScale(0.9);
    table.add(label).width(180).pad(6);
    table.pack();
    
    Vars.ui.hudGroup.addChild(table);
    
    let sx = Core.settings.getFloat("coreinfo-x-" + team.id, 15);
    let sy = Core.settings.getFloat("coreinfo-y-" + team.id, 250 - (Object.keys(panels).length * 50));
    table.setPosition(sx, sy);

    let pData = {
        table: table,
        label: label,
        team: team,
        lastText: "",
        btnX: sx,
        btnY: sy,
        isDragging: false,
        startX: 0, startY: 0, offsetX: 0, offsetY: 0
    };

    table.addListener(extend(InputListener, {
        touchDown(event, x, y, pointer, button) {
            pData.isDragging = false;
            pData.startX = x;
            pData.startY = y;
            pData.offsetX = x;
            pData.offsetY = y;
            return true;
        },
        touchDragged(event, x, y, pointer) {
            if(!pData.isDragging && (Math.abs(x - pData.startX) > 5 || Math.abs(y - pData.startY) > 5)){
                pData.isDragging = true;
            }
            if(pData.isDragging){
                pData.btnX = Mathf.clamp(event.stageX - pData.offsetX, 0, Core.scene.getWidth() - table.getWidth());
                pData.btnY = Mathf.clamp(event.stageY - pData.offsetY, 0, Core.scene.getHeight() - table.getHeight());
                table.setPosition(pData.btnX, pData.btnY);
            }
            return true;
        },
        touchUp(event, x, y, pointer) {
            Core.settings.put("coreinfo-x-" + team.id, new java.lang.Float(pData.btnX));
            Core.settings.put("coreinfo-y-" + team.id, new java.lang.Float(pData.btnY));
            Timer.schedule(() => { pData.isDragging = false; }, 0.1);
            return true;
        }
    }));

    panels[team.id] = pData;
}

const initUI = () => {
    if(setup || !Vars.ui || !Vars.ui.hudGroup) return;
    setup = true;
    createPanel(Vars.player.team());
};

if(Vars.ui && Vars.ui.hudGroup) initUI();
else Events.on(ClientLoadEvent, initUI);

Events.on(WorldLoadEvent, () => {
    for (let id in panels) {
        panels[id].table.remove();
    }
    panels = {};
    setup = false;
    initUI();
});

interceptor.add("core", (args) => {
    if (args[1]) {
        let search = args[1].toLowerCase();
        let found = null;
        Vars.state.teams.getActive().each(t => {
            if (t.team.name.toLowerCase().includes(search)) found = t.team;
        });
        if (!found) {
            let id = parseInt(search);
            if (!isNaN(id) && id >= 0 && id < 256) found = Team.get(id);
        }
        if (found) {
            togglePanel(found);
        } else {
            notify("[scarlet]Team [white]" + args[1] + " [scarlet]not found");
        }
    } else {
        togglePanel(Vars.player.team());
    }
});

Events.run(Trigger.update, () => {
    if(!setup) return;
    
    let isGame = Vars.state.isGame() && Vars.ui.hudfrag.shown;
    
    timer += Time.delta;
    let doUpdate = timer > 10;
    if (doUpdate) timer = 0;

    for (let id in panels) {
        let p = panels[id];
        
        if (!isGame) {
            p.table.visible = false;
            continue;
        }
        
        p.table.visible = true;
        p.btnX = Mathf.clamp(p.btnX, 0, Core.scene.getWidth() - p.table.getWidth());
        p.btnY = Mathf.clamp(p.btnY, 0, Core.scene.getHeight() - p.table.getHeight());
        p.table.setPosition(p.btnX, p.btnY);
        
        if (doUpdate) {
            let teamData = Vars.state.teams.get(p.team);
            let core = teamData ? teamData.core() : null;
            
            let text = "[#" + p.team.color.toString() + "]" + p.team.name + " Core[white]\n";
            
            if (core && core.items != null) {
                let itemStr = "";
                Vars.content.items().each(cons(item => {
                    let amt = core.items.get(item);
                    if(amt > 0) itemStr += item.emoji() + formatNum(amt) + " ";
                }));
                if(itemStr !== "") text += itemStr;
                else text += "[lightgray]Empty";
            } else {
                text += "[scarlet]No Core";
            }
            
            if (p.lastText !== text) {
                p.label.setText(text);
                p.lastText = text;
                p.table.pack();
            }
        }
    }
});
