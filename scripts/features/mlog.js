const notify = require('qol-control/core/logger').notify;
const interceptor = require('qol-control/core/interceptor');

const qolDir = Vars.dataDirectory.child('qol');
const mlogDir = qolDir.child('mlog');

let pendingMlog = null;
let wasShooting = false;

function formatFloat(num) {
	if (num === null || num === undefined) return '0';
	let n = Number(num);
	if (!isFinite(n) || isNaN(n)) return String(num);
	let rounded = Math.round(n * 100) / 100;
	let str = String(rounded);
	if (str.indexOf('e') !== -1) return str;
	let idx = str.indexOf('.');
	if (idx === -1) {
		return str + '.00';
	}
	let dec = str.substring(idx + 1);
	if (dec.length === 1) {
		return str + '0';
	}
	if (dec.length > 2) {
		return str.substring(0, idx + 3);
	}
	return str;
}

function getMlogFiles() {
	let result = [];
	if (mlogDir.exists() && mlogDir.isDirectory()) {
		let files = mlogDir.list();
		for (let i = 0; i < files.length; i++) {
			if (files[i].extension() === 'txt') result.push(files[i]);
		}
	}
	return result;
}

function initFiles() {
	if (!qolDir.exists()) qolDir.mkdirs();
	if (!mlogDir.exists()) mlogDir.mkdirs();

	let modRoot = Vars.mods.getMod('qol-control');
	if (modRoot) {
		let defaultMlogDir = modRoot.root.child('mlog');
		if (defaultMlogDir.exists()) {
			let files = defaultMlogDir.list();
			for (let i = 0; i < files.length; i++) {
				let file = files[i];
				if (
					file.extension() === 'txt' &&
					!mlogDir.child(file.name()).exists()
				) {
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
		notify(
			'[green]Injected at [lightgrey]' +
				target.tileX() +
				' ' +
				target.tileY()
		);
	} catch (err) {
		notify('[scarlet]Injection error: ' + err);
	}
}

function cleanCodeString(code) {
	return String(code || '')
		.replace(/\r\n|\r/g, '\n')
		.replace(/\t|[\u200B-\u200D\uFEFF\u00A0]/g, ' ');
}

function parseJump(line) {
	let trimmed = line.trim();
	if (trimmed.startsWith('jump ')) {
		let parts = trimmed.split(' ').filter((p) => p !== '');
		if (parts.length >= 2 && /^\d+$/.test(parts[1])) {
			return {
				target: parseInt(parts[1], 10),
				parts: parts,
				indent: line.match(/^\s*/)[0],
			};
		}
	}
	return null;
}

function normalizeLine(line) {
	return line
		.trim()
		.split(' ')
		.filter((p) => p !== '')
		.join(' ');
}

function convertJumpsToLabels(code, prefix) {
	if (prefix === undefined) prefix = 'label';
	let lines = cleanCodeString(code).split('\n');
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
		if (targets[i]) newLines.push(targets[i] + ':');
		origToNewMap[i] = newLines.length;

		let line = lines[i];
		let jump = parseJump(line);
		if (jump && targets[jump.target]) {
			jump.parts[1] = targets[jump.target];
			line = jump.indent + jump.parts.join(' ');
		}
		newLines.push(line);
	}

	for (let i = lines.length; i <= maxTarget; i++) {
		if (targets[i]) newLines.push(targets[i] + ':');
	}

	return { code: newLines.join('\n'), map: origToNewMap };
}

function convertRangeJumpsToLabels(code, start, end, prefix) {
	if (prefix === undefined) prefix = 'label';
	let lines = cleanCodeString(code).split('\n');
	start = Math.max(0, parseInt(start, 10) || 0);
	end = Math.min(lines.length - 1, parseInt(end, 10) || lines.length - 1);
	if (start > end) return '';

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
		if (targets[i]) newLines.push(targets[i] + ':');

		let line = slice[i];
		let jump = parseJump(line);
		if (jump) {
			if (jump.target >= start && jump.target <= end) {
				jump.parts[1] = targets[jump.target - start];
			} else {
				jump.parts[1] = '-1';
			}
			line = jump.indent + jump.parts.join(' ');
		}
		newLines.push(line);
	}

	for (let i = slice.length; i <= maxTarget; i++) {
		if (targets[i]) newLines.push(targets[i] + ':');
	}

	return newLines.join('\n');
}

function performReplace(logicDialog, findText, replaceText) {
	if (!findText || findText.trim() === '') return;
	try {
		let lines = cleanCodeString(logicDialog.canvas.save()).split('\n');
		let findLines = cleanCodeString(findText).split('\n');
		let repLines = cleanCodeString(replaceText).split('\n');

		let prefix = 'rep' + Math.floor(Math.random() * 10000) + '_';
		let targets = {};
		let maxTarget = -1;

		let findNormalizedLines = findLines
			.map(normalizeLine)
			.filter((l) => l !== '');
		if (findNormalizedLines.length === 0) return;

		lines.forEach((line) => {
			let jump = parseJump(line);
			if (jump) {
				targets[jump.target] = prefix + jump.target;
				maxTarget = Math.max(maxTarget, jump.target);
			}
		});

		repLines.forEach((line) => {
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
			if (targets[i]) newLines.push(targets[i] + ':');

			if (i < lines.length) {
				if (skipLines > 0) {
					skipLines--;
					continue;
				}

				let isMatch = false;
				if (i + findNormalizedLines.length <= lines.length) {
					isMatch = true;
					for (let j = 0; j < findNormalizedLines.length; j++) {
						if (
							normalizeLine(lines[i + j]) !==
							findNormalizedLines[j]
						) {
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
							newLines.push(rJump.parts.join(' '));
						} else if (rLine.trim() !== '') {
							newLines.push(rLine.trim());
						}
					}
				} else {
					let currentLine = lines[i];
					let jump = parseJump(currentLine);
					if (jump) {
						jump.parts[1] = targets[jump.target];
						newLines.push(jump.indent + jump.parts.join(' '));
					} else {
						newLines.push(currentLine);
					}
				}
			}
		}

		if (replacedCount > 0) {
			logicDialog.canvas.load(newLines.join('\n'));
			Vars.ui.showInfoFade('Replaced ' + replacedCount + ' occurrences!');
		} else {
			Vars.ui.showInfoFade('No matches found.');
		}
	} catch (err) {
		notify('[scarlet]Replace Error: ' + err);
	}
}

function performInsert(logicDialog, insertAfter, sourceCode) {
	try {
		let currentCode = logicDialog.canvas.save();
		let prefixOrig = 'orig' + Math.floor(Math.random() * 10000) + '_';
		let prefixIns = 'ins' + Math.floor(Math.random() * 10000) + '_';

		let currentLabeled = convertJumpsToLabels(currentCode, prefixOrig);
		let insertLabeled = convertJumpsToLabels(sourceCode, prefixIns);

		let lines = currentLabeled.code ? currentLabeled.code.split('\n') : [];
		let insertIndex = lines.length;

		if (insertAfter === -1) {
			insertIndex = 0;
		} else if (
			insertAfter >= 0 &&
			currentLabeled.map[insertAfter] !== undefined
		) {
			insertIndex = currentLabeled.map[insertAfter] + 1;
		}

		let insertLines = insertLabeled.code
			? insertLabeled.code.split('\n')
			: [];
		for (let i = 0; i < insertLines.length; i++) {
			lines.splice(insertIndex + i, 0, insertLines[i]);
		}

		logicDialog.canvas.load(lines.join('\n'));
		Vars.ui.showInfoFade('Code inserted!');
	} catch (err) {
		notify('[scarlet]Insert Error: ' + err);
	}
}

function injectUIButtons(table, dialog, logicDialog, scrollPane) {
	let style = Styles.flatt;
	table.row();

	if (scrollPane) scrollPane.setScrollingDisabled(false, false);

	table
		.button('Copy with Labels', Icon.copy, style, () => {
			dialog.hide();
			let converted = convertJumpsToLabels(
				logicDialog.canvas.save(),
				'label'
			);
			Core.app.setClipboardText(converted.code);
			Vars.ui.showInfoFade('Copied to clipboard!');
		})
		.size(280, 60)
		.left()
		.marginLeft(12)
		.row();

	table
		.button('Save to QoL', Icon.save, style, () => {
			dialog.hide();
			Vars.ui.showTextInput('Save Snippet', 'Enter name:', '', (name) => {
				if (!name) return;
				mlogDir
					.child(name + '.txt')
					.writeString(logicDialog.canvas.save());
				Vars.ui.showInfoFade('Saved to ' + name);
			});
		})
		.size(280, 60)
		.left()
		.marginLeft(12)
		.row();

	table
		.button('Save Range to QoL', Icon.save, style, () => {
			dialog.hide();
			Vars.ui.showTextInput(
				'Start Line',
				'Start line (0-indexed):',
				'',
				(startStr) => {
					let start = parseInt(startStr, 10);
					if (isNaN(start)) return;
					Vars.ui.showTextInput(
						'End Line',
						'End line (0-indexed):',
						'',
						(endStr) => {
							let end = parseInt(endStr, 10);
							if (isNaN(end)) return;
							Vars.ui.showTextInput(
								'Save Snippet',
								'Enter name:',
								'',
								(name) => {
									if (!name) return;
									let rangeCode = convertRangeJumpsToLabels(
										logicDialog.canvas.save(),
										start,
										end,
										'lbl_'
									);
									mlogDir
										.child(name + '.txt')
										.writeString(rangeCode);
									Vars.ui.showInfoFade(
										'Saved range to ' + name
									);
								}
							);
						}
					);
				}
			);
		})
		.size(280, 60)
		.left()
		.marginLeft(12)
		.row();

	table
		.button('Load from QoL', Icon.download, style, () => {
			dialog.hide();
			let d = new BaseDialog('Load Snippet');
			d.addCloseButton();

			let listTable = new Table();
			getMlogFiles().forEach((file) => {
				let rowTable = new Table();
				rowTable
					.button(file.nameWithoutExtension(), () => {
						try {
							logicDialog.canvas.load(file.readString());
							d.hide();
						} catch (err) {
							notify('[scarlet]Load Error: ' + err);
						}
					})
					.size(300, 50);

				rowTable
					.button(Icon.trash, () => {
						Vars.ui.showConfirm(
							'Delete',
							'Delete ' + file.name() + '?',
							() => {
								file.delete();
								d.hide();
							}
						);
					})
					.size(50, 50);
				listTable.add(rowTable).padBottom(5).row();
			});

			d.cont.add(new ScrollPane(listTable)).width(400).height(400);
			d.show();
		})
		.size(280, 60)
		.left()
		.marginLeft(12)
		.row();

	table
		.button('Insert Code', Icon.add, style, () => {
			dialog.hide();
			Vars.ui.showConfirm(
				'Warning',
				'Please save your current processor code before merging!\nUnexpected behaviors may occur.\nProceed?',
				() => {
					Vars.ui.showTextInput(
						'Insert After',
						'Insert after line (0-indexed, -1 for start):',
						'',
						(lineStr) => {
							let insertAfter = parseInt(lineStr, 10);
							if (isNaN(insertAfter)) return;

							let d = new BaseDialog('Select Source');
							d.addCloseButton();
							let t = new Table();

							t.button(
								'From Clipboard',
								Icon.paste,
								Styles.flatt,
								() => {
									d.hide();
									performInsert(
										logicDialog,
										insertAfter,
										Core.app.getClipboardText()
									);
								}
							)
								.size(280, 60)
								.row();

							t.button(
								'From QoL File',
								Icon.folder,
								Styles.flatt,
								() => {
									d.hide();
									let fd = new BaseDialog('Select File');
									fd.addCloseButton();
									let ft = new Table();
									getMlogFiles().forEach((file) => {
										ft.button(
											file.nameWithoutExtension(),
											() => {
												fd.hide();
												performInsert(
													logicDialog,
													insertAfter,
													file.readString()
												);
											}
										)
											.size(300, 50)
											.row();
									});
									fd.cont
										.add(new ScrollPane(ft))
										.width(400)
										.height(400);
									fd.show();
								}
							)
								.size(280, 60)
								.row();

							d.cont.add(t);
							d.show();
						}
					);
				}
			);
		})
		.size(280, 60)
		.left()
		.marginLeft(12)
		.row();

	table
		.button('Replace Code', Icon.edit, style, () => {
			dialog.hide();
			let d = new BaseDialog('Replace Code');
			d.addCloseButton();

			let t = new Table();
			t.add('Find exact code:').left().row();
			let findArea = new Packages.arc.scene.ui.TextArea('');
			t.add(findArea).width(600).height(120).row();

			t.add('Replace with:').left().padTop(10).row();
			let repArea = new Packages.arc.scene.ui.TextArea('');
			t.add(repArea).width(600).height(120).row();

			t.button('Replace', () => {
				performReplace(
					logicDialog,
					findArea.getText(),
					repArea.getText()
				);
				d.hide();
			})
				.size(280, 60)
				.padTop(15)
				.row();

			d.cont.add(new ScrollPane(t)).width(450).height(400);
			d.show();
		})
		.size(280, 60)
		.left()
		.marginLeft(12)
		.row();

	dialog.pack();
	dialog.setPosition(
		Math.round((Core.graphics.getWidth() - dialog.getWidth()) / 2),
		Math.round((Core.graphics.getHeight() - dialog.getHeight()) / 2)
	);
}

let trackedGlobalProcessors = [];
let trackerWindows = [];
let trackerRules = [];
let varsWindows = [];
let memWindows = [];
let playerDrawLines = [];

Events.on(Packages.mindustry.game.EventType.WorldLoadEvent, () => {
	trackedGlobalProcessors = [];
	trackerRules = [];
	trackerWindows.forEach((w) => w.table.remove());
	trackerWindows = [];
	varsWindows.forEach((w) => w.table.remove());
	varsWindows = [];
	memWindows.forEach((w) => w.table.remove());
	memWindows = [];
	playerDrawLines = [];
});

function togglePlayerDrawLine(obj, varNames, sourceId) {
	let existingIdx = -1;
	for (let i = 0; i < playerDrawLines.length; i++) {
		if (playerDrawLines[i].id === sourceId) {
			existingIdx = i;
			break;
		}
	}
	if (existingIdx !== -1) {
		playerDrawLines.splice(existingIdx, 1);
	} else {
		if (obj && (typeof obj.isValid === 'function' ? obj.isValid() : true)) {
			playerDrawLines.push({ id: sourceId, obj: obj, vars: varNames });
		}
	}
}

function removePlayerDrawLine(sourceId) {
	let existingIdx = -1;
	for (let i = 0; i < playerDrawLines.length; i++) {
		if (playerDrawLines[i].id === sourceId) {
			existingIdx = i;
			break;
		}
	}
	if (existingIdx !== -1) playerDrawLines.splice(existingIdx, 1);
}

function isPlayerDrawLine(sourceId) {
	for (let i = 0; i < playerDrawLines.length; i++) {
		if (playerDrawLines[i].id === sourceId) return true;
	}
	return false;
}

function createDraggableWindow(titleText, target, winList) {
	let existingIndex = -1;
	for (let i = 0; i < winList.length; i++) {
		if (winList[i].target.id === target.id) {
			existingIndex = i;
			break;
		}
	}
	if (existingIndex !== -1) {
		winList[existingIndex].table.remove();
		winList.splice(existingIndex, 1);
	}

	let trackerWindow = new Table();
	let winData = {
		table: trackerWindow,
		target: target,
		stageX: Core.graphics.getWidth() / 2,
		stageY: Core.graphics.getHeight() / 2,
		collapsed: false,
	};
	winList.push(winData);

	trackerWindow.touchable = Packages.arc.scene.event.Touchable.enabled;
	let dragger = new Table(Styles.black8);
	dragger.touchable = Packages.arc.scene.event.Touchable.enabled;
	let titleLab = new Packages.arc.scene.ui.Label('[accent]' + titleText);
	titleLab.setAlignment(Packages.arc.util.Align.center);
	dragger.add(titleLab).pad(8).growX();


	let contentTable = new Table();
	let collapseBtn = new Packages.arc.scene.ui.ImageButton(
		Icon.downOpen,
		Styles.cleari
	);

	let headerBtns = {
		dragger: dragger,
		collapseBtn: collapseBtn,
		contentTable: contentTable,
	};

	collapseBtn.clicked(() => {
		winData.collapsed = !winData.collapsed;
		collapseBtn.getStyle().imageUp = winData.collapsed
			? Icon.upOpen
			: Icon.downOpen;
		contentTable.visible = !winData.collapsed;
		trackerWindow.pack();
	});

	dragger.addListener(
		extend(Packages.arc.scene.event.InputListener, {
			touchDown(event, x, y, pointer, button) {
				this.dragX = event.stageX;
				this.dragY = event.stageY;
				this.initStageX = winData.stageX;
				this.initStageY = winData.stageY;
				return true;
			},
			touchDragged(event, x, y, pointer) {
				let dxStage = event.stageX - this.dragX;
				let dyStage = event.stageY - this.dragY;
				let nX = this.initStageX + dxStage;
				let nY = this.initStageY + dyStage;
				let sw = Core.graphics.getWidth(), sh = Core.graphics.getHeight();
				let w = trackerWindow.getWidth(), h = trackerWindow.getHeight();
				if (nX - w / 2 < 0) nX = w / 2;
				if (nY - h / 2 < 0) nY = h / 2;
				if (nX + w / 2 > sw) nX = sw - w / 2;
				if (nY + h / 2 > sh) nY = sh - h / 2;
				winData.stageX = nX;
				winData.stageY = nY;
			},
		})
	);

	trackerWindow.update(() => {
		if (!Vars.state.isGame() || !target.isValid()) {
			trackerWindow.remove();
			let idx = winList.indexOf(winData);
			if (idx !== -1) winList.splice(idx, 1);
			return;
		}
		let sw = Core.graphics.getWidth(), sh = Core.graphics.getHeight();
		let w = trackerWindow.getWidth(), h = trackerWindow.getHeight();
		if (winData.stageX - w / 2 < 0) winData.stageX = w / 2;
		if (winData.stageY - h / 2 < 0) winData.stageY = h / 2;
		if (winData.stageX + w / 2 > sw) winData.stageX = sw - w / 2;
		if (winData.stageY + h / 2 > sh) winData.stageY = sh - h / 2;
		trackerWindow.setPosition(winData.stageX, winData.stageY, Packages.arc.util.Align.center);
	});

	trackerWindow.add(dragger).growX().row();

	return {
		winWindow: trackerWindow,
		winData: winData,
		dragger: dragger,
		contentTable: contentTable,
		collapseBtn: collapseBtn,
	};
}

// Resolve Mindustry mlog builtin @ variables from live game state.
// These are NOT stored in exec.vars - they are computed on demand by the executor.
function resolveBuiltin(name, exec, procBlock) {
	let n = String(name);
	try {
		switch (n) {
			case '@time':       return Number(Time.millis()) / 1000;
			case '@tick':       return Number(Vars.state.tick);
			case '@second':     return Math.floor(Number(Vars.state.tick) / 60);
			case '@minute':     return Math.floor(Number(Vars.state.tick) / 3600);
			case '@waveNumber':
			case '@wave':       return Number(Vars.state.wave);
			case '@mapw':       return Number(Vars.world.width());
			case '@maph':       return Number(Vars.world.height());
			case '@thisx':      return procBlock ? Number(procBlock.tileX()) : 0;
			case '@thisy':      return procBlock ? Number(procBlock.tileY()) : 0;
			case '@links':      return procBlock && procBlock.links ? Number(procBlock.links.size) : 0;
			case '@counter':    return exec && exec.iptr !== undefined ? Number(exec.iptr) : 0;
			case '@ipt':        return procBlock && procBlock.ipt !== undefined ? Number(procBlock.ipt) : 0;
			case '@unit': {
				// Executor stores @unit as 'unit' (no @ prefix) in exec.vars
				let uv = getExecVar(exec, '@unit') || getExecVar(exec, 'unit');
				return uv ? getObjectVal(uv) : null;
			}
			case '@this':       return procBlock || null;
			case '@true':       return 1;
			case '@false':      return 0;
			case '@pi':         return Math.PI;
			case '@e':          return Math.E;
			case '@degToRad':   return Math.PI / 180;
			case '@radToDeg':   return 180 / Math.PI;
		}
	} catch (e) {}
	return null;
}

// Resolve a condValue string to an actual value.
// Handles: quoted strings, @builtins, exec vars, link names, plain numbers.
function resolveCondValue(targetStr, exec, procBlock) {
	let s = String(targetStr);
	if ((s.startsWith('"') && s.endsWith('"')) ||
	    (s.startsWith("'") && s.endsWith("'"))) {
		return s.substring(1, s.length - 1);
	}
	// Check exec.vars first (covers @unit and user vars)
	let tv = getExecVar(exec, s);
	if (tv !== null) return getObjectVal(tv);
	// Then live builtins
	if (s.startsWith('@')) {
		let bv = resolveBuiltin(s, exec, procBlock);
		if (bv !== null) return bv;
		// known null builtins (@unit dead, @false etc.)
		let known = ['@time','@tick','@second','@minute','@wave','@waveNumber',
		             '@mapw','@maph','@thisx','@thisy','@links','@counter','@ipt',
		             '@unit','@this','@true','@false','@pi','@e','@degToRad','@radToDeg'];
		if (known.indexOf(s) !== -1) return bv;
	}
	// Link name
	if (procBlock && procBlock.links) {
		for (let j = 0; j < procBlock.links.size; j++) {
			let link = procBlock.links.get(j);
			if (link.name === s) return Vars.world.build(link.x, link.y);
		}
	}
	let parsed = parseFloat(s);
	return isNaN(parsed) ? s : parsed;
}

// Also resolve the WATCHED variable itself if it is a builtin (e.g. watching @tick directly).
function resolveWatchedVar(varName, exec, procBlock) {
	let n = String(varName);
	// Try exec.vars first — covers user vars AND @-vars stored there (like @unit)
	let v = getExecVar(exec, n);
	if (v !== null) return getObjectVal(v);
	// Fall back to live builtins (@time, @tick, @wave, etc. not stored in vars)
	if (n.startsWith('@')) {
		let bv = resolveBuiltin(n, exec, procBlock);
		// bv === null means builtin is null/dead (e.g. @unit with no unit bound)
		// distinguish from "not a builtin at all" using the switch coverage
		// Any recognised builtin key returns a value (even null), so we check
		// whether the name is a known builtin:
		let known = ['@time','@tick','@second','@minute','@wave','@waveNumber',
		             '@mapw','@maph','@thisx','@thisy','@links','@counter','@ipt',
		             '@unit','@this','@true','@false','@pi','@e','@degToRad','@radToDeg'];
		if (known.indexOf(n) !== -1) return bv; // return null for dead @unit etc.
	}
	return undefined; // truly unknown variable
}

// Stable key for a Java object that survives Rhino re-wrapping.
// Units use their numeric id, buildings use tile coords, others fall back to toString.
function _javaObjKey(o) {
	if (o == null) return 'null';
	try {
		if (o instanceof Packages.mindustry.gen.Unit)
			return 'u' + Number(o.id);
		if (o instanceof Packages.mindustry.gen.Building)
			return 'b' + Number(o.tileX()) + '_' + Number(o.tileY());
		if (typeof o.id !== 'undefined')
			return 'e' + Number(o.id);
	} catch(e) {}
	return 'unknown';
}

function checkCondition(val, op, targetStr, exec, procBlock, rule) {
	let t = resolveCondValue(targetStr, exec, procBlock);

	if (op === '==' || op === '===' || op === '!=' || op === '!==') {
		let eq = false;
		if (val != null && typeof val === 'object') {
			if (t != null && typeof t === 'object') {
				// Compare Java objects by stable string key to avoid Rhino wrapper identity issues
				try { eq = _javaObjKey(val) === _javaObjKey(t) && _javaObjKey(val) !== 'unknown'; } catch(e) { eq = false; }
			} else if (typeof t === 'string') {
				let nameStr = t.startsWith('@') ? t.substring(1) : t;
				if (
					val.name === nameStr ||
					(val.block && val.block.name === nameStr) ||
					(val.type && val.type.name === nameStr)
				) { eq = true; }
				// Also allow 'null' string to match null unit
				else if (nameStr === 'null' || nameStr === '') { eq = false; }
			} else if (t === null || t === 0 || t === false) {
				eq = false; // object != null/0
			} else {
				try { eq = val.equals(t); } catch(e) { eq = false; }
			}
		} else if (t != null && typeof t === 'object') {
			// val is primitive, t is Java object
			eq = false;
		} else {
			eq = val == t;
		}
		if (op === '==' || op === '===') return eq;
		return !eq;
	}

	if (op === 'changed') {
		return (
			rule &&
			rule.lastVal !== undefined &&
			String(rule.lastVal) !== String(val)
		);
	}
	if (op === 'typeof') {
		if (!val) return String(t) === 'null';
		if (typeof val === 'number') return String(t) === 'number';
		if (typeof val === 'string') return String(t) === 'string';
		if (val instanceof Packages.mindustry.gen.Building)
			return String(t) === 'building' || String(t) === 'block';
		if (val instanceof Packages.mindustry.gen.Unit)
			return String(t) === 'unit';
		return false;
	}
	if (op === 'contains') {
		if (val != null) return String(val).indexOf(String(t)) !== -1;
		return false;
	}

	let vNum = typeof val === 'number' ? val : val ? 1 : 0;
	let tNum = typeof t === 'number' ? t : t ? 1 : 0;

	if (op === '>') return vNum > tNum;
	if (op === '<') return vNum < tNum;
	if (op === '>=') return vNum >= tNum;
	if (op === '<=') return vNum <= tNum;
	if (op === '%==') return tNum !== 0 && (vNum % tNum) === 0;
	if (op === '%!=') return tNum !== 0 && (vNum % tNum) !== 0;
	return false;
}

function getObjectVal(v) {
	if (!v) return null;
	// objval takes priority when it holds a non-null Java object —
	// don't trust isobj flag since it can be stale after set instructions
	if (v.objval != null && v.objval !== 0 && v.objval !== false) return v.objval;
	if (v.isobj !== undefined) return v.isobj ? v.objval : v.numval;
	return v.objval != null ? v.objval : v.numval;
}

function getExecVar(exec, name) {
	if (!exec || !exec.vars) return null;
	let nStr = String(name);
	// Mindustry executor strips @ from builtin var names when storing in vars array.
	// So '@unit' is stored as 'unit', '@counter' as 'counter', etc.
	// Try both the raw name and the @-stripped version.
	let nStripped = nStr.startsWith('@') ? nStr.substring(1) : null;
	for (let i = 0; i < exec.vars.length; i++) {
		let v = exec.vars[i];
		if (!v) continue;
		let vn = String(v.name);
		if (vn === nStr || (nStripped !== null && vn === nStripped)) return v;
	}
	return null;
}

function showTrackerWindow(target) {
	let wData = createDraggableWindow(
		'Watch \u2022 ' + target.tileX() + ',' + target.tileY(),
		target,
		trackerWindows
	);
	let trackerWindow = wData.winWindow;
	let winData = wData.winData;
	let dragger = wData.dragger;
	let contentTable = wData.contentTable;

	// header buttons
	let pauseBtn = dragger
		.button(Icon.pause, Styles.cleari, () => { target.enabled = !target.enabled; })
		.size(28).pad(1).get();
	pauseBtn.update(() => {
		pauseBtn.getStyle().imageUp = target.enabled ? Icon.pause : Icon.play;
	});

	dragger.button(Icon.refresh, Styles.cleari, () => {
		target.configure(target.config());
	}).size(28).pad(1);

	dragger.add(wData.collapseBtn).size(28).pad(1);

	dragger.button(Icon.cancel, Styles.cleari, () => {
		trackerWindow.remove();
		let idx = trackerWindows.indexOf(winData);
		if (idx !== -1) trackerWindows.splice(idx, 1);
		for (let i = playerDrawLines.length - 1; i >= 0; i--) {
			if (
				typeof playerDrawLines[i].id === 'object' &&
				playerDrawLines[i].id.proc === target
			) playerDrawLines.splice(i, 1);
		}
		let tkIdx = -1;
		for (let k = 0; k < trackedGlobalProcessors.length; k++) {
			if (trackedGlobalProcessors[k].id === target.id) { tkIdx = k; break; }
		}
		if (tkIdx !== -1) trackedGlobalProcessors.splice(tkIdx, 1);
	}).size(28).pad(1).right();

	contentTable.background(Styles.black5);

	// rules list
	let rulesTable = new Table();
	let rulesScroll = new ScrollPane(rulesTable);

	let rebuildRules = () => {
		rulesTable.clearChildren();
		let procRules = trackerRules.filter((r) => r.proc.id === target.id);

		if (procRules.length === 0) {
			rulesTable.add('[gray]No watches yet[]').pad(8).row();
			trackerWindow.pack();
			return;
		}

		procRules.forEach((r) => {
			let row = new Table(Styles.black3);
			row.margin(2);

			let valLabel = new Packages.arc.scene.ui.Label('...');
			valLabel.setWrap(false);

			let eyeContainer = new Table();
			let hasEye = false, lastEyeObj = null, lastEyeKey = '';

			function objKey(o) {
				if (o == null) return 'null';
				try {
					if (o instanceof Packages.mindustry.gen.Unit) return 'u' + o.id;
					if (o instanceof Packages.mindustry.gen.Building) return 'b' + o.tileX() + '_' + o.tileY();
				} catch(e) {}
				return String(o);
			}

			valLabel.update(() => {
				if (!target.isValid()) { valLabel.setText('[gray]?[]'); return; }
				let exec = r.proc.executor;
				let curVal = resolveWatchedVar(r.varName, exec, r.proc);
				if (curVal === undefined) { valLabel.setText('[gray]' + r.varName + ' = ?[]'); return; }
				let cond = checkCondition(curVal, r.condType, r.condValue, exec, r.proc, r);
				let triggered = cond && !r.lastCond;
				r.lastCond = cond;

				if (triggered) {
					if (r.action === 'count') {
						r.counter++;
					} else if (r.action === 'notify') {
						notify('[lightgray]Watch [accent]' + r.varName + '[]: ' + curVal);
					} else if (r.action === 'camera') {
						let tx = target.x, ty = target.y;
						if (r.actionArg) {
							let parts = String(r.actionArg).split(',');
							if (parts.length >= 2) {
								let vx = getExecVar(exec, parts[0].trim());
								let vy = getExecVar(exec, parts[1].trim());
								let nx = vx ? getObjectVal(vx) : Number(parts[0].trim());
								let ny = vy ? getObjectVal(vy) : Number(parts[1].trim());
								if (!Number.isNaN(nx) && !Number.isNaN(ny)) { tx = nx * 8; ty = ny * 8; }
							}
						} else if (
							curVal instanceof Packages.mindustry.gen.Building ||
							curVal instanceof Packages.mindustry.gen.Unit
						) { tx = curVal.x; ty = curVal.y; }
						Core.camera.position.set(tx, ty);
					} else if (r.action === 'pause') {
						r.proc.enabled = false;
					}
				}
				r.lastVal = curVal;

				let isObj = curVal != null && typeof curVal === 'object' &&
					(curVal instanceof Packages.mindustry.gen.Building ||
					 curVal instanceof Packages.mindustry.gen.Unit);

				let dispVal = '' + curVal;
				if (isObj) {
					if (curVal instanceof Packages.mindustry.gen.Building)
						dispVal = 'Block(' + curVal.block.name + ')';
					else {
						let un = curVal.type ? curVal.type.name : 'Unit';
						dispVal = un + '[' + curVal.id + ']';
					}
				} else if (typeof curVal === 'number' && Math.abs(curVal % 1) > 0) {
					dispVal = formatFloat(curVal);
				}

				let highlight = cond && r.action === 'highlight';
				let nameCol = highlight ? '[lime]' : '[accent]';
				let valCol  = highlight ? '[lime]' : '[white]';

				let extra = '';
				if (r.action === 'count') extra = ' [orange]#' + r.counter + '[]';
				else if (r.action !== 'none' && r.action !== 'highlight')
					extra = ' [gray](' + r.action + (r.actionArg ? ' ' + r.actionArg : '') + ')[]';

				valLabel.setText(
					nameCol + r.varName + '[] [gray]' + r.condType + ' ' + r.condValue + ':[] ' +
					valCol + dispVal + '[]' + extra
				);

				let curKey = isObj ? objKey(curVal) : '';
				if (isObj !== hasEye || curKey !== lastEyeKey) {
					hasEye = isObj; lastEyeObj = curVal; lastEyeKey = curKey;
					eyeContainer.clearChildren();
					if (isObj) {
						r._eyeObj = curVal;
						let eb = eyeContainer.button(Icon.eyeSmall, Styles.clearTogglei, () => {
							let liveObj = resolveWatchedVar(r.varName, r.proc.executor, r.proc);
							let useObj = (liveObj != null && typeof liveObj === 'object') ? liveObj : r._eyeObj;
							if (useObj) togglePlayerDrawLine(useObj, [r.varName], r);
						}).size(26).get();
						eb.update(() => {
							eb.setChecked(isPlayerDrawLine(r));
							if (isPlayerDrawLine(r)) {
								let liveObj = resolveWatchedVar(r.varName, r.proc.executor, r.proc);
								for (let _i = 0; _i < playerDrawLines.length; _i++) {
									if (playerDrawLines[_i].id === r) { playerDrawLines[_i].obj = liveObj; break; }
								}
							}
						});
					}
				}
			});
			valLabel.setAlignment(Packages.arc.util.Align.left);

			row.add(valLabel).growX().padLeft(6).padRight(2);
			row.add(eyeContainer).minWidth(28);
			row.button(Icon.cancel, Styles.cleari, () => {
				let idx = trackerRules.indexOf(r);
				if (idx !== -1) trackerRules.splice(idx, 1);
				removePlayerDrawLine(r);
				row.remove();
				trackerWindow.pack();
			}).size(26).padRight(2);

			rulesTable.add(row).growX().padBottom(1).row();
		});
		trackerWindow.pack();
	};

	// add-rule row
	let ops     = ['==','!=','>','<','>=','<=','changed','typeof','contains','%==','%!='];
	// %== means: (val % condValue) == 0  (divisible check)  |  %!= means not divisible
	let actions = ['none','pause','highlight','count','notify','camera'];
	let opIdx = 0, actionIdx = 0;

	let varField = new Packages.arc.scene.ui.TextField('');
	varField.setMessageText('var');

	let opBtn = new Packages.arc.scene.ui.TextButton('==', Styles.cleart);
	opBtn.clicked(() => {
		let menu = new Table(Styles.black5);
		let overlay = new Table();
		overlay.touchable = Packages.arc.scene.event.Touchable.enabled;
		overlay.clicked(() => { menu.remove(); overlay.remove(); });
		overlay.fillParent = true;
		Core.scene.add(overlay);
		ops.forEach((o, i) => {
			menu.button(o, Styles.cleart, () => {
				opIdx = i; opBtn.setText(o); menu.remove(); overlay.remove();
			}).width(80).height(32).row();
		});
		menu.pack();
		menu.update(() => {
			let p = opBtn.localToStageCoordinates(new Packages.arc.math.geom.Vec2(0, 0));
			menu.setPosition(p.x, p.y, Packages.arc.util.Align.topLeft);
			if (!trackerWindow.parent) { menu.remove(); overlay.remove(); }
		});
		Core.scene.add(menu);
	});

	let valField = new Packages.arc.scene.ui.TextField('0');
	valField.setMessageText('val');

	let actionBtn = new Packages.arc.scene.ui.TextButton('none', Styles.cleart);
	let argField  = new Packages.arc.scene.ui.TextField('');
	argField.setMessageText('x,y');

	let addInputRow = new Table();
	let rebuildAddRow = () => {
		addInputRow.clearChildren();
		let isCam = actions[actionIdx] === 'camera';
		addInputRow.add(varField).width(80).height(30).pad(1);
		addInputRow.add(opBtn).width(62).height(30).pad(1);
		addInputRow.add(valField).width(isCam ? 50 : 68).height(30).pad(1);
		addInputRow.add(actionBtn).width(isCam ? 62 : 80).height(30).pad(1);
		if (isCam) addInputRow.add(argField).width(58).height(30).pad(1);
		addInputRow.button(Icon.add, Styles.cleari, () => {
			let vt = varField.getText();
			if (!vt || !vt.length) return;
			trackerRules.push({
				proc: target,
				varName: vt,
				condType: ops[opIdx],
				condValue: valField.getText(),
				action: actions[actionIdx],
				actionArg: actions[actionIdx] === 'camera' ? argField.getText() : undefined,
				counter: 0, lastVal: null, lastCond: false,
			});
			rebuildRules();
			trackerWindow.pack();
		}).size(30).pad(1);
	};

	actionBtn.clicked(() => {
		let menu = new Table(Styles.black5);
		let overlay = new Table();
		overlay.touchable = Packages.arc.scene.event.Touchable.enabled;
		overlay.clicked(() => { menu.remove(); overlay.remove(); });
		overlay.fillParent = true;
		Core.scene.add(overlay);
		actions.forEach((a, i) => {
			menu.button(a, Styles.cleart, () => {
				actionIdx = i; actionBtn.setText(a);
				menu.remove(); overlay.remove(); rebuildAddRow();
			}).width(100).height(32).row();
		});
		menu.pack();
		menu.update(() => {
			let p = actionBtn.localToStageCoordinates(new Packages.arc.math.geom.Vec2(0, 0));
			menu.setPosition(p.x, p.y, Packages.arc.util.Align.topLeft);
			if (!trackerWindow.parent) { menu.remove(); overlay.remove(); }
		});
		Core.scene.add(menu);
	});

	rebuildAddRow();
	rebuildRules();

	contentTable.add(rulesScroll).growX().maxHeight(200).width(370).padTop(2).padBottom(1).row();

	let div = new Table(Styles.black8);
	contentTable.add(div).growX().height(1).padBottom(1).row();

	contentTable.add(addInputRow).growX().padBottom(3).padLeft(2).row();

	trackerWindow.add(contentTable).growX().row();
	trackerWindow.pack();
	trackerWindow.setPosition(winData.stageX, winData.stageY, Packages.arc.util.Align.center);
	Vars.ui.hudGroup.addChild(trackerWindow);
}

// Per-processor var history: varHistories[procId][varName] = [{disp, tick}, ...]
let varHistories = {};

function showVariablesWindow(target) {
	let wData = createDraggableWindow(
		'Vars \u2022 ' + target.tileX() + ',' + target.tileY(),
		target,
		varsWindows
	);
	let trackerWindow = wData.winWindow;
	let winData = wData.winData;
	let dragger = wData.dragger;
	let contentTable = wData.contentTable;

	// header buttons
	let pauseBtn = dragger
		.button(Icon.pause, Styles.cleari, () => { target.enabled = !target.enabled; })
		.size(28).pad(1).get();
	pauseBtn.update(() => {
		pauseBtn.getStyle().imageUp = target.enabled ? Icon.pause : Icon.play;
	});

	dragger.button(Icon.refresh, Styles.cleari, () => {
		target.configure(target.config());
	}).size(28).pad(1);

	dragger.add(wData.collapseBtn).size(28).pad(1);

	dragger.button(Icon.cancel, Styles.cleari, () => {
		trackerWindow.remove();
		let idx = varsWindows.indexOf(winData);
		if (idx !== -1) varsWindows.splice(idx, 1);
		for (let i = playerDrawLines.length - 1; i >= 0; i--) {
			if (
				typeof playerDrawLines[i].id === 'string' &&
				playerDrawLines[i].id.startsWith('var_' + target.id + '_')
			) playerDrawLines.splice(i, 1);
		}
		let tkIdx = -1;
		for (let k = 0; k < trackedGlobalProcessors.length; k++) {
			if (trackedGlobalProcessors[k].id === target.id) { tkIdx = k; break; }
		}
		if (tkIdx !== -1) trackedGlobalProcessors.splice(tkIdx, 1);
	}).size(28).pad(1).right();

	contentTable.background(Styles.black5);

	// search bar
	let searchField = new Packages.arc.scene.ui.TextField('');
	searchField.setMessageText('search...');

	let content = new Table();
	let scrollPane = new ScrollPane(content);

	let filterText = '';

	let rebuildVars = () => {
		content.clearChildren();
		if (!target.isValid() || !target.executor || !target.executor.vars) return;

		let execVars = [];
		for (let i = 0; i < target.executor.vars.length; i++) {
			let v = target.executor.vars[i];
			if (v && !String(v.name).startsWith('___'))
				execVars.push({ name: String(v.name), isBuffer: false, vRef: v });
		}
		if (target.executor && target.executor.textBuffer !== undefined)
			execVars.push({ name: '@buffer', isBuffer: true });
		execVars.push({ name: '@thisx', isProp: true, propVal: () => target.x / 8 });
		execVars.push({ name: '@thisy', isProp: true, propVal: () => target.y / 8 });
		if (target.links != null)
			execVars.push({ name: '@links', isProp: true, propVal: () => target.links.size });
		if (target.executor && target.executor.iptr !== undefined)
			execVars.push({ name: '@counter', isProp: true, propVal: () => target.executor.iptr });

		let filter = filterText.toLowerCase();
		let shown = filter ? execVars.filter((v) => v.name.toLowerCase().indexOf(filter) !== -1) : execVars;

		if (shown.length === 0) {
			content.add('[gray]No variables[]').pad(8).row();
			return;
		}

		for (let i = 0; i < shown.length; i++) {
			let vData = shown[i];

			// Per-var history ring buffer: {disp, tick}[], max 20 entries
			let procKey = String(target.id);
			if (!varHistories[procKey]) varHistories[procKey] = {};
			let history = varHistories[procKey][vData.name] || (varHistories[procKey][vData.name] = []);
			let lastHistVal = undefined;

			let row = new Table();
			row.margin(0);

			let valLabel = new Packages.arc.scene.ui.Label('...');
			valLabel.setWrap(false);

			// Inline edit field + confirm — shown only when editing
			let editField = new Packages.arc.scene.ui.TextField('');
			let editContainer = new Table();
			let isEditing = false;

			// Can this var be written to?
			let isWritable = !vData.isBuffer && !vData.isProp &&
			                 !vData.name.startsWith('@');
			// @counter is a special writable prop
			let isCounter = vData.name === '@counter';
			if (isCounter) isWritable = true;

			let applyEdit = () => {
				let raw = editField.getText().trim();
				if (!raw.length) { isEditing = false; return; }
				let num = parseFloat(raw);
				try {
					if (isCounter) {
						if (!isNaN(num) && target.executor) {
							let v = Math.max(0, Math.floor(num));
							let written = false;
							let fnames = ['iptr','counter','instructionPointer','pc'];
							for (let fi = 0; fi < fnames.length && !written; fi++) {
								try {
									let f = target.executor.getClass().getDeclaredField(fnames[fi]);
									f.setAccessible(true);
									f.setInt(target.executor, v);
									written = true;
								} catch(e2) {}
							}
							if (!written) {
								let cv = getExecVar(target.executor, '@counter');
								if (cv) { cv.numval = v; if (cv.isobj !== undefined) cv.isobj = false; }
							}
						}
					} else {
						let cVar = getExecVar(target.executor, vData.name);
						if (cVar) {
							if (!isNaN(num)) {
								cVar.numval = num;
								cVar.objval = null;
								if (cVar.isobj !== undefined) cVar.isobj = false;
							} else {
								// String value
								cVar.objval = raw;
								cVar.numval = 0;
								if (cVar.isobj !== undefined) cVar.isobj = true;
							}
						}
					}
				} catch(e) {}
				isEditing = false;
				Core.scene.setKeyboardFocus(null);
			};

			editField.addListener(extend(Packages.arc.scene.event.InputListener, {
				keyDown: function(event, keyCode) {
					if (keyCode === Packages.arc.input.KeyCode.enter) {
						applyEdit();
						Core.scene.setKeyboardFocus(null);
						return true;
					}
					if (keyCode === Packages.arc.input.KeyCode.escape) {
						isEditing = false;
						Core.scene.setKeyboardFocus(null);
						return true;
					}
					return false;
				}
			}));

			let eyeContainer = new Table();
			let hasEye = false, lastEyeObj = null;

			valLabel.update(() => {
				if (isEditing) return; // don't update label while editing
				if (!target.isValid() || !target.executor) return;

				let cVal = null, dispVal = '', isObj = false;

				if (vData.isBuffer) {
					cVal = String(target.executor.textBuffer.toString() || '');
					dispVal = cVal.length > 40 ? cVal.substring(0, 38) + '..' : cVal;
				} else if (vData.isProp) {
					cVal = vData.propVal();
					dispVal = (typeof cVal === 'number' && Math.abs(cVal % 1) > 0)
						? formatFloat(cVal) : '' + cVal;
				} else {
					let cVar = getExecVar(target.executor, vData.name);
					if (!cVar) return;
					cVal = getObjectVal(cVar);
					dispVal = '' + cVal;

					if (cVal != null && typeof cVal === 'object') {
						if (cVal instanceof Packages.mindustry.gen.Building ||
							cVal instanceof Packages.mindustry.gen.Unit) {
							isObj = true;
							if (cVal instanceof Packages.mindustry.gen.Building)
								dispVal = cVal.block.name;
							else {
								let un = cVal.type ? cVal.type.name : 'Unit';
								dispVal = un + '#' + cVal.id;
							}
						}
					} else if (typeof cVal === 'number' && Math.abs(cVal % 1) > 0) {
						dispVal = formatFloat(cVal);
					}
				}

				// History tracking: record on change
				if (dispVal !== lastHistVal && lastHistVal !== undefined) {
					history.push({ disp: dispVal, tick: Vars.state.tick });
					if (history.length > 20) history.shift();
				}
				lastHistVal = dispVal;

				let nameCol = vData.isProp ? '[gray]' : (isWritable || isCounter) ? '[accent]' : '[gray]';
				let valCol  = isObj ? '[cyan]' : '[white]';
				valLabel.setText(nameCol + vData.name + '[] ' + valCol + dispVal + '[]');

				if (!vData.isBuffer && !vData.isProp && (isObj !== hasEye || lastEyeObj !== cVal)) {
					hasEye = isObj; lastEyeObj = cVal;
					eyeContainer.clearChildren();
					if (isObj) {
						let btnId = 'var_' + target.id + '_' + vData.name;
						let eb = eyeContainer.button(Icon.eyeSmall, Styles.clearTogglei, () => {
							togglePlayerDrawLine(lastEyeObj, [vData.name], btnId);
						}).size(26).get();
						eb.update(() => { eb.setChecked(isPlayerDrawLine(btnId)); });
					}
				}
			});
			valLabel.setAlignment(Packages.arc.util.Align.left);



			// History popup button (always shown for non-prop, non-buffer vars)
			let histBtn = null;
			if (!vData.isProp && !vData.isBuffer) {
				histBtn = new Packages.arc.scene.ui.TextButton('~', Styles.cleart);
				histBtn.clicked(() => {
					if (history.length === 0) {
						notify('[gray]No changes recorded yet for ' + vData.name);
						return;
					}
					let popup = new Table(Styles.black5);
					popup.margin(4);
					let overlay = new Table();
					overlay.touchable = Packages.arc.scene.event.Touchable.enabled;
					overlay.fillParent = true;
					overlay.clicked(() => { popup.remove(); overlay.remove(); });
					Core.scene.add(overlay);
					// Title
					popup.add('[accent]' + vData.name + ' [gray]history[]').padBottom(4).row();
					let divH = new Table(Styles.black8);
					popup.add(divH).growX().height(1).padBottom(4).row();
					// Entries newest-first
					for (let hi = history.length - 1; hi >= 0; hi--) {
						let entry = history[hi];
						popup.add('[white]' + entry.disp + '[]').left().padLeft(4).padBottom(2).row();
					}
					popup.pack();
					// Position near the button
					popup.update(() => {
						let p = histBtn.localToStageCoordinates(
							new Packages.arc.math.geom.Vec2(0, 0));
						let px = p.x - popup.getWidth();
						let py = p.y;
						if (px < 0) px = p.x + histBtn.getWidth();
						popup.setPosition(px, py, Packages.arc.util.Align.topLeft);
						if (!histBtn.parent) { popup.remove(); overlay.remove(); }
					});
					Core.scene.add(popup);
				});
			}

			// Left cell: swaps between label and edit field
			let leftCell = new Table();
			leftCell.add(valLabel).growX().padLeft(4);

			// Right cell: fixed buttons, always present — edit pencil + history list
			let rightCell = new Table();
			if (isWritable || isCounter) {
				let editBtn = rightCell.button(Icon.pencilSmall, Styles.clearTogglei, () => {
					if (isEditing) return;
					let cVar = isCounter ? null : getExecVar(target.executor, vData.name);
					let curRaw = isCounter
						? (target.executor && target.executor.iptr !== undefined
							? String(Number(target.executor.iptr)) : '0')
						: (cVar ? String(getObjectVal(cVar)) : '');
					editField.setText(curRaw);
					Core.scene.setKeyboardFocus(editField);
					isEditing = true;
					leftCell.clearChildren();
					editContainer.clearChildren();
					editContainer.add(editField).width(120).height(26).padLeft(2);
					editContainer.button(Icon.ok, Styles.cleari, () => {
						applyEdit(); Core.scene.setKeyboardFocus(null);
					}).size(26);
					leftCell.add(editContainer).growX().padLeft(4);
				}).size(24).padRight(1).get();
				editBtn.update(() => editBtn.setChecked(isEditing));
			}
			if (histBtn) rightCell.add(histBtn).size(24).padRight(2);
			rightCell.add(eyeContainer).minWidth(24);

			// When edit finishes, restore the label
			let prevEditing = false;
			row.update(() => {
				if (prevEditing && !isEditing) {
					prevEditing = false;
					leftCell.clearChildren();
					leftCell.add(valLabel).growX().padLeft(4);
				} else if (!prevEditing && isEditing) {
					prevEditing = true;
				}
			});

			row.add(leftCell).growX().padLeft(2);
			row.add(rightCell);

			content.add(row).growX().padBottom(1).row();
		}
	};

	// search field listener
	searchField.changed(() => {
		filterText = searchField.getText();
		rebuildVars();
	});

	let rebuildTimer = 0;
	let lastVarCount = 0;
	contentTable.update(() => {
		rebuildTimer += Core.graphics.getDeltaTime();
		if (rebuildTimer > 60) {
			rebuildTimer = 0;
			let currentLen = target.executor && target.executor.vars
				? target.executor.vars.length : 0;
			if (lastVarCount !== currentLen) {
				lastVarCount = currentLen;
				rebuildVars();
			}
		}

	});

	rebuildVars();
	lastVarCount = target.executor && target.executor.vars
		? target.executor.vars.length : 0;

	// search row
	let searchRow = new Table();
	searchRow.add(searchField).growX().height(28).padLeft(4).padRight(4);

	contentTable.add(searchRow).growX().padTop(3).padBottom(1).row();

	let div = new Table(Styles.black8);
	contentTable.add(div).growX().height(1).padBottom(1).row();

	scrollPane.setScrollingDisabled(false, false);
	contentTable.add(scrollPane).width(340).maxHeight(320).row();

	trackerWindow.add(contentTable).row();
	trackerWindow.pack();
	trackerWindow.setPosition(winData.stageX, winData.stageY, Packages.arc.util.Align.center);
	Vars.ui.hudGroup.addChild(trackerWindow);
}


Events.on(ClientLoadEvent, () => initFiles());

let configTableField = null;

// ── Memory Cell Viewer ───────────────────────────────────────────────────────
const MEM_NAMES = { 'memory-cell':1, 'memory-bank':1, 'world-cell':1 };
let _memTb=null, _memTbId=-1, _memTbTime=-1e9;

function memGetArr(b){
	try{let m=b.memory;if(m!=null)return m;}catch(e){}
	try{let clz=b.getClass();while(clz!=null){try{let f=clz.getDeclaredField('memory');f.setAccessible(true);return f.get(b);}catch(e){}clz=clz.getSuperclass();}}catch(e){}
	return null;
}
function memFmt(v){let n=Number(v);if(!isFinite(n))return String(n);if(n!==0&&(Math.abs(n)>=1e6||Math.abs(n)<0.001))return n.toExponential(3);return parseFloat(n.toFixed(6)).toString();}
function memCopyAll(b){let a=memGetArr(b);if(!a){notify('[scarlet]Cannot read memory');return;}let p=[];for(let i=0;i<Number(a.length);i++)p.push(String(Number(a[i])));Core.app.setClipboardText('['+p.join(',')+']');Vars.ui.showInfoFade('Copied '+Number(a.length)+' slots');}
function memPasteAll(b,cb){let text=Core.app.getClipboardText();if(!text||!text.trim()){notify('[scarlet]Clipboard empty');return;}try{let parsed=JSON.parse(text.trim());if(!Array.isArray(parsed)){notify('[scarlet]Need JSON array');return;}let a=memGetArr(b);if(!a){notify('[scarlet]Cannot access memory');return;}let n=Math.min(parsed.length,Number(a.length));for(let i=0;i<n;i++){let v=Number(parsed[i]);a[i]=isNaN(v)?0:v;}notify('[green]Pasted '+n+' values');if(cb)cb();}catch(e){notify('[scarlet]Parse error: '+e);}}

function memOpenGrid(build){
	let arr=memGetArr(build),size=arr?Number(arr.length):0;
	let wData=createDraggableWindow('Mem \u2022 '+build.tileX()+','+build.tileY(),build,memWindows);
	let win=wData.winWindow,winData=wData.winData,dragger=wData.dragger,ct=wData.contentTable;
	dragger.button(Icon.copy,Styles.cleari,function(){memCopyAll(build);}).size(28).pad(1);
	dragger.button(Icon.paste,Styles.cleari,function(){memPasteAll(build,refreshLabels);}).size(28).pad(1);
	dragger.add(wData.collapseBtn).size(28).pad(1);
	dragger.button(Icon.cancel,Styles.cleari,function(){win.remove();let i=memWindows.indexOf(winData);if(i!==-1)memWindows.splice(i,1);}).size(28).pad(1).right();
	ct.background(Styles.black5);
	let COLS=8,CW=62,CH=42,PAGE=64,nPages=Math.max(1,Math.ceil(size/PAGE)),curPage=0,labels=[];
	function refreshLabels(){let a=memGetArr(build);if(!a)return;let base=curPage*PAGE;for(let i=0;i<labels.length;i++){let v=Number(a[base+i]);labels[i].setText(memFmt(v));labels[i].setColor(v===0?Packages.arc.graphics.Color.gray:Packages.arc.graphics.Color.white);}}
	let grid=new Table();
	function buildGrid(page){
		grid.clearChildren();labels=[];
		let a=memGetArr(build),base=page*PAGE,end=Math.min(base+PAGE,size);
		for(let i=base;i<end;i++){
			let slot=i,v=a?Number(a[i]):0;
			let nl=new Packages.arc.scene.ui.Label('[gray]'+i+'[]');nl.setFontScale(0.65);nl.setAlignment(Packages.arc.util.Align.center);
			let vl=new Packages.arc.scene.ui.Label(memFmt(v));vl.setAlignment(Packages.arc.util.Align.center);vl.setColor(v===0?Packages.arc.graphics.Color.gray:Packages.arc.graphics.Color.white);
			labels.push(vl);
			let cell=new Table(Styles.black3);cell.margin(1);cell.add(nl).center().padTop(2).row();cell.add(vl).center().padBottom(2).row();
			cell.clicked(function(){
				let a2=memGetArr(build);let ed=new BaseDialog('Slot '+slot);let tf=ed.cont.field(a2?memFmt(Number(a2[slot])):'0',null).width(220).get();
				ed.buttons.defaults().size(130,52).pad(2);
				ed.buttons.button('[gray]Cancel[]',function(){ed.hide();});
				ed.buttons.button('[accent]OK[]',function(){let num=parseFloat(tf.getText().trim());if(!isNaN(num)){let a3=memGetArr(build);if(a3){try{a3[slot]=num;}catch(e){try{java.lang.reflect.Array.setDouble(a3,slot,num);}catch(e2){}}}}ed.hide();refreshLabels();});
				Core.app.post(function(){Core.scene.setKeyboardFocus(tf);});ed.show();
			});
			grid.add(cell).width(CW).height(CH).pad(1);
			if((i-base+1)%COLS===0)grid.row();
		}
		grid.pack();win.pack();
	}
	if(nPages>1){let pr=new Table(),pgLbl=new Packages.arc.scene.ui.Label('1/'+nPages);pr.button('[accent]<[]',Styles.cleart,function(){if(curPage>0){curPage--;buildGrid(curPage);pgLbl.setText((curPage+1)+'/'+nPages);}}).size(44,30);pr.add(pgLbl).width(64).center();pr.button('[accent]>[]',Styles.cleart,function(){if(curPage<nPages-1){curPage++;buildGrid(curPage);pgLbl.setText((curPage+1)+'/'+nPages);}}).size(44,30);ct.add(pr).padTop(4).row();}
	let sc=new ScrollPane(grid);sc.setScrollingDisabled(true,false);ct.add(sc).maxWidth(COLS*(CW+2)+20).maxHeight(320).row();
	let _dt=0;ct.update(function(){_dt+=Core.graphics.getDeltaTime();if(_dt>=1){_dt=0;refreshLabels();}});
	buildGrid(0);win.add(ct).row();win.pack();win.setPosition(winData.stageX,winData.stageY,Packages.arc.util.Align.center);Vars.ui.hudGroup.addChild(win);
}

function memShowToolbar(build, tapSX, tapSY){
	if(_memTb&&_memTbId===build.id){_memTb.remove();_memTb=null;_memTbId=-1;_memTbTime=Time.millis();return;}
	if(_memTb){_memTb.remove();_memTb=null;}
	let tbl=new Table();tbl.background(Styles.black5);tbl.margin(4);
	function closeTb(){if(_memTb){_memTb.remove();_memTb=null;_memTbId=-1;_memTbTime=Time.millis();}}
	tbl.button(Icon.menu, Styles.cleari,function(){closeTb();memOpenGrid(build);}).size(40);
	tbl.button(Icon.copy, Styles.cleari,function(){closeTb();memCopyAll(build);}).size(40);
	tbl.button(Icon.paste,Styles.cleari,function(){closeTb();memPasteAll(build,null);}).size(40);
	Vars.ui.hudGroup.addChild(tbl);
	let _tx = tapSX, _ty = tapSY;
	Core.app.post(function(){
		tbl.pack();
		let sw=Core.scene.getWidth(), sh=Core.scene.getHeight();
		let W=tbl.getWidth()>4?tbl.getWidth():128, H=tbl.getHeight()>4?tbl.getHeight():48;
		let x=Math.max(4,Math.min(_tx-W*0.5,sw-W-4));
		let y=_ty-H-20; if(y<4) y=_ty+20;
		tbl.setPosition(x,y);
	});
	_memTb=tbl;_memTbId=build.id;
}

function _memCheckTap(){
	if(!Core.input.justTouched())return;
	try{
		let stagePos = new Packages.arc.math.geom.Vec2(Core.input.mouseX(), Core.input.mouseY());
		Core.scene.screenToStageCoordinates(stagePos);
		let sx = stagePos.x;
		let sy = stagePos.y;
		if(_memTb){
			if(_memTb.getWidth()<=0)_memTb.pack();
			if(sx>=_memTb.x&&sx<=_memTb.x+_memTb.getWidth()&&sy>=_memTb.y&&sy<=_memTb.y+_memTb.getHeight())return;
			_memTb.remove();_memTb=null;_memTbId=-1;_memTbTime=Time.millis();
		}
		if(Core.scene.hasMouse())return;
		if(Time.millis()-_memTbTime<400)return;
		let cf=Vars.control.input.config;if(cf&&cf.isShown())return;
		let tile=Vars.world.tileWorld(Core.input.mouseWorldX(),Core.input.mouseWorldY());
		let b=tile?tile.build:null;if(!b)return;
		if(!MEM_NAMES[String(b.block.name)])return;
		memShowToolbar(b, sx, sy);
	}catch(e){}
}

// ── Processor undo/redo (per-processor history) ──────────────────────────────
let _procHist   = {};  // { id: {undo:[], redo:[]} }
let _undoStack  = [], _redoStack = [], _lastCode = null;
let _ldWasShown = false, _curProcId = 'default';
Events.on(WorldLoadEvent,()=>{_procHist={};_undoStack=[];_redoStack=[];_lastCode=null;_curProcId='default';});

function _switchProc(id){
	_procHist[_curProcId]={undo:_undoStack.slice(),redo:_redoStack.slice()};
	_curProcId=id;
	if(!_procHist[id])_procHist[id]={undo:[],redo:[]};
	_undoStack=_procHist[id].undo;_redoStack=_procHist[id].redo;
}
function _undoProc(ld){if(!_undoStack.length){notify('[lightgray]Nothing to undo');return;}let cur=ld.canvas?ld.canvas.save():null;if(cur)_redoStack.push(cur);let prev=_undoStack.pop();if(ld.canvas)ld.canvas.load(prev);_lastCode=prev;notify('[lightgray]Undo ('+_undoStack.length+' left)');}
function _redoProc(ld){if(!_redoStack.length){notify('[lightgray]Nothing to redo');return;}let cur=ld.canvas?ld.canvas.save():null;if(cur)_undoStack.push(cur);let next=_redoStack.pop();if(ld.canvas)ld.canvas.load(next);_lastCode=next;notify('[lightgray]Redo ('+_redoStack.length+' left)');}


Events.run(Trigger.update, () => {
	let logicDialog = Vars.ui.logic;
	if (logicDialog && logicDialog.isShown()) {
		let editBtn = logicDialog.buttons.find('edit');
		if (editBtn != null && editBtn.name === 'edit') {
			editBtn.name = 'edit_hooked';
			editBtn.addListener(
				extend(ChangeListener, {
					changed(event, actor) {
						Core.app.post(() => {
							let top = Core.scene.root.getChildren().peek();
							if (top instanceof BaseDialog) {
								let scroll = top.cont.getChildren().first();
								if (scroll instanceof ScrollPane) {
									let p = scroll.getWidget();
									if (
										p instanceof Table &&
										p.getChildren().size > 0
									) {
										let t = p.getChildren().first();
										if (t instanceof Table) {
											injectUIButtons(
												t,
												top,
												logicDialog,
												scroll
											);
										}
									}
								}
							}
						});
					},
				})
			);
		}
	}

	let configFragment = Vars.control.input.config;
	if (configFragment && configFragment.isShown()) {
		let build = configFragment.getSelected();
		if (
			build != null &&
			build.block instanceof
				Packages.mindustry.world.blocks.logic.LogicBlock
		) {
			try {
				if (!configTableField) {
					let clazz = configFragment.getClass();
					while (clazz != null) {
						try {
							configTableField = clazz.getDeclaredField('table');
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
							if (child.name === 'restart_processor_btn') {
								hasRestart = true;
								break;
							}
						}
						if (!hasRestart) {
							let newStyle =
								new Packages.arc.scene.ui.ImageButton.ImageButtonStyle(
									Styles.cleari
								);
							let btnTrack =
								new Packages.arc.scene.ui.ImageButton(
									Icon.eyeSmall,
									newStyle
								);
							btnTrack.name = 'track_processor_btn';
							btnTrack.update(() => {
								let tgt = configFragment.getSelected();
								if (tgt) {
									let isTracked = false;
									for (
										let i = 0;
										i < trackedGlobalProcessors.length;
										i++
									) {
										if (
											trackedGlobalProcessors[i].id ===
											tgt.id
										) {
											isTracked = true;
											break;
										}
									}
									btnTrack
										.getImage()
										.setColor(
											isTracked
												? Packages.arc.graphics.Color
														.lime
												: Packages.arc.graphics.Color
														.white
										);
								}
							});
							btnTrack.clicked(() => {
								let tgt = configFragment.getSelected();
								if (
									tgt != null &&
									tgt.block instanceof
										Packages.mindustry.world.blocks.logic
											.LogicBlock
								) {
									let idx = -1;
									for (
										let i = 0;
										i < trackedGlobalProcessors.length;
										i++
									) {
										if (
											trackedGlobalProcessors[i].id ===
											tgt.id
										) {
											idx = i;
											break;
										}
									}
									if (idx === -1) {
										trackedGlobalProcessors.push(tgt);
									} else {
										trackedGlobalProcessors.splice(idx, 1);
									}
								}
							});
							table.add(btnTrack).size(40);

							let btnVars = new Packages.arc.scene.ui.ImageButton(
								Icon.info,
								Styles.cleari
							);
							btnVars.name = 'vars_processor_btn';
							btnVars.clicked(() => {
								let tgt = configFragment.getSelected();
								if (
									tgt != null &&
									tgt.block instanceof
										Packages.mindustry.world.blocks.logic
											.LogicBlock
								) {
									showVariablesWindow(tgt);
								}
							});
							table.add(btnVars).size(40);

							let btnRules =
								new Packages.arc.scene.ui.ImageButton(
									Icon.list,
									Styles.cleari
								);
							btnRules.name = 'rules_processor_btn';
							btnRules.clicked(() => {
								let tgt = configFragment.getSelected();
								if (
									tgt != null &&
									tgt.block instanceof
										Packages.mindustry.world.blocks.logic
											.LogicBlock
								) {
									showTrackerWindow(tgt);
								}
							});
							table.add(btnRules).size(40);

							let btn = new Packages.arc.scene.ui.ImageButton(
								Icon.refresh,
								Styles.cleari
							);
							btn.name = 'restart_processor_btn';
							btn.clicked(() => {
								let target = configFragment.getSelected();
								if (
									target != null &&
									target.block instanceof
										Packages.mindustry.world.blocks.logic
											.LogicBlock
								) {
									target.configure(target.config());
									notify('[green]Processor restarted');
								}
							});
							table.add(btn).size(40);
							table.pack();
						}
					}
				}
			} catch (e) {}
		}
	}

	_memCheckTap();

	// Logic dialog: undo/redo tracking + button inject
	if (logicDialog && logicDialog.isShown()) {
		// Detect fresh open → switch to this processor's history
		if (!_ldWasShown) {
			let _newId = 'default';
			try { let _sel = Vars.control.input.config.getSelected(); if (_sel) _newId = String(_sel.id); } catch(e) {}
			_switchProc(_newId);
			if (logicDialog.canvas) {
				_lastCode = logicDialog.canvas.save();
				if (!_undoStack.length || _undoStack[_undoStack.length-1] !== _lastCode) _undoStack.push(_lastCode);
			}
		}
		_ldWasShown = true;

		// Snapshot on every change
		if (logicDialog.canvas) {
			try {
				let _cur = logicDialog.canvas.save();
				if (_cur !== _lastCode) {
					if (_lastCode != null) { _undoStack.push(_lastCode); if (_undoStack.length > 100) _undoStack.shift(); }
					_redoStack = []; _lastCode = _cur;
				}
			} catch(e) {}
		}

		// Inject ←/→/⚙ once (ONLY if not already present)
		if (logicDialog.buttons && logicDialog.buttons.find('qol_tools_btn') === null) {
			try {
				let ld = logicDialog;
				// Capture native actors + their cell sizes
				let _na = [], _ns = null;
				let _bch = logicDialog.buttons.getChildren();
				let _bcells = logicDialog.buttons.getCells();
				for (let _i = 0; _i < _bch.size; _i++) {
					let _a = _bch.get(_i), _cw = 0, _ch = 0;
					try { let _cc = _bcells.get(_i); _cw = _cc.maxWidth; _ch = _cc.maxHeight; } catch(e2) {}
					_na.push({ a: _a, w: _cw, h: _ch });
					if (!_ns && _a instanceof Packages.arc.scene.ui.TextButton) _ns = _a.getStyle();
				}
				let _bs = _ns || Styles.flatt;

				let undoB = new Packages.arc.scene.ui.TextButton('', _bs);
				try { undoB.image(Icon.left); } catch(e) {}
				undoB.clicked(function() { _undoProc(ld); });
				undoB.name = 'qol_undo_btn';

				let redoB = new Packages.arc.scene.ui.TextButton('', _bs);
				try { redoB.image(Icon.right); } catch(e) {}
				redoB.clicked(function() { _redoProc(ld); });
				redoB.name = 'qol_redo_btn';

				let toolsB = new Packages.arc.scene.ui.TextButton('', _bs);
				try { toolsB.image(Icon.settings); } catch(e) {}
				toolsB.name = 'qol_tools_btn';
				toolsB.clicked(function() {
					let d2=new BaseDialog('[accent]QoL Processor Tools[]');d2.addCloseButton();
					let st2=Styles.flatt,t2=d2.cont;t2.defaults().size(280,56).left().marginLeft(8).pad(2);
					t2.button('Copy with Labels',Icon.copy,st2,function(){d2.hide();let cv=convertJumpsToLabels(ld.canvas.save(),'label');Core.app.setClipboardText(cv.code);Vars.ui.showInfoFade('Copied!');}).row();
					t2.button('Save to QoL',Icon.save,st2,function(){d2.hide();Vars.ui.showTextInput('Save','Name:','',function(nm){if(nm){mlogDir.child(nm+'.txt').writeString(ld.canvas.save());Vars.ui.showInfoFade('Saved: '+nm);}});}).row();
					t2.button('Save Range',Icon.save,st2,function(){d2.hide();Vars.ui.showTextInput('Start','(0-indexed):','',function(s0){let rs=parseInt(s0);if(isNaN(rs))return;Vars.ui.showTextInput('End','(0-indexed):','',function(s1){let re2=parseInt(s1);if(isNaN(re2))return;let rc=convertRangeJumpsToLabels(ld.canvas.save(),rs,re2,'lbl_');let c2=new BaseDialog('Save Range');c2.addCloseButton();c2.cont.defaults().size(260,52).pad(4);c2.cont.button('Save to file',Icon.save,st2,function(){c2.hide();Vars.ui.showTextInput('Name:','','',function(n2){if(n2){mlogDir.child(n2+'.txt').writeString(rc);Vars.ui.showInfoFade('Saved: '+n2);}});}).row();c2.cont.button('Copy clipboard',Icon.copy,st2,function(){c2.hide();Core.app.setClipboardText(rc);Vars.ui.showInfoFade('Copied!');}).row();c2.show();});});}).row();
					t2.button('Load from QoL',Icon.download,st2,function(){d2.hide();let fd=new BaseDialog('Load');fd.addCloseButton();let lt=new Table();getMlogFiles().forEach(function(file){let r2=new Table();r2.button(file.nameWithoutExtension(),function(){try{ld.canvas.load(file.readString());fd.hide();}catch(err){notify('[scarlet]'+err);}}).size(300,50);r2.button(Icon.trash,function(){Vars.ui.showConfirm('Delete','Delete '+file.name()+'?',function(){file.delete();fd.hide();});}).size(50,50);lt.add(r2).padBottom(5).row();});fd.cont.add(new ScrollPane(lt)).width(400).height(400);fd.show();}).row();
					t2.button('Insert Code',Icon.add,st2,function(){d2.hide();Vars.ui.showTextInput('Insert After Line','(-1=start):','',function(ls){let ia=parseInt(ls);if(isNaN(ia))return;let id2=new BaseDialog('Source');id2.addCloseButton();let it=new Table();it.button('From Clipboard',Icon.paste,st2,function(){id2.hide();performInsert(ld,ia,Core.app.getClipboardText());}).size(280,60).row();it.button('From QoL File',Icon.folder,st2,function(){id2.hide();let ifd=new BaseDialog('File');ifd.addCloseButton();let ift=new Table();getMlogFiles().forEach(function(f){ift.button(f.nameWithoutExtension(),function(){ifd.hide();performInsert(ld,ia,f.readString());}).size(300,50).row();});ifd.cont.add(new ScrollPane(ift)).width(400).height(400);ifd.show();}).size(280,60).row();id2.cont.add(it);id2.show();});}).row();
					t2.button('Replace Code',Icon.edit,st2,function(){d2.hide();let rd=new BaseDialog('Replace');rd.addCloseButton();let rt=new Table();rt.add('Find:').left().row();let fa=new Packages.arc.scene.ui.TextArea('');rt.add(fa).width(600).height(100).row();rt.add('Replace with:').left().padTop(8).row();let ra=new Packages.arc.scene.ui.TextArea('');rt.add(ra).width(600).height(100).row();rt.button('Replace',function(){performReplace(ld,fa.getText(),ra.getText());rd.hide();}).size(200,50).row();rd.cont.add(new ScrollPane(rt)).width(640).height(400);rd.show();}).row();
					d2.show();
				});

				// Rebuild in order: [←][→][natives with orig sizes][⚙]
				logicDialog.buttons.clearChildren();
				logicDialog.buttons.add(undoB).size(38, 40).pad(1);
				logicDialog.buttons.add(redoB).size(38, 40).pad(1);
				for (let _ri = 0; _ri < _na.length; _ri++) {
					let _e = _na[_ri];
					let _rc = logicDialog.buttons.add(_e.a);
					if (_e.w > 0 && _e.h > 0) {
						let w = _e.w;
						if (w > 110) w = 110;
						_rc.size(w, _e.h);
					}
				}
				logicDialog.buttons.add(toolsB).size(38, 40).pad(1);
				logicDialog.buttons.pack();
			} catch(e) {}
		}
	} else {
		if (_ldWasShown) _switchProc('default'); // save history on close
		_ldWasShown = false;
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
					notify('[scarlet]Target belongs to another team');
				} else {
					let bName = build.block.name;
					if (
						bName === 'micro-processor' ||
						bName === 'logic-processor' ||
						bName === 'hyper-processor'
					) {
						injectCode(build, pendingMlog);
					} else {
						notify('[scarlet]Target is not a processor');
					}
				}
			} else {
				notify('[scarlet]Invalid target');
			}
			pendingMlog = null;
			wasShooting = false;
		}
	}
});

Events.run(Packages.mindustry.game.EventType.Trigger.draw, () => {
	if (playerDrawLines.length === 0 && trackedGlobalProcessors.length === 0)
		return;

	Packages.arc.graphics.g2d.Draw.draw(
		130,
		new java.lang.Runnable({
			run: function () {
				let font =
					Packages.mindustry.ui.Fonts.outline ||
					Packages.mindustry.ui.Fonts.def;
				if (!font) return;

				for (let i = 0; i < playerDrawLines.length; i++) {
					let entry = playerDrawLines[i];
					let trg = entry.obj;
					if (
						!trg ||
						(typeof trg.isValid === 'function' && !trg.isValid()) ||
						trg.dead
					) {
						playerDrawLines.splice(i, 1);
						i--;
						continue;
					}

					let p = Vars.player;
					let px = Core.camera.position.x;
					let py = Core.camera.position.y;
					if (p && p.unit()) {
						px = p.unit().x;
						py = p.unit().y;
					}

					let ox =
						trg.x !== undefined && typeof trg.x !== 'function'
							? Number(trg.x)
							: trg.getX !== undefined
								? Number(trg.getX())
								: null;
					let oy =
						trg.y !== undefined && typeof trg.y !== 'function'
							? Number(trg.y)
							: trg.getY !== undefined
								? Number(trg.getY())
								: null;

					if (
						ox !== null &&
						oy !== null &&
						!Number.isNaN(ox) &&
						!Number.isNaN(oy)
					) {
						Packages.arc.graphics.g2d.Draw.color(
							Packages.arc.graphics.Color.valueOf('ffaa44')
						);
						Packages.arc.graphics.g2d.Draw.alpha(0.5);
						Packages.arc.graphics.g2d.Lines.stroke(1);
						Packages.arc.graphics.g2d.Lines.line(px, py, ox, oy);

						if (font && entry.vars && entry.vars.length > 0) {
							font.setColor(
								Packages.arc.graphics.Color.valueOf('ffaa44')
							);
							let osX = font.getScaleX();
							let osY = font.getScaleY();
							font.getData().setScale(0.25);

							let hitSize = 8;
							if (
								trg.hitSize !== undefined &&
								typeof trg.hitSize !== 'function'
							)
								hitSize = Number(trg.hitSize);
							else if (
								trg.hitSize !== undefined &&
								typeof trg.hitSize === 'function'
							)
								hitSize = Number(trg.hitSize());
							else if (trg.block && trg.block.size)
								hitSize = trg.block.size * 8;

							font.draw(
								entry.vars.join('\n'),
								ox,
								oy + hitSize / 2 + 6 + entry.vars.length * 4,
								Packages.arc.util.Align.center
							);
							font.getData().setScale(osX, osY);
						}
					}
				}

				if (trackedGlobalProcessors.length === 0) {
					Packages.arc.graphics.g2d.Draw.reset();
					return;
				}

				for (let i = 0; i < trackedGlobalProcessors.length; i++) {
					let b = trackedGlobalProcessors[i];
					if (!b.isValid()) {
						trackedGlobalProcessors.splice(i, 1);
						i--;
						continue;
					}

					let exec = b.executor;
					if (!exec || !exec.vars) continue;

					let linksAndVars = [];

					if (b.links) {
						for (let j = 0; j < b.links.size; j++) {
							let link = b.links.get(j);
							let linkedBlock = Vars.world.build(link.x, link.y);
							if (linkedBlock) {
								linksAndVars.push({
									obj: linkedBlock,
									name: link.name,
								});
							}
						}
					}

					for (let j = 0; j < exec.vars.length; j++) {
						let v = exec.vars[j];
						if (!v || v.name.startsWith('___')) continue;
						let obj = getObjectVal(v);
						if (obj != null) {
							linksAndVars.push({ obj: obj, name: v.name });
						}
					}

					let allUnits = Packages.mindustry.gen.Groups.unit;
					allUnits.each(
						cons((u) => {
							if (
								u.controller() instanceof
									Packages.mindustry.ai.types.LogicAI &&
								u.controller().controller === b
							) {
								linksAndVars.push({ obj: u, name: null });
							}
						})
					);

					let grouped = [];
					for (let j = 0; j < linksAndVars.length; j++) {
						let item = linksAndVars[j];
						let g = null;
						for (let k = 0; k < grouped.length; k++) {
							if (grouped[k].obj === item.obj) {
								g = grouped[k];
								break;
							}
						}
						if (g) {
							if (item.name && g.names.indexOf(item.name) === -1)
								g.names.push(item.name);
						} else {
							grouped.push({
								obj: item.obj,
								names: item.name ? [item.name] : [],
							});
						}
					}

					for (let j = 0; j < grouped.length; j++) {
						let g = grouped[j];
						let obj = g.obj;
						let ox =
							obj.x !== undefined && typeof obj.x !== 'function'
								? Number(obj.x)
								: obj.getX !== undefined
									? Number(obj.getX())
									: null;
						let oy =
							obj.y !== undefined && typeof obj.y !== 'function'
								? Number(obj.y)
								: obj.getY !== undefined
									? Number(obj.getY())
									: null;

						let hitSize = 0;
						if (
							obj.hitSize !== undefined &&
							typeof obj.hitSize !== 'function'
						)
							hitSize = Number(obj.hitSize);
						else if (
							obj.hitSize !== undefined &&
							typeof obj.hitSize === 'function'
						)
							hitSize = Number(obj.hitSize());
						else if (obj.block && obj.block.size)
							hitSize = obj.block.size * 8;

						if (ox !== null && oy !== null) {
							let text = g.names.join('\n');
							if (typeof obj.flag === 'number') {
								text +=
									(text.length > 0 ? '\n' : '') +
									'[lightgray]flag: ' +
									Math.floor(obj.flag * 10) / 10 +
									'[]';
							}

							Packages.arc.graphics.g2d.Draw.color(
								Packages.arc.graphics.Color.valueOf('91ff9e')
							);
							Packages.arc.graphics.g2d.Draw.alpha(0.5);
							Packages.arc.graphics.g2d.Lines.stroke(1);
							Packages.arc.graphics.g2d.Lines.line(
								b.x,
								b.y,
								ox,
								oy
							);
							font.setColor(Packages.arc.graphics.Color.white);
							let osX = font.getScaleX();
							let osY = font.getScaleY();
							font.getData().setScale(0.25);
							font.draw(
								text,
								ox,
								oy + hitSize / 2 + 6 + g.names.length * 4,
								Packages.arc.util.Align.center
							);
							font.getData().setScale(osX, osY);
						}
					}
				}

				Packages.arc.graphics.g2d.Draw.reset();
			},
		})
	);
});

interceptor.add('mlog', (args) => {
	if (args.length < 2) {
		notify(
			'[lightgray]!mlog list\n!mlog <filename>\n!mlog <filename> set\n!mlog remove <filename>'
		);
		return;
	}

	let subcmd = args[1].toLowerCase();

	if (subcmd === 'list') {
		let files = getMlogFiles();
		if (files.length > 0) {
			notify(
				'[lightgrey]Available files:\n- ' +
					files.map((f) => f.nameWithoutExtension()).join('\n- ')
			);
		} else {
			notify('[scarlet]No .txt files found in qol/mlog/ folder');
		}
		return;
	}

	if (subcmd === 'remove' && args.length >= 3) {
		let targetName = args[2];
		let f = mlogDir.child(targetName + '.txt');
		if (f.exists()) {
			f.delete();
			notify('[green]Deleted [lightgray]' + targetName + '.txt');
		} else {
			notify('[scarlet]File not found [lightgray]' + targetName + '.txt');
		}
		return;
	}

	let mode = args[2] ? args[2].toLowerCase() : '';
	let mlogFile = mlogDir.child(args[1] + '.txt');

	if (!mlogFile.exists()) {
		notify(
			'[scarlet]File not found [lightgray]qol/mlog/' + args[1] + '.txt'
		);
		return;
	}

	let code = mlogFile.readString();

	if (mode === 'set') {
		pendingMlog = code;
		wasShooting = false;
		notify('[lightgrey]Start and stop shooting at the target processor');
	} else {
		let target = null;
		Groups.build.each(
			cons((b) => {
				if (!target && b.team == Vars.player.team()) {
					let bName = b.block.name;
					if (
						bName === 'micro-processor' ||
						bName === 'logic-processor' ||
						bName === 'hyper-processor'
					) {
						if (b.code == null || String(b.code) === '') {
							target = b;
						}
					}
				}
			})
		);

		if (target != null) {
			injectCode(target, code);
		} else {
			notify('[scarlet]No empty processors found on your team');
		}
	}
});
