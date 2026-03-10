let locked = false;
let lockX = 0;
let lockY = 0;
let isDragging = false;
let startX = 0;
let startY = 0;
let reset = false;

let btnX = Core.settings.getFloat("cam-lock-btn-x", 150);
let btnY = Core.settings.getFloat("cam-lock-btn-y", 150);

const buildUI = () => {
    let table = new Table();
    Vars.ui.hudGroup.addChild(table);
    table.setPosition(btnX, btnY);

    let btn = table.button(Icon.eye, Styles.clearNonei, () => {
        if(!isDragging){
            locked = !locked;
            if (locked && Vars.player.unit()) {
                lockX = Vars.player.unit().x;
                lockY = Vars.player.unit().y;
            }
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
            Core.settings.put("cam-lock-btn-x", new java.lang.Float(btnX));
            Core.settings.put("cam-lock-btn-y", new java.lang.Float(btnY));
            Timer.schedule(() => { isDragging = false; }, 0.1);
            return true;
        }
    }));

    table.update(() => {
        table.setPosition(btnX, btnY);
        let unit = Vars.player.unit();
        if (!unit || unit.dead) {
        	reset = true;
        	return;
        };
        
        if (reset) {
        	lockX = unit.x;
        	lockY = unit.y;	
        };
        
        if (locked) {
            unit.vel.set(0, 0);
            btn.color.set(Color.scarlet);
        } else {
            btn.color.set(Color.white);
        }
    });
};

Events.on(ClientLoadEvent, () => {
    buildUI();
});

Events.on(WorldLoadEvent, () => {
    locked = false;
});
