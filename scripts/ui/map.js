const notify = require("qol-control/core/logger").notify;
const interceptor = require("qol-control/core/interceptor");

let setup = false;
let mapTable, mapElem;
let mapEnabled = Core.settings.getBool("map-enabled", false);
let btnX = Core.settings.getFloat("map-x", 15);
let btnY = Core.settings.getFloat("map-y", 400);
let mapSize = Core.settings.getInt("map-size", 200);

const initUI = () => {
    if(setup || !Vars.ui || !Vars.ui.hudGroup) return;
    setup = true;
    
    mapTable = new Table(Styles.black5);
    mapTable.touchable = Packages.arc.scene.event.Touchable.enabled;
    
    mapElem = extend(Element, {
        draw() {
            let region = Vars.renderer.minimap.getRegion();
            if (!region || !this.clipBegin()) return;
            
            let tiles = Vars.world.tiles;
            let w = tiles.width * 8, h = tiles.height * 8;
            let min = Math.min(w, h), max = Math.max(w, h);
            
            Draw.color();
            region.set(0, 1 - w / min, h / min, 1);
            Draw.rect(region, this.x + this.width / 2, this.y + this.height / 2, this.width, this.height);
            
            let scl = Packages.arc.scene.ui.layout.Scl.scl();
            let scale = scl * 24; 
            
            Vars.state.teams.present.each(data => {
                Draw.color(data.team.color);
                data.units.each(u => {
                    if (!u.isPlayer() && u.type.drawMinimap) {
                        let icon = u.type.fullIcon;
                        Draw.rect(icon, this.x + u.x / max * this.width, this.y + u.y / max * this.height, scale, scale * icon.height / icon.width, u.rotation - 90);
                    }
                });
            });
            
            Draw.color();
            let eye = Icon.eye.getRegion();
            let eyeScl = scl * 0.625; 
            Groups.player.each(p => {
                if (p.unit() && p !== Vars.player) {
                    Draw.rect(eye, this.x + p.x / max * this.width, this.y + p.y / max * this.height, eye.width * eyeScl, eye.height * eyeScl);
                }
            });
            
            Lines.stroke(scl * 3);
            let cam = Core.camera;
            Lines.rect(this.x + (cam.position.x - cam.width / 2) / max * this.width, this.y + (cam.position.y - cam.height / 2) / max * this.height, cam.width / max * this.width, cam.height / max * this.height);
            
            Draw.reset();
            this.clipEnd();
        }
    });

    let isMoving = false, isPanning = false;
    let startX = 0, startY = 0, offsetX = 0, offsetY = 0;
    let pressTask = null;
    const KeyCode = Packages.arc.input.KeyCode;

    let pan = (x, y) => {
        let tiles = Vars.world.tiles;
        let max = Math.max(tiles.width, tiles.height) * 8;
        Core.camera.position.set(x / mapElem.getWidth() * max, y / mapElem.getHeight() * max);
    };

    mapElem.addListener(extend(InputListener, {
        touchDown(e, x, y, p, btn) {
            if (btn === KeyCode.mouseRight) {
                isPanning = true;
                pan(x, y);
                return true;
            }
            
            isMoving = isPanning = false;
            startX = x; startY = y;
            offsetX = e.stageX - mapTable.x;
            offsetY = e.stageY - mapTable.y;
            
            if(pressTask) pressTask.cancel();
            pressTask = Timer.schedule(() => {
                if(!isMoving){
                    isPanning = true;
                    pan(x, y);
                }
            }, 0.4);
            
            return true;
        },
        touchDragged(e, x, y, p) {
            if (isPanning) {
                pan(x, y);
                return true;
            }
            
            if(!isMoving && (Math.abs(x - startX) > 5 || Math.abs(y - startY) > 5)){
                isMoving = true;
                if(pressTask) pressTask.cancel();
            }
            
            if(isMoving){
                btnX = Mathf.clamp(e.stageX - offsetX, 0, Core.scene.getWidth() - mapTable.getWidth());
                btnY = Mathf.clamp(e.stageY - offsetY, 0, Core.scene.getHeight() - mapTable.getHeight());
                mapTable.setPosition(btnX, btnY);
            }
            return true;
        },
        touchUp(e, x, y, p, btn) {
            if(pressTask) pressTask.cancel();
            
            if (isPanning) {
                isPanning = false;
                return true;
            }
            
            if (!isMoving && btn === KeyCode.mouseLeft) {
                Vars.ui.minimapfrag.toggle();
            } else if (isMoving) {
                Core.settings.put("map-x", new java.lang.Float(btnX));
                Core.settings.put("map-y", new java.lang.Float(btnY));
                isMoving = false;
            }
            return true;
        }
    }));

    mapTable.add(mapElem).size(mapSize);
    mapTable.pack();
    Vars.ui.hudGroup.addChild(mapTable);
    mapTable.setPosition(btnX, btnY);
    mapTable.visible = false;
};

if(Vars.ui && Vars.ui.hudGroup) initUI();
else Events.on(ClientLoadEvent, initUI);

Events.on(WorldLoadEvent, () => {
    let t = Vars.world.tiles;
    Packages.arc.util.Reflect.set(Vars.renderer.minimap, "zoom", new java.lang.Float(Math.max(t.height, t.width) / 32));
});

interceptor.add("cmap", (args) => {
    let val = args[1];
    if (val && /^\d+$/.test(val) && val !== "0" && val !== "1") {
        mapSize = Math.max(50, Math.min(parseInt(val), 1000));
        Core.settings.put("map-size", new java.lang.Integer(mapSize));
        if (mapTable && mapElem) {
            mapTable.clearChildren();
            mapTable.add(mapElem).size(mapSize);
            mapTable.pack();
        }
        notify("[lightgray]Map size set to [accent]" + mapSize);
    } else {
        mapEnabled = interceptor.parseToggle(mapEnabled, val);
        Core.settings.put("map-enabled", new java.lang.Boolean(mapEnabled));
        notify("[lightgray]Minimap " + (mapEnabled ? "[green]ON" : "[scarlet]OFF"));
    }
});

Events.run(Trigger.update, () => {
    if(!setup || !mapTable) return;
    
    let frag = Vars.ui.minimapfrag;
    let mapOpen = frag && (typeof frag.shown === "function" ? frag.shown() : frag.shown);
    
    if(!Vars.state.isGame() || !Vars.ui.hudfrag.shown || !mapEnabled || mapOpen){
        mapTable.visible = false;
        return;
    }
    
    mapTable.visible = true;
    btnX = Mathf.clamp(btnX, 0, Core.scene.getWidth() - mapTable.getWidth());
    btnY = Mathf.clamp(btnY, 0, Core.scene.getHeight() - mapTable.getHeight());
    mapTable.setPosition(btnX, btnY);
});
