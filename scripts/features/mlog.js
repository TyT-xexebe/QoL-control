const notify = require("qol-control/core/logger").notify;
const interceptor = require("qol-control/core/interceptor");

const qolDir = Vars.dataDirectory.child("qol");
const mlogDir = qolDir.child("mlog");

let pendingMlog = null;
let wasShooting = false;

function getMlogFiles() {
    let result = [];
    if (mlogDir.exists() && mlogDir.isDirectory()) {
        let files = mlogDir.list();
        for (let i = 0; i < files.length; i++) {
            if (files[i].extension() === "txt") result.push(files[i]);
        }
    }
    return result;
}

function initFiles() {
    if (!qolDir.exists()) qolDir.mkdirs();
    if (!mlogDir.exists()) mlogDir.mkdirs();

    let modRoot = Vars.mods.getMod("qol-control");
    if (modRoot) {
        let defaultMlogDir = modRoot.root.child("mlog");
        if (defaultMlogDir.exists()) {
            let files = defaultMlogDir.list();
            for (let i = 0; i < files.length; i++) {
                let file = files[i];
                if (file.extension() === "txt" && !mlogDir.child(file.name()).exists()) {
                    file.copyTo(mlogDir.child(file.name()));
                }
            }
        }
    }
}

function injectCode(target, code) {
    try {
        let LogicBlock = Packages.mindustry.world.blocks.logic.LogicBlock;
        target.configure(LogicBlock.compress(code, target.links));
        notify("[green]Injected at [lightgrey]" + target.tileX() + " " + target.tileY());
    } catch(err) {
        notify("[scarlet]Injection error: " + err);
    }
}

function injectUIButtons(table, dialog, logicDialog) {
    let style = Styles.flatt;
    table.row();
    
    table.button("Save to QoL", Icon.save, style, () => {
        dialog.hide();
        Vars.ui.showTextInput("Save Snippet", "Enter name:", "", name => {
            if (!name) return;
            mlogDir.child(name + ".txt").writeString(logicDialog.canvas.save());
            Vars.ui.showInfoFade("Saved to " + name);
        });
    }).size(280, 60).left().marginLeft(12).row(); 
    
    table.button("Load from QoL", Icon.download, style, () => {
        dialog.hide();
        let d = new BaseDialog("Load Snippet");
        d.addCloseButton();
        
        let listTable = new Table();
        let files = getMlogFiles();
        
        for (let i = 0; i < files.length; i++) {
            let file = files[i];
            let rowTable = new Table();
            
            rowTable.button(file.nameWithoutExtension(), () => {
                logicDialog.canvas.load(file.readString());
                d.hide();
            }).size(300, 50);
            
            rowTable.button(Icon.trash, () => {
                Vars.ui.showConfirm("Delete", "Delete " + file.name() + "?", () => {
                    file.delete();
                    d.hide();
                });
            }).size(50, 50);
            
            listTable.add(rowTable).padBottom(5).row();
        }
        
        d.cont.add(new ScrollPane(listTable)).width(400).height(400);
        d.show();
    }).size(280, 60).left().marginLeft(12).row();
    
    dialog.pack();
    dialog.setPosition(
        Math.round((Core.graphics.getWidth() - dialog.getWidth()) / 2),
        Math.round((Core.graphics.getHeight() - dialog.getHeight()) / 2)
    );
}

Events.on(ClientLoadEvent, () => initFiles());

Events.run(Trigger.update, () => {
    let logicDialog = Vars.ui.logic;
    if (logicDialog && logicDialog.isShown()) {
        let editBtn = logicDialog.buttons.find("edit");
        
        if (editBtn != null && editBtn.name === "edit") {
            editBtn.name = "edit_hooked";
            editBtn.addListener(extend(ChangeListener, {
                changed(event, actor) {
                    Core.app.post(() => {
                        let top = Core.scene.root.getChildren().peek(); 
                        if (top instanceof BaseDialog) {
                            let scroll = top.cont.getChildren().first();
                            if (scroll instanceof ScrollPane) {
                                let p = scroll.getWidget();
                                if (p instanceof Table && p.getChildren().size > 0) {
                                    let t = p.getChildren().first();
                                    if (t instanceof Table) {
                                        injectUIButtons(t, top, logicDialog);
                                    }
                                }
                            }
                        }
                    });
                }
            }));
        }
    }

    if (pendingMlog != null) {
        let p = Vars.player;
        if (!p || !p.unit()) return;

        if (p.shooting) {
            wasShooting = true;
        } else if (wasShooting) {
            let build = Vars.world.buildWorld(p.mouseX, p.mouseY);

            if (build != null) {
                if (build.team != p.team()) {
                    notify("[scarlet]Target belongs to another team");
                } else {
                    let bName = build.block.name;
                    if (bName === "micro-processor" || bName === "logic-processor" || bName === "hyper-processor") {
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

interceptor.add("mlog", (args) => {
    if (args.length < 2) {
        notify("[lightgray]!mlog list\n!mlog <filename>\n!mlog <filename> set\n!mlog remove <filename>");
        return;
    }

    let subcmd = args[1].toLowerCase();

    if (subcmd === "list") {
        let files = getMlogFiles();
        if (files.length > 0) {
            notify("[lightgrey]Available files:\n- " + files.map(f => f.nameWithoutExtension()).join("\n- "));
        } else {
            notify("[scarlet]No .txt files found in qol/mlog/ folder");
        }
        return;
    }

    if (subcmd === "remove" && args.length >= 3) {
        let targetName = args[2];
        let f = mlogDir.child(targetName + ".txt");
        if (f.exists()) {
            f.delete();
            notify("[green]Deleted [lightgray]" + targetName + ".txt");
        } else {
            notify("[scarlet]File not found [lightgray]" + targetName + ".txt");
        }
        return;
    }

    let mode = args[2] ? args[2].toLowerCase() : "";
    let mlogFile = mlogDir.child(args[1] + ".txt");

    if (!mlogFile.exists()) {
        notify("[scarlet]File not found [lightgray]qol/mlog/" + args[1] + ".txt");
        return;
    }

    let code = mlogFile.readString();

    if (mode === "set") {
        pendingMlog = code;
        wasShooting = false;
        notify("[lightgrey]Start and stop shooting at the target processor");
    } else {
        let target = null;
        
        Groups.build.each(cons(b => {
            if (!target && b.team == Vars.player.team()) {
                let bName = b.block.name;
                if (bName === "micro-processor" || bName === "logic-processor" || bName === "hyper-processor") {
                    if (b.code == null || String(b.code) === "") {
                        target = b;
                    }
                }
            }
        }));
        
        if (target != null) {
            injectCode(target, code);
        } else {
            notify("[scarlet]No empty processors found on your team");
        }
    }
});
