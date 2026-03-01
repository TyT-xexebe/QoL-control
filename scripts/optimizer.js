Events.on(ClientLoadEvent, cons(e => {
    const s = Core.settings;
    const none = Fx.none;
    const clearReg = Core.atlas.find("clear");
    
    const safeSet = (obj, prop, value) => {
        try {
            obj[prop] = value;
        } catch (err) {}
    };

    const boolKeys = [
        "bloom", "shadows", "weather", "animatedwater", "ambientlight", "lasers", "smoothlighting"
    ];
    for(let i = 0; i < boolKeys.length; i++){
        s.put(boolKeys[i], false);
    }
    
    const zeroInt = new java.lang.Integer(0);
    s.put("screenshake", zeroInt);
    s.put("corpses", zeroInt); 
    
    Vars.content.blocks().each(cons(b => {
        b.emitLight = false;
        b.lightRadius = 0;
        
        const blockFx = [
            "destroyEffect", "breakEffect", "placeEffect", "updateEffect",
            "craftEffect", "consumeEffect", "smokeEffect", "shootEffect",
            "ammoUseEffect", "chargeEffect", "drillEffect", "generateEffect"
        ];
        for(let i = 0; i < blockFx.length; i++){
            safeSet(b, blockFx[i], none);
        }

        let isVeg = false;
        try {
            if (
                b instanceof Packages.mindustry.world.blocks.environment.TallBlock ||
                b instanceof Packages.mindustry.world.blocks.environment.TreeBlock ||
                b instanceof Packages.mindustry.world.blocks.environment.Seaweed
            ) {
                isVeg = true;
            } else {
                let cName = b.getClass().getSimpleName();
                if (cName == "TreeBlock" || cName == "Seaweed" || cName == "Bush" || cName == "TallBlock") {
                    isVeg = true;
                }
            }
        } catch(err) {}

        if (isVeg) {
            b.region = clearReg;  
            try {
                if (b.variantRegions != null) {
                    for (let j = 0; j < b.variantRegions.length; j++) {
                        b.variantRegions[j] = clearReg;
                    }
                }
            } catch(err) {}
            
            try {
                if (b.regions != null) {
                    for (let j = 0; j < b.regions.length; j++) {
                        b.regions[j] = clearReg;
                    }
                }
            } catch(err) {}
        } else {
            b.hasShadow = false;
            safeSet(b, "shadowAlpha", 0);
            safeSet(b, "shadowOffset", 0);
            safeSet(b, "customShadowRegion", clearReg);
        }
    }));
        
    Vars.content.bullets().each(cons(b => {
        b.lightRadius = 0;
        b.lightOpacity = 0;
        b.trailLength = 0;
        
        const bulletFx = [
            "hitEffect", "despawnEffect", "shootEffect", "smokeEffect"
        ];
        for(let i = 0; i < bulletFx.length; i++){
            safeSet(b, bulletFx[i], none);
        }
    }));
    
    Vars.content.units().each(cons(u => {
        u.lightRadius = 0;
        u.lightOpacity = 0;
        
        safeSet(u, "createWreck", false);
        safeSet(u, "createScorch", false);
        
        safeSet(u, "fallEffect", none);
        safeSet(u, "deathEffect", none);
        safeSet(u, "deathExplosionEffect", none);
        
        if(u.weapons != null){
            for(let i = 0; i < u.weapons.size; i++){
                let w = u.weapons.get(i);
                safeSet(w, "shootEffect", none);
                safeSet(w, "smokeEffect", none);
                safeSet(w, "ejectEffect", none);
            }
        }
    }));

    try {
        const fxClass = java.lang.Class.forName("mindustry.content.Fx");
        const fields = fxClass.getFields();
        
        for(let i = 0; i < fields.length; i++){
            let field = fields[i];
            
            if(field.getType().getSimpleName() == "Effect"){
                try {
                    let effect = field.get(null);
                    if(effect != null){
                        effect.lifetime *= 0.3; 
                    }
                } catch(err) {}
            }
        }
    } catch(err) {}
}));

Events.run(Trigger.update, () => {
    if (Vars.state.isGame() && Vars.state.rules) {
        Vars.state.rules.fog = false;
        Vars.state.rules.lighting = false;
    }
});

Events.on(EventType.TapEvent, cons(e => {
    let b = e.tile.build;
    if (b != null) {
        if (b.block == Blocks.worldProcessor || b.block == Blocks.worldMessage) {
            try {
                b.onConfigureTapped();
            } catch(err) {
                if (b.block == Blocks.worldProcessor) {
                    let code = b.code != null ? String(b.code) : "";
                    Vars.ui.logic.show(code, b.executor, true, cons(c => {}));
                } else if (b.block == Blocks.worldMessage) {
                    let msg = b.config() != null ? String(b.config()) : "";
                    Vars.ui.text.show(msg, cons(res => {}));
                }
            }
        }
    }
}));
