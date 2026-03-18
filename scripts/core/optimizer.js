Events.on(ClientLoadEvent, cons(e => {
    const s = Core.settings;
    const none = Fx.none;
    const noneSound = Sounds.none;
    const clearReg = Core.atlas.find("clear");
    
    const safeSet = (obj, prop, value) => {
        try {
            obj[prop] = value;
        } catch (err) {}
    };

    const boolKeys =[
        "bloom", "shadows", "weather", "animatedwater", "ambientlight", 
        "lasers", "smoothlighting", "fluidparticles"
    ];
    for(let i = 0; i < boolKeys.length; i++){
        s.put(boolKeys[i], false);
    }
    
    const zeroInt = new java.lang.Integer(0);
    s.put("screenshake", zeroInt);
    s.put("corpses", zeroInt); 
    s.put("debris", zeroInt); 
    s.put("particles", zeroInt);
    
    Vars.content.blocks().each(cons(b => {
        b.emitLight = false;
        b.lightRadius = 0;
        
        safeSet(b, "ambientSound", noneSound);
        safeSet(b, "loopSound", noneSound);
        
        const blockFx =[
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
        safeSet(b, "trailEffect", none);
        
        const bulletFx =[
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

    Vars.content.liquids().each(cons(l => {
        l.lightColor = Packages.arc.graphics.Color.clear;
        safeSet(l, "effect", none);
        safeSet(l, "boilEffect", none);
        safeSet(l, "vaporEffect", none);
    }));

    Vars.content.statusEffects().each(cons(s => {
        safeSet(s, "effect", none);
        safeSet(s, "parentizeEffect", none);
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

Events.run(Trigger.preDraw, () => {
    if (Vars.state.isGame() && Vars.state.rules) {
        Vars.state.rules.fog = false;
        Vars.state.rules.staticFog = false;
        Vars.state.rules.lighting = false;
    }
    Vars.enableDarkness = false;
});

let h=0, b=null, o=false;
Events.run(Trigger.update, () => {
    let t = (Vars.state.isGame() && !Core.scene.hasMouse() && Core.input.isTouched()) ? Vars.world.tileWorld(Core.input.mouseWorldX(), Core.input.mouseWorldY()) : null;
    let c = t ? t.build : null;
    
    if(!c || c.block != Blocks.worldProcessor) return h=0, b=null, o=false;
    
    if(b == c){
        if((h += Time.delta) > 60 && !o){
            o = true;
            try{ c.onConfigureTapped(); }
            catch(e){ Vars.ui.logic.show(c.code ? String(c.code) : "", c.executor, true, cons(x=>{})); }
        }
    } else { b=c; h=0; o=false; }
});
