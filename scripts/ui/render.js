const notify = require("qol-control/core/logger").notify;
const interceptor = require("qol-control/core/interceptor");

let renderBullets = true;
let renderUnits = true;
let renderBlocks = true;
let renderLayers = true;
let enablePhysics = true;

const origBulletSizes = [];
const origUnitSizes = [];
const origBlockSizes =[];
const origBlockRegions = [];
const origBlockDrawers =[];

function restoreOriginals() {
    let clearReg = Core.atlas.find("clear");
    let idx = 0;
    
    Vars.content.bullets().each(cons(b => {
        if (origBulletSizes[idx] !== undefined && b.drawSize === -10000) {
            b.drawSize = origBulletSizes[idx];
        }
        idx++;
    }));
    
    Vars.content.units().each(cons(u => {
        let id = u.id;
        if (origUnitSizes[id] !== undefined && u.clipSize === -10000) {
            u.clipSize = origUnitSizes[id];
        }
    }));
    
    Vars.content.blocks().each(cons(b => {
        let id = b.id;
        if (origBlockRegions[id] !== undefined && b.clipSize === -10000) {
            let orig = origBlockRegions[id];
            if (b.region === clearReg) b.region = orig.region;
            if (b.baseRegion === clearReg) b.baseRegion = orig.baseRegion;
            if (b.bottomRegion === clearReg) b.bottomRegion = orig.bottomRegion;
            if (b.teamRegion === clearReg) b.teamRegion = orig.teamRegion;
            if (b.topRegion === clearReg) b.topRegion = orig.topRegion;
            b.clipSize = origBlockSizes[id];
        }

        try {
            if (origBlockDrawers[id] !== undefined && b.drawer) {
                b.drawer = origBlockDrawers[id];
            }
        } catch (e) {
        }
    }));
}

Events.on(ClientLoadEvent, () => {
    restoreOriginals();
});

interceptor.add("render", (args) => {
    if (args.length < 2) {
        notify("[lightgray]!render <bullet|unit|block|layer|phys> <1/0?>");
        return;
    }

    let subcmd = args[1].toLowerCase();

    if (subcmd === "bullet") {
        renderBullets = interceptor.parseToggle(renderBullets, args[2]);
        
        let idx = 0;
        Vars.content.bullets().each(cons(b => {
            if (origBulletSizes[idx] === undefined) {
                origBulletSizes[idx] = b.drawSize;
            }
            b.drawSize = renderBullets ? origBulletSizes[idx] : -10000;
            idx++;
        }));
        notify("[lightgray]Bullets " + (renderBullets ? "[green]ON" : "[scarlet]OFF"));
    } 
    else if (subcmd === "unit") {
        renderUnits = interceptor.parseToggle(renderUnits, args[2]);
        Vars.content.units().each(cons(u => {
            let id = u.id;
            if (origUnitSizes[id] === undefined) {
                origUnitSizes[id] = u.clipSize;
            }
            u.clipSize = renderUnits ? origUnitSizes[id] : -10000;
        }));
        notify("[lightgray]Units " + (renderUnits ? "[green]ON" : "[scarlet]OFF"));
    } 
    else if (subcmd === "block") {
        renderBlocks = interceptor.parseToggle(renderBlocks, args[2]);
        let clearReg = Core.atlas.find("clear");
        Vars.content.blocks().each(cons(b => {
            let id = b.id;
            if (origBlockRegions[id] === undefined) {
                origBlockRegions[id] = {
                    region: b.region,
                    baseRegion: b.baseRegion,
                    bottomRegion: b.bottomRegion,
                    teamRegion: b.teamRegion,
                    topRegion: b.topRegion
                };
                origBlockSizes[id] = b.clipSize;
            }
            let orig = origBlockRegions[id];
            if (b.region != null) b.region = renderBlocks ? orig.region : clearReg;
            if (b.baseRegion != null) b.baseRegion = renderBlocks ? orig.baseRegion : clearReg;
            if (b.bottomRegion != null) b.bottomRegion = renderBlocks ? orig.bottomRegion : clearReg;
            if (b.teamRegion != null) b.teamRegion = renderBlocks ? orig.teamRegion : clearReg;
            if (b.topRegion != null) b.topRegion = renderBlocks ? orig.topRegion : clearReg;
            b.clipSize = renderBlocks ? origBlockSizes[id] : -10000;
        }));
        notify("[lightgray]Blocks " + (renderBlocks ? "[green]ON" : "[scarlet]OFF"));
    } 
    else if (subcmd === "layer") {
        renderLayers = interceptor.parseToggle(renderLayers, args[2]);
        
        let DrawDefault = Packages.mindustry.world.draw.DrawDefault;
        let simpleDrawer = new DrawDefault();

        Vars.content.blocks().each(cons(b => {
            let id = b.id;
            try {
                if (b.drawer !== undefined && b.drawer !== null) {
                    if (origBlockDrawers[id] === undefined) {
                        origBlockDrawers[id] = b.drawer;
                    }
                    
                    b.drawer = renderLayers ? origBlockDrawers[id] : simpleDrawer;
                }
            } catch (e) {
            }
        }));
        notify("[lightgray]Block Layers " + (renderLayers ? "[green]ON" : "[scarlet]OFF"));
    } else {
        notify("[lightgray]!render <bullet|unit|block|layer> <1/0?>");
    }
});
