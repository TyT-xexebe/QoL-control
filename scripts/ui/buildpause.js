let isDragging = false;
let startX = 0;
let startY = 0;

let btnX = Core.settings.getFloat("pause-build-btn-x", 150);
let btnY = Core.settings.getFloat("pause-build-btn-y", 210);

const buildUI = () => {
    let table = new Table();
    Vars.ui.hudGroup.addChild(table);
    table.setPosition(btnX, btnY);

    let btn = table.button(Icon.pause, Styles.clearNonei, () => {
        if(!isDragging){
            Vars.control.input.isBuilding = !Vars.control.input.isBuilding;
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
            Core.settings.put("pause-build-btn-x", new java.lang.Float(btnX));
            Core.settings.put("pause-build-btn-y", new java.lang.Float(btnY));
            Timer.schedule(() => { isDragging = false; }, 0.1);
            return true;
        }
    }));

    table.update(() => {
        table.setPosition(btnX, btnY);
        
        if (!Vars.control.input.isBuilding) {
            btn.getStyle().imageUp = Icon.play;
            btn.color.set(Color.scarlet);
        } else {
            btn.getStyle().imageUp = Icon.pause;
            btn.color.set(Color.white);
        }
    });
};

Events.on(ClientLoadEvent, () => {
    buildUI();
});
