const notify = (text) => Vars.ui.chatfrag.addMessage(text);

let pendingMlog = null;
let wasShooting = false;

function injectCode(target, code) {
    try {
        let LogicBlock = Packages.mindustry.world.blocks.logic.LogicBlock;
        let compressed = LogicBlock.compress(code, target.links);
        target.configure(compressed);
        notify("[green]Injected at: " + target.tileX() + ", " + target.tileY());
    } catch(err) {
        notify("[scarlet]Injection error: " + err);
    }
}

Events.on(EventType.ClientChatEvent, e => {
    let args = String(e.message).trim().split(" ");
    if (args[0] !== "/mlog") return;

    if (args.length < 2) {
        notify("[lightgray]/mlog list\n/mlog <filename>\n/mlog <filename> set");
        return;
    }

    let filename = args[1];

    if (filename.toLowerCase() === "list") {
        let foundFiles = [];
        let mods = Vars.mods.list();
        
        for(let i = 0; i < mods.size; i++){
            let mlogDir = mods.get(i).root.child("mlog");
            if(mlogDir.exists() && mlogDir.isDirectory()){
                let files = mlogDir.list();
                for(let j = 0; j < files.length; j++){
                    let f = files[j];
                    if(f.name().endsWith(".txt")){
                        foundFiles.push(f.nameWithoutExtension());
                    }
                }
            }
        }
        
        if(foundFiles.length > 0){
            notify("[green]Available files:\n[lightgray]- " + foundFiles.join("\n- "));
        } else {
            notify("[orange]No .txt files found in mlog/ folders");
        }
        return;
    }

    let mode = args[2] ? args[2].toLowerCase() : "";

    let mlogFile = null;
    let mods = Vars.mods.list();
    for(let i = 0; i < mods.size; i++){
        let m = mods.get(i);
        let f = m.root.child("mlog").child(filename + ".txt");
        if(f.exists()){
            mlogFile = f;
            break;
        }
    }

    if(mlogFile == null){
        notify("[scarlet]File not found: [lightgray]mlog/" + filename + ".txt");
        return;
    }

    let code = mlogFile.readString();

    if (mode === "set") {
        pendingMlog = code;
        wasShooting = false;
        notify("[lightgrey]Start and stop shooting at the target processor.");
    } else {
        let target = null;
        
        Groups.build.each(cons(b => {
            if(target == null && b.team == Vars.player.team()){
                let bName = b.block.name;
                if(bName == "micro-processor" || bName == "logic-processor" || bName == "hyper-processor"){
                    if(b.code == null || String(b.code) == ""){
                        target = b;
                    }
                }
            }
        }));
        
        if(target != null){
            injectCode(target, code);
        } else {
            notify("[scarlet]No empty processors found on your team");
        }
    }
});

Events.run(Trigger.update, () => {
    if(pendingMlog != null){
        let p = Vars.player;
        if(p == null || p.unit() == null) return;

        let isShooting = p.shooting;

        if(isShooting){
            wasShooting = true;
        } else if(!isShooting && wasShooting){
            let wx = p.mouseX;
            let wy = p.mouseY;
            let build = Vars.world.buildWorld(wx, wy);

            if(build != null){
                if(build.team != p.team()){
                    notify("[scarlet]Target belongs to another team");
                } else {
                    let bName = build.block.name;
                    if(bName == "micro-processor" || bName == "logic-processor" || bName == "hyper-processor"){
                        injectCode(build, pendingMlog);
                    } else {
                        notify("[scarlet]Target is not a processor");
                    }
                }
            } else {
                notify("[scarlet]Invalid target");
            }

            pendingMlog = null;
            wasShooting = false;
        }
    }
});
