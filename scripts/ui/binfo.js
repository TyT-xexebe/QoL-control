let setup = false;
let infoTable;
let infoLabel;
let lastText = "";
let targetBuild = null;
let lastTapBuild = null;
let lastBuild = null;
let timer = 0;

let isDragging = false;
let startX = 0;
let startY = 0;
let offsetX = 0;
let offsetY = 0;
let btnX = Core.settings.getFloat("binfo-x", 15);
let btnY = Core.settings.getFloat("binfo-y", 180);

const formatNum = n => {
    let abs = Math.abs(n);
    if(abs >= 1000000) return (n / 1000000).toFixed(1).replace(".0", "") + "m";
    if(abs >= 1000) return (n / 1000).toFixed(1).replace(".0", "") + "k";
    return Math.floor(n).toString();
};

const initUI = () => {
    if(setup || !Vars.ui || !Vars.ui.hudGroup) return;
    setup = true;
    
    infoTable = new Table(Styles.black5);
    infoTable.touchable = Packages.arc.scene.event.Touchable.enabled;
    
    infoLabel = new Label("");
    infoLabel.setWrap(true);
    infoLabel.setAlignment(Packages.arc.util.Align.topLeft);
    infoLabel.setFontScale(0.9);
    infoTable.add(infoLabel).width(180).pad(6);
    
    infoTable.pack();
    
    Vars.ui.hudGroup.addChild(infoTable);
    infoTable.setPosition(btnX, btnY);

    infoTable.addListener(extend(InputListener, {
        touchDown(event, x, y, pointer, button) {
            isDragging = false;
            startX = x;
            startY = y;
            offsetX = x;
            offsetY = y;
            return true;
        },
        touchDragged(event, x, y, pointer) {
            if(!isDragging && (Math.abs(x - startX) > 5 || Math.abs(y - startY) > 5)){
                isDragging = true;
            }
            if(isDragging){
                btnX = Mathf.clamp(event.stageX - offsetX, 0, Core.scene.getWidth() - infoTable.getWidth());
                btnY = Mathf.clamp(event.stageY - offsetY, 0, Core.scene.getHeight() - infoTable.getHeight());
                infoTable.setPosition(btnX, btnY);
            }
            return true;
        },
        touchUp(event, x, y, pointer) {
            Core.settings.put("binfo-x", new java.lang.Float(btnX));
            Core.settings.put("binfo-y", new java.lang.Float(btnY));
            Timer.schedule(() => { isDragging = false; }, 0.1);
            return true;
        }
    }));
};

if(Vars.ui && Vars.ui.hudGroup) initUI();
else Events.on(ClientLoadEvent, initUI);

Events.run(Trigger.update, () => {
    if(!setup || !infoTable) return;
    
    if(!Vars.state.isGame() || !Vars.ui.hudfrag.shown){
        infoTable.visible = false;
        return;
    }
    
    if (Vars.mobile) {
        if (Core.input.isTouched() && !Core.scene.hasMouse() && !isDragging) {
            lastTapBuild = Vars.world.buildWorld(Core.input.mouseWorldX(), Core.input.mouseWorldY());
        }
        targetBuild = lastTapBuild;
    } else {
        targetBuild = Vars.world.buildWorld(Core.input.mouseWorldX(), Core.input.mouseWorldY());
    }

    if(targetBuild == null || !targetBuild.isValid()){
        infoTable.visible = false;
        return;
    }

    infoTable.visible = true;
    timer += Time.delta;
    
    btnX = Mathf.clamp(btnX, 0, Core.scene.getWidth() - infoTable.getWidth());
    btnY = Mathf.clamp(btnY, 0, Core.scene.getHeight() - infoTable.getHeight());
    infoTable.setPosition(btnX, btnY);
    
    if(timer > 10 || lastBuild !== targetBuild){
        timer = 0;
        lastBuild = targetBuild;
        
        let tName = targetBuild.team ? targetBuild.team.name : "unknown";
        let text = "[accent]" + targetBuild.block.localizedName + " [lightgray](" + tName + ")\n";
        text += "[#ff8888]HP: [white]" + formatNum(targetBuild.health) + " / " + formatNum(targetBuild.maxHealth) + "\n";
        
        if(targetBuild.items != null){
            let itemStr = "";
            Vars.content.items().each(cons(item => {
                let amt = targetBuild.items.get(item);
                if(amt > 0) itemStr += item.emoji() + formatNum(amt) + " ";
            }));
            if(itemStr !== "") text += itemStr + "\n";
        }
        
        if(targetBuild.liquids != null){
            let liqStr = "";
            Vars.content.liquids().each(cons(liq => {
                let amt = targetBuild.liquids.get(liq);
                if(amt > 0) liqStr += liq.emoji() + formatNum(amt) + " ";
            }));
            if(liqStr !== "") text += liqStr + "\n";
        }
        
        if(targetBuild.power != null){
            if(targetBuild.power.graph != null){
                let bal = targetBuild.power.graph.getPowerBalance() * 60;
                let sign = bal > 0 ? "+" : "";
                let color = bal > 0 ? "[green]" : (bal < 0 ? "[scarlet]" : "[white]");
                text += "[#ffaa55]Power: " + color + sign + formatNum(bal) + "\n";
                
                if(targetBuild.power.graph.getTotalBatteryCapacity() > 0){
                    text += "[#ffaa55]Bat: [white]" + formatNum(targetBuild.power.graph.getBatteryStored()) + " / " + formatNum(targetBuild.power.graph.getTotalBatteryCapacity()) + "\n";
                }
            } else {
                text += "[#ffaa55]Power: [white]0\n";
            }
        }
        
        text = text.trim();
        if(lastText !== text){
            infoLabel.setText(text);
            lastText = text;
            infoTable.pack();
        }
    }
});
