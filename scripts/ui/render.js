const notify = require("qol-control/core/logger").notify;
const interceptor = require("qol-control/core/interceptor");

let renderBullets = true;
let renderUnits = true;
let renderBlocks = true;

const origBulletSizes = [];
const origUnitSizes = [];
const origBlockSizes = [];
const origBlockRegions = [];

interceptor.add("render", (args) => {
    if (args.length < 2) {
        notify("[lightgray]!render <bullet|unit|block>");
        return;
    }

    let subcmd = args[1].toLowerCase();
    let clearReg = Core.atlas.find("clear");

    if (subcmd === "bullet") {
        renderBullets = !renderBullets;
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
        renderUnits = !renderUnits;
        
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
        renderBlocks = !renderBlocks;
        
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
    else {
        notify("[lightgray]!render <bullet|unit|block>");
    }
});
