const notify = (text) => Vars.ui.chatfrag.addMessage(text);

Events.on(EventType.ClientChatEvent, e => {
    let args = String(e.message).trim().split(" ");
    if (args[0] !== "/attem") return;

    let jsonFile = null;
    let mods = Vars.mods.list();
    for(let i = 0; i < mods.size; i++){
        let f = mods.get(i).root.child("mlog").child("attem.json");
        if(f.exists()){
            jsonFile = f;
            break;
        }
    }

    if(!jsonFile){
        notify("[scarlet]File mlog/attem.json not found");
        return;
    }

    let rules = [];
    try {
        let parsed = JSON.parse(jsonFile.readString());
        rules = Array.isArray(parsed) ? parsed : [parsed];
    } catch(err) {
        notify("[scarlet]JSON parse error");
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
        notify("[scarlet]No valid rules found in JSON");
        return;
    }

    let replacedCount = 0;
    let LogicBlock = Packages.mindustry.world.blocks.logic.LogicBlock;
    let team = Vars.player.team();

    Groups.build.each(cons(b => {
        if(b.team == team && b.block instanceof LogicBlock){
            let currentCode = b.code != null ? String(b.code) : "";
            if(currentCode !== ""){
                for(let i = 0; i < compiledRules.length; i++){
                    if(compiledRules[i].rx.matcher(currentCode).find()){
                        try {
                            let compressed = LogicBlock.compress(compiledRules[i].input, b.links);
                            b.configure(compressed);
                            replacedCount++;
                        } catch(err) {}
                        break;
                    }
                }
            }
        }
    }));

    if(replacedCount > 0){
        notify("[green]Replaced " + replacedCount + " processors");
    } else {
        notify("[lightgray]No matching processors found");
    }
});
