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

function cleanCodeString(code) {
    return String(code || "")
        .replace(/\r\n|\r/g, "\n")
        .replace(/\t|[\u200B-\u200D\uFEFF\u00A0]/g, " ");
}

function parseJump(line) {
    let trimmed = line.trim();
    if (trimmed.startsWith("jump ")) {
        let parts = trimmed.split(" ").filter(p => p !== "");
        if (parts.length >= 2 && /^\d+$/.test(parts[1])) {
            return {
                target: parseInt(parts[1], 10),
                parts: parts,
                indent: line.match(/^\s*/)[0]
            };
        }
    }
    return null;
}

function normalizeLine(line) {
    return line.trim().split(" ").filter(p => p !== "").join(" ");
}

function convertJumpsToLabels(code, prefix) {
    if (prefix === undefined) prefix = "label";
    let lines = cleanCodeString(code).split("\n");
    let targets = {};
    let maxTarget = -1;

    for (let i = 0; i < lines.length; i++) {
        let jump = parseJump(lines[i]);
        if (jump) {
            targets[jump.target] = prefix + jump.target;
            maxTarget = Math.max(maxTarget, jump.target);
        }
    }

    let newLines = [];
    let origToNewMap = [];

    for (let i = 0; i < lines.length; i++) {
        if (targets[i]) newLines.push(targets[i] + ":");
        origToNewMap[i] = newLines.length;

        let line = lines[i];
        let jump = parseJump(line);
        if (jump && targets[jump.target]) {
            jump.parts[1] = targets[jump.target];
            line = jump.indent + jump.parts.join(" ");
        }
        newLines.push(line);
    }

    for (let i = lines.length; i <= maxTarget; i++) {
        if (targets[i]) newLines.push(targets[i] + ":");
    }

    return { code: newLines.join("\n"), map: origToNewMap };
}

function convertRangeJumpsToLabels(code, start, end, prefix) {
    if (prefix === undefined) prefix = "label";
    let lines = cleanCodeString(code).split("\n");
    start = Math.max(0, parseInt(start, 10) || 0);
    end = Math.min(lines.length - 1, parseInt(end, 10) || lines.length - 1);
    if (start > end) return "";

    let slice = lines.slice(start, end + 1);
    let targets = {};
    let maxTarget = -1;

    for (let i = 0; i < slice.length; i++) {
        let jump = parseJump(slice[i]);
        if (jump && jump.target >= start && jump.target <= end) {
            let relTarget = jump.target - start;
            targets[relTarget] = prefix + jump.target;
            maxTarget = Math.max(maxTarget, relTarget);
        }
    }

    let newLines = [];
    for (let i = 0; i < slice.length; i++) {
        if (targets[i]) newLines.push(targets[i] + ":");

        let line = slice[i];
        let jump = parseJump(line);
        if (jump) {
            if (jump.target >= start && jump.target <= end) {
                jump.parts[1] = targets[jump.target - start];
            } else {
                jump.parts[1] = "-1";
            }
            line = jump.indent + jump.parts.join(" ");
        }
        newLines.push(line);
    }

    for (let i = slice.length; i <= maxTarget; i++) {
        if (targets[i]) newLines.push(targets[i] + ":");
    }

    return newLines.join("\n");
}

function performReplace(logicDialog, findText, replaceText) {
    if (!findText || findText.trim() === "") return;
    try {
        let lines = cleanCodeString(logicDialog.canvas.save()).split("\n");
        let findLines = cleanCodeString(findText).split("\n");
        let repLines = cleanCodeString(replaceText).split("\n");
        
        let prefix = "rep" + Math.floor(Math.random() * 10000) + "_";
        let targets = {};
        let maxTarget = -1;

        let findNormalizedLines = findLines.map(normalizeLine).filter(l => l !== "");
        if (findNormalizedLines.length === 0) return;

        lines.forEach(line => {
            let jump = parseJump(line);
            if (jump) {
                targets[jump.target] = prefix + jump.target;
                maxTarget = Math.max(maxTarget, jump.target);
            }
        });

        repLines.forEach(line => {
            let jump = parseJump(line);
            if (jump) {
                targets[jump.target] = prefix + jump.target;
                maxTarget = Math.max(maxTarget, jump.target);
            }
        });

        let newLines = [];
        let replacedCount = 0;
        let skipLines = 0;

        for (let i = 0; i <= Math.max(lines.length - 1, maxTarget); i++) {
            if (targets[i]) newLines.push(targets[i] + ":");
            
            if (i < lines.length) {
                if (skipLines > 0) {
                    skipLines--;
                    continue;
                }
                
                let isMatch = false;
                if (i + findNormalizedLines.length <= lines.length) {
                    isMatch = true;
                    for (let j = 0; j < findNormalizedLines.length; j++) {
                        if (normalizeLine(lines[i + j]) !== findNormalizedLines[j]) {
                            isMatch = false;
                            break;
                        }
                    }
                }
                
                if (isMatch) {
                    replacedCount++;
                    skipLines = findNormalizedLines.length - 1;
                    
                    for (let j = 0; j < repLines.length; j++) {
                        let rLine = repLines[j];
                        let rJump = parseJump(rLine);
                        if (rJump) {
                            rJump.parts[1] = targets[rJump.target];
                            newLines.push(rJump.parts.join(" "));
                        } else if (rLine.trim() !== "") {
                            newLines.push(rLine.trim());
                        }
                    }
                } else {
                    let currentLine = lines[i];
                    let jump = parseJump(currentLine);
                    if (jump) {
                        jump.parts[1] = targets[jump.target];
                        newLines.push(jump.indent + jump.parts.join(" "));
                    } else {
                        newLines.push(currentLine);
                    }
                }
            }
        }

        if (replacedCount > 0) {
            logicDialog.canvas.load(newLines.join("\n"));
            Vars.ui.showInfoFade("Replaced " + replacedCount + " occurrences!");
        } else {
            Vars.ui.showInfoFade("No matches found.");
        }
    } catch (err) {
        notify("[scarlet]Replace Error: " + err);
    }
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
    
    if (scrollPane) scrollPane.setScrollingDisabled(true, false);
    
    table.button("Copy with Labels", Icon.copy, style, () => {
        dialog.hide();
        let converted = convertJumpsToLabels(logicDialog.canvas.save(), "label");
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
                    let rangeCode = convertRangeJumpsToLabels(logicDialog.canvas.save(), start, end, "lbl_");
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
        getMlogFiles().forEach(file => {
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
        });
        
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
                    performInsert(logicDialog, insertAfter, Core.app.getClipboardText());
                }).size(280, 60).row();
                
                t.button("From QoL File", Icon.folder, Styles.flatt, () => {
                    d.hide();
                    let fd = new BaseDialog("Select File");
                    fd.addCloseButton();
                    let ft = new Table();
                    getMlogFiles().forEach(file => {
                        ft.button(file.nameWithoutExtension(), () => {
                            fd.hide();
                            performInsert(logicDialog, insertAfter, file.readString());
                        }).size(300, 50).row();
                    });
                    fd.cont.add(new ScrollPane(ft)).width(400).height(400);
                    fd.show();
                }).size(280, 60).row();
                
                d.cont.add(t);
                d.show();
            });
        });
    }).size(280, 60).left().marginLeft(12).row();
    
    table.button("Replace Code", Icon.edit, style, () => {
        dialog.hide();
        let d = new BaseDialog("Replace Code");
        d.addCloseButton();
        
        let t = new Table();
        t.add("Find exact code:").left().row();
        let findArea = new Packages.arc.scene.ui.TextArea("");
        t.add(findArea).width(600).height(120).row();
        
        t.add("Replace with:").left().padTop(10).row();
        let repArea = new Packages.arc.scene.ui.TextArea("");
        t.add(repArea).width(600).height(120).row();
        
        t.button("Replace", () => {
            performReplace(logicDialog, findArea.getText(), repArea.getText());
            d.hide();
        }).size(280, 60).padTop(15).row();
        
        d.cont.add(new ScrollPane(t)).width(450).height(400);
        d.show();
    }).size(280, 60).left().marginLeft(12).row();
    
    dialog.pack();
    dialog.setPosition(
        Math.round((Core.graphics.getWidth() - dialog.getWidth()) / 2),
        Math.round((Core.graphics.getHeight() - dialog.getHeight()) / 2)
    );
}

Events.on(ClientLoadEvent, () => initFiles());

let configTableField = null;

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

    let configFragment = Vars.control.input.config;
    if (configFragment && configFragment.isShown()) {
        let build = configFragment.getSelected();
        if (build != null && build.block instanceof Packages.mindustry.world.blocks.logic.LogicBlock) {
            try {
                if (!configTableField) {
                    let clazz = configFragment.getClass();
                    while (clazz != null) {
                        try {
                            configTableField = clazz.getDeclaredField("table");
                            configTableField.setAccessible(true);
                            break;
                        } catch (err) {
                            clazz = clazz.getSuperclass();
                        }
                    }
                }
                if (configTableField) {
                    let table = configTableField.get(configFragment);
                    if (table && table.getChildren().size > 0) {
                        let hasRestart = false;
                        for (let i = 0; i < table.getChildren().size; i++) {
                            let child = table.getChildren().get(i);
                            if (child.name === "restart_processor_btn") {
                                hasRestart = true;
                                break;
                            }
                        }
                        if (!hasRestart) {
                            let btn = new Packages.arc.scene.ui.ImageButton(Icon.refresh, Styles.cleari);
                            btn.name = "restart_processor_btn";
                            btn.clicked(() => {
                                let target = configFragment.getSelected();
                                if (target != null && target.block instanceof Packages.mindustry.world.blocks.logic.LogicBlock) {
                                    target.configure(target.config());
                                    notify("[green]Processor restarted");
                                }
                            });
                            table.add(btn).size(40);
                            table.pack();
                        }
                    }
                }
            } catch (e) {
                // Ignore reflection errors
            }
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
