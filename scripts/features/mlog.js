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

function convertJumpsToLabels(code, prefix) {
    if (!code) return { code: "", map: [] };
    if (!prefix) prefix = "label";
    let jsCode = String(code)
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .replace(/\t/g, " ")
        .replace(/[\u200B-\u200D\uFEFF\u00A0]/g, " ");
    let lines = jsCode.split("\n");
    let targets = {}; 
    
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].replace(/^\s+|\s+$/g, "");
        if (line.indexOf("jump ") === 0) {
            let parts = line.split(" ");
            let cleanParts = [];
            for(let j = 0; j < parts.length; j++) {
                if(parts[j] !== "") cleanParts.push(parts[j]);
            }
            
            if (cleanParts.length >= 2) {
                let target = cleanParts[1];
                if (/^\d+$/.test(target)) {
                    let targetLine = parseInt(target, 10);
                    targets[targetLine] = prefix + targetLine;
                }
            }
        }
    }

    let newLines = [];
    let origToNewMap = [];
    
    for (let i = 0; i < lines.length; i++) {
        if (targets[i]) {
            newLines.push(targets[i] + ":");
        }
        
        origToNewMap[i] = newLines.length;
        
        let line = lines[i];
        let trimmed = line.replace(/^\s+|\s+$/g, "");
        if (trimmed.indexOf("jump ") === 0) {
            let parts = trimmed.split(" ");
            let cleanParts = [];
            for(let j = 0; j < parts.length; j++) {
                if(parts[j] !== "") cleanParts.push(parts[j]);
            }
            
            if (cleanParts.length >= 2 && /^\d+$/.test(cleanParts[1])) {
                let targetLine = parseInt(cleanParts[1], 10);
                if (targets[targetLine]) {
                    cleanParts[1] = targets[targetLine];
                    let indentMatch = line.match(/^\s+/);
                    let indent = indentMatch ? indentMatch[0] : "";
                    line = indent + cleanParts.join(" ");
                }
            }
        }
        newLines.push(line);
    }
    
    let maxTarget = -1;
    for (let key in targets) {
        if (targets.hasOwnProperty(key)) {
            let num = parseInt(key, 10);
            if (num > maxTarget) maxTarget = num;
        }
    }
    
    for (let i = lines.length; i <= maxTarget; i++) {
        if (targets[i]) {
            newLines.push(targets[i] + ":");
        }
    }

    return { code: newLines.join("\n"), map: origToNewMap };
}

function convertRangeJumpsToLabels(code, start, end, prefix) {
    if (!code) return "";
    if (!prefix) prefix = "label";
    let jsCode = String(code)
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .replace(/\t/g, " ")
        .replace(/[\u200B-\u200D\uFEFF\u00A0]/g, " ");
    let lines = jsCode.split("\n");
    
    start = Math.max(0, parseInt(start, 10) || 0);
    end = Math.min(lines.length - 1, parseInt(end, 10) || lines.length - 1);
    if (start > end) return "";

    let slice = lines.slice(start, end + 1);
    let targets = {}; 
    
    for (let i = 0; i < slice.length; i++) {
        let line = slice[i].replace(/^\s+|\s+$/g, "");
        if (line.indexOf("jump ") === 0) {
            let parts = line.split(" ");
            let cleanParts = [];
            for(let j=0; j<parts.length; j++) if(parts[j]!=="") cleanParts.push(parts[j]);
            
            if (cleanParts.length >= 2) {
                let target = cleanParts[1];
                if (/^\d+$/.test(target)) {
                    let targetLine = parseInt(target, 10);
                    if (targetLine >= start && targetLine <= end) {
                        targets[targetLine - start] = prefix + targetLine;
                    }
                }
            }
        }
    }

    let newLines = [];
    for (let i = 0; i < slice.length; i++) {
        if (targets[i]) newLines.push(targets[i] + ":");
        
        let line = slice[i];
        let trimmed = line.replace(/^\s+|\s+$/g, "");
        if (trimmed.indexOf("jump ") === 0) {
            let parts = trimmed.split(" ");
            let cleanParts = [];
            for(let j=0; j<parts.length; j++) if(parts[j]!=="") cleanParts.push(parts[j]);
            
            if (cleanParts.length >= 2 && /^\d+$/.test(cleanParts[1])) {
                let targetLine = parseInt(cleanParts[1], 10);
                let indentMatch = line.match(/^\s+/);
                let indent = indentMatch ? indentMatch[0] : "";
                
                if (targetLine >= start && targetLine <= end) {
                    cleanParts[1] = targets[targetLine - start];
                } else {
                    cleanParts[1] = "-1";
                }
                line = indent + cleanParts.join(" ");
            }
        }
        newLines.push(line);
    }
    
    let maxTarget = -1;
    for (let key in targets) {
        if (targets.hasOwnProperty(key)) {
            let num = parseInt(key, 10);
            if (num > maxTarget) maxTarget = num;
        }
    }
    
    for (let i = slice.length; i <= maxTarget; i++) {
        if (targets[i]) newLines.push(targets[i] + ":");
    }

    return newLines.join("\n");
}

function performInsert(logicDialog, insertAfter, sourceCode) {
    try {
        let currentCode = logicDialog.canvas.save();
        
        let prefixOrig = "orig" + Math.floor(Math.random() * 10000) + "_";
        let prefixIns = "ins" + Math.floor(Math.random() * 10000) + "_";
        
        let currentLabeled = convertJumpsToLabels(currentCode, prefixOrig);
        let insertLabeled = convertJumpsToLabels(sourceCode, prefixIns);
        
        let lines = currentLabeled.code ? currentLabeled.code.split("\n") : [];
        let insertIndex = lines.length;
        
        if (insertAfter === -1) {
            insertIndex = 0;
        } else if (insertAfter >= 0 && currentLabeled.map[insertAfter] !== undefined) {
            insertIndex = currentLabeled.map[insertAfter] + 1;
        }
        
        let insertLines = insertLabeled.code ? insertLabeled.code.split("\n") : [];
        for (let i = 0; i < insertLines.length; i++) {
            lines.splice(insertIndex + i, 0, insertLines[i]);
        }
        
        logicDialog.canvas.load(lines.join("\n"));
        Vars.ui.showInfoFade("Code inserted!");
    } catch (err) {
        notify("[scarlet]Insert Error: " + err);
    }
}

function injectUIButtons(table, dialog, logicDialog, scrollPane) {
    let style = Styles.flatt;
    table.row();
    
    if (scrollPane) {
        scrollPane.setScrollingDisabled(true, false);
    }
    
    table.button("Copy with Labels", Icon.copy, style, () => {
        dialog.hide();
        let rawCode = logicDialog.canvas.save();
        let converted = convertJumpsToLabels(rawCode, "label");
        Core.app.setClipboardText(converted.code);
        Vars.ui.showInfoFade("Copied to clipboard!");
    }).size(280, 60).left().marginLeft(12).row(); 
    
    table.button("Save to QoL", Icon.save, style, () => {
        dialog.hide();
        Vars.ui.showTextInput("Save Snippet", "Enter name:", "", name => {
            if (!name) return;
            mlogDir.child(name + ".txt").writeString(logicDialog.canvas.save());
            Vars.ui.showInfoFade("Saved to " + name);
        });
    }).size(280, 60).left().marginLeft(12).row(); 
    
    table.button("Save Range to QoL", Icon.save, style, () => {
        dialog.hide();
        Vars.ui.showTextInput("Start Line", "Start line (0-indexed):", "", startStr => {
            let start = parseInt(startStr, 10);
            if (isNaN(start)) return;
            Vars.ui.showTextInput("End Line", "End line (0-indexed):", "", endStr => {
                let end = parseInt(endStr, 10);
                if (isNaN(end)) return;
                Vars.ui.showTextInput("Save Snippet", "Enter name:", "", name => {
                    if (!name) return;
                    let rawCode = logicDialog.canvas.save();
                    let rangeCode = convertRangeJumpsToLabels(rawCode, start, end, "lbl_");
                    mlogDir.child(name + ".txt").writeString(rangeCode);
                    Vars.ui.showInfoFade("Saved range to " + name);
                });
            });
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
                try {
                    logicDialog.canvas.load(file.readString());
                    d.hide();
                } catch(err) {
                    notify("[scarlet]Load Error: " + err);
                }
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
    
    table.button("Insert Code", Icon.add, style, () => {
        dialog.hide();
        Vars.ui.showConfirm("Warning", "Please save your current processor code before merging!\nUnexpected behaviors may occur.\nProceed?", () => {
            Vars.ui.showTextInput("Insert After", "Insert after line (0-indexed, -1 for start):", "", lineStr => {
                let insertAfter = parseInt(lineStr, 10);
                if (isNaN(insertAfter)) return;
                
                let d = new BaseDialog("Select Source");
                d.addCloseButton();
                let t = new Table();
                
                t.button("From Clipboard", Icon.paste, Styles.flatt, () => {
                    d.hide();
                    let sourceCode = Core.app.getClipboardText();
                    performInsert(logicDialog, insertAfter, sourceCode);
                }).size(280, 60).row();
                
                t.button("From QoL File", Icon.folder, Styles.flatt, () => {
                    d.hide();
                    let fd = new BaseDialog("Select File");
                    fd.addCloseButton();
                    let ft = new Table();
                    let files = getMlogFiles();
                    for (let i=0; i<files.length; i++) {
                        let file = files[i];
                        ft.button(file.nameWithoutExtension(), () => {
                            fd.hide();
                            performInsert(logicDialog, insertAfter, file.readString());
                        }).size(300, 50).row();
                    }
                    fd.cont.add(new ScrollPane(ft)).width(400).height(400);
                    fd.show();
                }).size(280, 60).row();
                
                d.cont.add(t);
                d.show();
            });
        });
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
                                        injectUIButtons(t, top, logicDialog, scroll);
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
