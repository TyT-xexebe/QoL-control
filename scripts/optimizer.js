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
        "bloom", "shadows", "effects", "weather", "animatedwater",
        "animatedshields", "ambientlight", "lasers"
    ];
    for(let i = 0; i < boolKeys.length; i++){
        s.put(boolKeys[i], false);
    }
    
    const zeroInt = new java.lang.Integer(0);
    s.put("screenshake", zeroInt);
    s.put("corpses", zeroInt); 
    
    Vars.content.blocks().each(cons(b => {
        b.hasShadow = false;
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
            if (typeof b.isEnvironment === "function") {
                if (b.isEnvironment() && !b.isFloor() && !b.isOverlay() && !b.solid) {
                    isVeg = true;
                }
            } else {
                let cName = b.getClass().getSimpleName();
                if (cName == "TreeBlock" || cName == "Seaweed" || cName == "Bush" || cName == "Prop") {
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
