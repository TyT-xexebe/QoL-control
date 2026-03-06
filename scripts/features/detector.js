const notify = require("qol-control/core/logger").notify;

let lastReplacedCoords = [];
const DELAY_FRAMES = 3; 

Events.on(WorldLoadEvent, cons(e => {
    lastReplacedCoords = [];
}));

const interceptor = require("qol-control/core/interceptor");

const detectorHandler = (args) => {
    if (args.length < 2) {
        notify("[lightgray]!detector <name>\n!detector log\n\n!dt <name>\n!dt log");
        return;
    }

    let subcmd = args[1].toLowerCase();

    if (subcmd === "log") {
        if (lastReplacedCoords.length === 0) {
            notify("[lightgray]History empty");
        } else {
            let coordsStr = lastReplacedCoords.map(c => c.x + " " + c.y).join("[accent] | [lightgrey]");
            notify("[lightgray]Last used:\n" + coordsStr);
        }
        return;
    }

    let jsonFile = null;
    let mods = Vars.mods.list();
    for(let i = 0; i < mods.size; i++){
        let f = mods.get(i).root.child("mlog").child("regex.json");
        if(f.exists()){
            jsonFile = f;
            break;
        }
    }

    if(!jsonFile){
        notify("[scarlet]File mlog/regex.json not found");
        return;
    }

    let parsed;
    try {
        parsed = JSON.parse(jsonFile.readString());
    } catch(err) {
        notify("[scarlet]JSON parse error");
        return;
    }

    let rules = parsed[subcmd];
    if (!rules || !Array.isArray(rules)) {
        notify("[scarlet]Regex '" + subcmd + "' not found in JSON");
        return;
    }

    let compiledRules = [];
    for(let i = 0; i < rules.length; i++){
        if(rules[i].regex && rules[i].input){
            try {
                compiledRules.push({
                    rx: java.util.regex.Pattern.compile(rules[i].regex),
                    input: rules[i].input
                });
            } catch(err) {}
        }
    }

    if(compiledRules.length === 0){
        notify("[scarlet]No valid rules for '" + subcmd + "'");
        return;
    }

    let LogicBlock = Packages.mindustry.world.blocks.logic.LogicBlock;
    let team = Vars.player.team();
    let toReplace = [];

    Groups.build.each(cons(b => {
        if(b.team == team && b.block instanceof LogicBlock){
            let currentCode = b.code != null ? String(b.code) : "";
            if(currentCode !== ""){
                for(let i = 0; i < compiledRules.length; i++){
                    if(compiledRules[i].rx.matcher(currentCode).find()){
                        toReplace.push({
                            build: b,
                            input: compiledRules[i].input
                        });
                        break;
                    }
                }
            }
        }
    }));

    if(toReplace.length === 0){
        notify("[lightgray]No matching processors found");
        return;
    }

    lastReplacedCoords = [];
    notify("[accent]Found " + toReplace.length + " processors...");

    for(let i = 0; i < toReplace.length; i++){
        let item = toReplace[i];
        
        Time.run(i * DELAY_FRAMES, () => {
            if(item.build.isValid()){
                try {
                    let compressed = LogicBlock.compress(item.input, item.build.links);
                    item.build.configure(compressed);
                    lastReplacedCoords.push({x: item.build.tileX(), y: item.build.tileY()});
                } catch(err) {}
            }          
        });
    }
};

interceptor.add("detector", detectorHandler);
interceptor.add("dt", detectorHandler);
