Events.on(ClientLoadEvent, () => {
    Vars.content.units().each(u => { u.rotateSpeed = 1000; u.omniMovement = true; });

    const BuildVisibility = Packages.mindustry.world.meta.BuildVisibility;

    Vars.content.items().each(cons(i => {
        i.hidden = false;
        i.alwaysUnlocked = true;
    }));

    Vars.content.liquids().each(cons(l => {
        l.hidden = false;
        l.alwaysUnlocked = true;
    }));

    Vars.content.units().each(cons(u => {
        u.hidden = false;
        u.alwaysUnlocked = true;
    }));

    Vars.content.blocks().each(cons(b => {
        b.alwaysUnlocked = true;
        
        if (b.buildVisibility == BuildVisibility.hidden || b.buildVisibility == BuildVisibility.debugOnly) {
            b.buildVisibility = BuildVisibility.sandboxOnly;
        }
    }));
});
