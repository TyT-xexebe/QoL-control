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

	if (scrollPane) scrollPane.setScrollingDisabled(true, false);

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
let playerDrawLines = [];

Events.on(Packages.mindustry.game.EventType.WorldLoadEvent, () => {
	trackedGlobalProcessors = [];
	trackerRules = [];
	trackerWindows.forEach((w) => w.table.remove());
	trackerWindows = [];
	varsWindows.forEach((w) => w.table.remove());
	varsWindows = [];
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
				let w = trackerWindow.getWidth();
				let h = trackerWindow.getHeight();
				if (nX - w / 2 < 0) nX = w / 2;
				if (nY - h / 2 < 0) nY = h / 2;
				if (nX + w / 2 > Core.graphics.getWidth())
					nX = Core.graphics.getWidth() - w / 2;
				if (nY + h / 2 > Core.graphics.getHeight())
					nY = Core.graphics.getHeight() - h / 2;
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
		let w = trackerWindow.getWidth();
		let h = trackerWindow.getHeight();
		if (winData.stageX - w / 2 < 0) winData.stageX = w / 2;
		if (winData.stageY - h / 2 < 0) winData.stageY = h / 2;
		if (winData.stageX + w / 2 > Core.graphics.getWidth())
			winData.stageX = Core.graphics.getWidth() - w / 2;
		if (winData.stageY + h / 2 > Core.graphics.getHeight())
			winData.stageY = Core.graphics.getHeight() - h / 2;
		trackerWindow.setPosition(
			winData.stageX,
			winData.stageY,
			Packages.arc.util.Align.center
		);
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

function checkCondition(val, op, targetStr, exec, procBlock, rule) {
	let t;
	if (targetStr.startsWith('"') && targetStr.endsWith('"')) {
		t = targetStr.substring(1, targetStr.length - 1);
	} else if (targetStr.startsWith("'") && targetStr.endsWith("'")) {
		t = targetStr.substring(1, targetStr.length - 1);
	} else {
		let foundLink = false;
		if (procBlock && procBlock.links) {
			for (let j = 0; j < procBlock.links.size; j++) {
				let link = procBlock.links.get(j);
				if (link.name === targetStr) {
					t = Vars.world.build(link.x, link.y);
					foundLink = true;
					break;
				}
			}
		}
		if (!foundLink) {
			let tv = getExecVar(exec, targetStr);
			if (tv) {
				t = getObjectVal(tv);
			} else {
				let parsed = parseFloat(targetStr);
				t = isNaN(parsed) ? targetStr : parsed;
			}
		}
	}

	if (op === '==' || op === '===' || op === '!=' || op === '!==') {
		let eq = false;
		if (val != null && typeof val === 'object') {
			if (typeof val.equals === 'function' && val.equals(t)) {
				eq = true;
			} else if (typeof t === 'string') {
				let nameStr = t.startsWith('@') ? t.substring(1) : t;
				if (
					val.name === nameStr ||
					(val.block && val.block.name === nameStr) ||
					(val.type && val.type.name === nameStr)
				) {
					eq = true;
				}
			}
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
	return false;
}

function getObjectVal(v) {
	if (!v) return null;
	if (v.isobj !== undefined) return v.isobj ? v.objval : v.numval;
	return v.objval != null ? v.objval : v.numval;
}

function getExecVar(exec, name) {
	if (!exec || !exec.vars) return null;
	let nStr = String(name);
	for (let i = 0; i < exec.vars.length; i++) {
		if (exec.vars[i] && String(exec.vars[i].name) === nStr) {
			return exec.vars[i];
		}
	}
	return null;
}

function showTrackerWindow(target) {
	let wData = createDraggableWindow(
		'Processor Tracker',
		target,
		trackerWindows
	);
	let trackerWindow = wData.winWindow;
	let winData = wData.winData;
	let dragger = wData.dragger;
	let contentTable = wData.contentTable;

	let pauseBtn = dragger
		.button(Icon.pause, Styles.cleari, () => {
			target.enabled = !target.enabled;
		})
		.size(32)
		.pad(2)
		.get();
	pauseBtn.update(() => {
		pauseBtn.getStyle().imageUp = target.enabled ? Icon.pause : Icon.play;
	});

	dragger
		.button(Icon.refresh, Styles.cleari, () => {
			target.configure(target.config());
		})
		.size(32)
		.pad(2);

	dragger.add(wData.collapseBtn).size(32).pad(2);

	dragger
		.button(Icon.cancel, Styles.cleari, () => {
			trackerWindow.remove();
			let idx = trackerWindows.indexOf(winData);
			if (idx !== -1) trackerWindows.splice(idx, 1);
			for (let i = playerDrawLines.length - 1; i >= 0; i--) {
				if (
					typeof playerDrawLines[i].id === 'object' &&
					playerDrawLines[i].id.proc === target
				) {
					playerDrawLines.splice(i, 1);
				}
			}
			let tkIdx = -1;
			for (let k = 0; k < trackedGlobalProcessors.length; k++) {
				if (trackedGlobalProcessors[k].id === target.id) {
					tkIdx = k;
					break;
				}
			}
			if (tkIdx !== -1) trackedGlobalProcessors.splice(tkIdx, 1);
		})
		.size(32)
		.pad(2)
		.right();

	contentTable.background(Styles.black5);

	let content = new Table();
	let addRow = new Table();

	let rebuildRules = () => {
		content.clearChildren();
		let procRules = trackerRules.filter((r) => r.proc.id === target.id);

		if (procRules.length === 0) {
			content.add('[lightgray]No variables tracked yet[]').pad(10);
			trackerWindow.pack();
			return;
		}

		procRules.forEach((r) => {
			let row = new Table(Styles.black3);
			let valLabel = new Packages.arc.scene.ui.Label('...');
			valLabel.setWrap(true);

			let targetBtnContainer = new Table();
			let hasObjBtn = false;
			let lastObj = null;

			valLabel.update(() => {
				if (!target.isValid()) {
					valLabel.setText(r.varName + ' = ?');
					targetBtnContainer.clearChildren();
					hasObjBtn = false;
					return;
				}
				let exec = r.proc.executor;
				let v = getExecVar(exec, r.varName);
				if (!v) {
					valLabel.setText(r.varName + ' = ?');
					targetBtnContainer.clearChildren();
					hasObjBtn = false;
					return;
				}

				let curVal = getObjectVal(v);
				let c = checkCondition(
					curVal,
					r.condType,
					r.condValue,
					exec,
					r.proc,
					r
				);

				let triggered = c && !r.lastCond;
				r.lastCond = c;

				if (triggered) {
					if (r.action === 'count') {
						r.counter++;
					} else if (r.action === 'notify') {
						notify(
							'[lightgray]Proc ' +
								target.id +
								'[]: ' +
								r.varName +
								' [green]triggered[] -> ' +
								curVal
						);
					} else if (r.action === 'camera') {
						let tx = target.x;
						let ty = target.y;
						if (r.actionArg) {
							let parts = String(r.actionArg).split(',');
							if (parts.length >= 2) {
								let vx = getExecVar(exec, parts[0].trim());
								let vy = getExecVar(exec, parts[1].trim());
								let nx = vx
									? getObjectVal(vx)
									: Number(parts[0].trim());
								let ny = vy
									? getObjectVal(vy)
									: Number(parts[1].trim());
								if (!Number.isNaN(nx) && !Number.isNaN(ny)) {
									tx = nx * 8;
									ty = ny * 8;
								}
							}
						} else if (
							curVal instanceof Packages.mindustry.gen.Building ||
							curVal instanceof Packages.mindustry.gen.Unit
						) {
							tx = curVal.x;
							ty = curVal.y;
						}
						Core.camera.position.set(tx, ty);
					} else if (r.action === 'pause') {
						r.proc.enabled = false;
					}
				}

				r.lastVal = curVal;

				let color =
					c && r.action === 'highlight' ? '[green]' : '[lightgray]';
				let objType = false;

				let dispVal = '' + curVal;
				if (curVal != null && typeof curVal === 'object') {
					if (
						curVal instanceof Packages.mindustry.gen.Building ||
						curVal instanceof Packages.mindustry.gen.Unit
					) {
						objType = true;
						if (curVal instanceof Packages.mindustry.gen.Building) {
							dispVal = 'Block(' + curVal.block.name + ')';
						} else {
							let un = curVal.type ? curVal.type.name : 'Unit';
							dispVal = un + '[' + curVal.id + ']';
						}
					}
				}

				let txt =
					color +
					r.varName +
					' ' +
					r.condType +
					' ' +
					r.condValue +
					' -> ' +
					dispVal +
					'[]';
				if (r.action === 'count') {
					txt += ' [orange](' + r.counter + ')[]';
				} else if (r.action !== 'none') {
					txt +=
						' [accent](' +
						r.action +
						(r.actionArg ? ' ' + r.actionArg : '') +
						')[]';
				}
				valLabel.setText(txt);

				if (objType != hasObjBtn || lastObj !== curVal) {
					hasObjBtn = objType;
					lastObj = curVal;
					targetBtnContainer.clearChildren();
					if (objType) {
						let btn = targetBtnContainer
							.button(Icon.eyeSmall, Styles.clearTogglei, () => {
								togglePlayerDrawLine(lastObj, [r.varName], r);
							})
							.size(32)
							.pad(2)
							.get();
						btn.update(() => {
							btn.setChecked(isPlayerDrawLine(r));
						});
					}
				}
			});
			valLabel.setAlignment(Packages.arc.util.Align.left);

			row.add(valLabel).minWidth(300).growX().padLeft(8);
			row.add(targetBtnContainer).minWidth(34).padRight(4);
			row.button(Icon.cancel, Styles.cleari, () => {
				let idx = trackerRules.indexOf(r);
				if (idx !== -1) trackerRules.splice(idx, 1);
				removePlayerDrawLine(r);
				row.remove();
				trackerWindow.pack();
			})
				.size(32)
				.pad(2)
				.right();

			content.add(row).growX().padBottom(2).row();
		});

		trackerWindow.pack();
	};

	let varField = new Packages.arc.scene.ui.TextField('');
	varField.setMessageText('Var (@unit)');

	let opIdx = 0;
	let opBtn = new Packages.arc.scene.ui.TextButton('==', Styles.cleart);
	let ops = [
		'==',
		'!=',
		'>',
		'<',
		'>=',
		'<=',
		'changed',
		'typeof',
		'contains',
	];
	opBtn.clicked(() => {
		let t = new Table(Styles.black5);
		let overlay = new Table();
		overlay.touchable = Packages.arc.scene.event.Touchable.enabled;
		overlay.clicked(() => {
			t.remove();
			overlay.remove();
		});
		overlay.fillParent = true;
		Core.scene.add(overlay);

		ops.forEach((o, i) => {
			t.button(o, Styles.cleart, () => {
				opIdx = i;
				opBtn.setText(o);
				t.remove();
				overlay.remove();
			})
				.size(80, 40)
				.row();
		});
		t.pack();
		t.update(() => {
			let nPos = opBtn.localToStageCoordinates(
				new Packages.arc.math.geom.Vec2(0, 0)
			);
			t.setPosition(nPos.x, nPos.y, Packages.arc.util.Align.topLeft);
			if (!trackerWindow.parent) {
				t.remove();
				overlay.remove();
			}
		});
		Core.scene.add(t);
	});

	let valField = new Packages.arc.scene.ui.TextField('0');
	valField.setMessageText('Value');

	let argField = new Packages.arc.scene.ui.TextField('');
	argField.setMessageText('x,y or obj');

	let rebuildAddRow;

	let actionBtn = new Packages.arc.scene.ui.TextButton(
		'Action: None',
		Styles.cleart
	);
	let actions = ['none', 'pause', 'highlight', 'count', 'notify', 'camera'];
	let actionIdx = 0;
	actionBtn.clicked(() => {
		let actMenu = new Table(Styles.black5);
		let actOverlay = new Table();
		actOverlay.touchable = Packages.arc.scene.event.Touchable.enabled;
		actOverlay.clicked(() => {
			actMenu.remove();
			actOverlay.remove();
		});
		actOverlay.fillParent = true;
		Core.scene.add(actOverlay);

		actions.forEach((a, i) => {
			actMenu
				.button(
					a.charAt(0).toUpperCase() + a.slice(1),
					Styles.cleart,
					() => {
						actionIdx = i;
						actionBtn.setText('Action: ' + actions[actionIdx]);
						actMenu.remove();
						actOverlay.remove();
						rebuildAddRow();
					}
				)
				.size(150, 40)
				.row();
		});
		actMenu.pack();
		actMenu.update(() => {
			let nPos = actionBtn.localToStageCoordinates(
				new Packages.arc.math.geom.Vec2(0, 0)
			);
			actMenu.setPosition(
				nPos.x,
				nPos.y,
				Packages.arc.util.Align.topLeft
			);
			if (!trackerWindow.parent) {
				actMenu.remove();
				actOverlay.remove();
			}
		});
		Core.scene.add(actMenu);
	});

	rebuildAddRow = () => {
		addRow.clearChildren();

		let isCam = actions[actionIdx] === 'camera';

		addRow
			.add(varField)
			.width(isCam ? 80 : 110)
			.height(40)
			.pad(2);
		addRow
			.add(opBtn)
			.width(isCam ? 60 : 80)
			.height(40)
			.pad(2);
		addRow
			.add(valField)
			.width(isCam ? 60 : 75)
			.height(40)
			.pad(2);
		addRow
			.add(actionBtn)
			.width(isCam ? 80 : 110)
			.height(40)
			.pad(2);

		if (isCam) {
			addRow.add(argField).width(75).height(40).pad(2);
		}

		addRow
			.button(Icon.add, Styles.cleari, () => {
				let vText = varField.getText();
				if (vText && vText.length > 0) {
					trackerRules.push({
						proc: target,
						varName: vText,
						condType: ops[opIdx],
						condValue: valField.getText(),
						action: actions[actionIdx],
						actionArg:
							actions[actionIdx] === 'camera'
								? argField.getText()
								: undefined,
						counter: 0,
						lastVal: null,
						lastCond: false,
					});
					rebuildRules();
					trackerWindow.pack();
				}
			})
			.size(40)
			.pad(2);
	};

	rebuildAddRow();

	rebuildRules();
	contentTable.add(content).growX().pad(4).row();
	contentTable.add(addRow).growX().padTop(4).padBottom(4).row();

	trackerWindow.add(contentTable).growX().row();

	trackerWindow.pack();
	trackerWindow.setPosition(
		winData.stageX,
		winData.stageY,
		Packages.arc.util.Align.center
	);
	Core.scene.add(trackerWindow);
}

function showVariablesWindow(target) {
	let wData = createDraggableWindow('Variables', target, varsWindows);
	let trackerWindow = wData.winWindow;
	let winData = wData.winData;
	let dragger = wData.dragger;
	let contentTable = wData.contentTable;

	let pauseBtn = dragger
		.button(Icon.pause, Styles.cleari, () => {
			target.enabled = !target.enabled;
		})
		.size(32)
		.pad(2)
		.get();
	pauseBtn.update(() => {
		pauseBtn.getStyle().imageUp = target.enabled ? Icon.pause : Icon.play;
	});

	dragger
		.button(Icon.refresh, Styles.cleari, () => {
			target.configure(target.config());
		})
		.size(32)
		.pad(2);

	dragger.add(wData.collapseBtn).size(32).pad(2);

	dragger
		.button(Icon.cancel, Styles.cleari, () => {
			trackerWindow.remove();
			let idx = varsWindows.indexOf(winData);
			if (idx !== -1) varsWindows.splice(idx, 1);
			for (let i = playerDrawLines.length - 1; i >= 0; i--) {
				if (
					typeof playerDrawLines[i].id === 'string' &&
					playerDrawLines[i].id.startsWith('var_' + target.id + '_')
				) {
					playerDrawLines.splice(i, 1);
				}
			}
			let tkIdx = -1;
			for (let k = 0; k < trackedGlobalProcessors.length; k++) {
				if (trackedGlobalProcessors[k].id === target.id) {
					tkIdx = k;
					break;
				}
			}
			if (tkIdx !== -1) trackedGlobalProcessors.splice(tkIdx, 1);
		})
		.size(32)
		.pad(2)
		.right();

	contentTable.background(Styles.black5);

	let content = new Table();
	let scrollPane = new ScrollPane(content);

	let rebuildVars = () => {
		content.clearChildren();
		if (!target.isValid() || !target.executor || !target.executor.vars)
			return;

		let execVars = [];
		if (target.executor && target.executor.vars) {
			for (let i = 0; i < target.executor.vars.length; i++) {
				let v = target.executor.vars[i];
				if (v)
					execVars.push({ name: v.name, isBuffer: false, vRef: v });
			}
		}
		if (target.executor && target.executor.textBuffer !== undefined) {
			execVars.push({ name: '@buffer', isBuffer: true });
		}
		execVars.push({
			name: '@thisx',
			isProp: true,
			propVal: () => target.x / 8,
		});
		execVars.push({
			name: '@thisy',
			isProp: true,
			propVal: () => target.y / 8,
		});
		if (target.links != null)
			execVars.push({
				name: '@links',
				isProp: true,
				propVal: () => target.links.size,
			});
		if (target.executor && target.executor.iptr !== undefined)
			execVars.push({
				name: '@counter',
				isProp: true,
				propVal: () => target.executor.iptr,
			});

		if (execVars.length === 0) {
			content.add('[lightgray]No variables[]').pad(10);
		} else {
			for (let i = 0; i < execVars.length; i++) {
				let vData = execVars[i];

				let row = new Table(Styles.black3);
				let valLabel = new Packages.arc.scene.ui.Label('...');
				valLabel.setWrap(true);

				let targetBtnContainer = new Table();
				let hasObjBtn = false;
				let lastObj = null;

				valLabel.update(() => {
					if (!target.isValid() || !target.executor) return;

					let cVal = null;
					let objType = false;
					let dispVal = '';

					if (vData.isBuffer) {
						cVal = String(
							target.executor.textBuffer.toString() || ''
						);
						dispVal = cVal;
					} else if (vData.isProp) {
						cVal = vData.propVal();
						dispVal =
							typeof cVal === 'number' && Math.abs(cVal % 1) > 0
								? formatFloat(cVal)
								: '' + cVal;
					} else {
						let cVar = getExecVar(target.executor, vData.name);
						if (!cVar) return;
						cVal = getObjectVal(cVar);
						dispVal = '' + cVal;

						if (cVal != null && typeof cVal === 'object') {
							if (
								cVal instanceof
									Packages.mindustry.gen.Building ||
								cVal instanceof Packages.mindustry.gen.Unit
							) {
								objType = true;
								if (
									cVal instanceof
									Packages.mindustry.gen.Building
								) {
									dispVal = 'Block(' + cVal.block.name + ')';
								} else {
									let un = cVal.type
										? cVal.type.name
										: 'Unit';
									dispVal = un + '[' + cVal.id + ']';
								}
							}
						} else if (
							typeof cVal === 'number' &&
							Math.abs(cVal % 1) > 0
						) {
							dispVal = formatFloat(cVal);
						}
					}

					valLabel.setText(
						'[lightgray]' + vData.name + '[]: ' + dispVal
					);

					if (
						!vData.isBuffer &&
						!vData.isProp &&
						(objType != hasObjBtn || lastObj !== cVal)
					) {
						hasObjBtn = objType;
						lastObj = cVal;
						targetBtnContainer.clearChildren();
						if (objType) {
							let btnId = 'var_' + target.id + '_' + vData.name;
							let btn = targetBtnContainer
								.button(
									Icon.eyeSmall,
									Styles.clearTogglei,
									() => {
										togglePlayerDrawLine(
											lastObj,
											[vData.name],
											btnId
										);
									}
								)
								.size(30)
								.pad(2)
								.get();
							btn.update(() => {
								btn.setChecked(isPlayerDrawLine(btnId));
							});
						}
					}
				});
				valLabel.setAlignment(Packages.arc.util.Align.left);

				row.add(valLabel).minWidth(260).growX().padLeft(8);
				row.add(targetBtnContainer).minWidth(34).padRight(4);

				content.add(row).growX().padBottom(2).row();
			}
		}
	};

	let rebuildTimer = 0;
	let lastVarCount = 0;
	contentTable.update(() => {
		rebuildTimer += Core.graphics.getDeltaTime();
		if (rebuildTimer > 60) {
			rebuildTimer = 0;
			let currentLen =
				target.executor && target.executor.vars
					? target.executor.vars.length
					: 0;
			if (lastVarCount !== currentLen) {
				lastVarCount = currentLen;
				rebuildVars();
			}
		}
	});

	rebuildVars();
	lastVarCount =
		target.executor && target.executor.vars
			? target.executor.vars.length
			: 0;

	contentTable
		.add(scrollPane)
		.growX()
		.growY()
		.width(340)
		.maxHeight(400)
		.row();
	trackerWindow.add(contentTable).growX().row();

	trackerWindow.pack();
	trackerWindow.setPosition(
		winData.stageX,
		winData.stageY,
		Packages.arc.util.Align.center
	);
	Core.scene.add(trackerWindow);
}

Events.on(ClientLoadEvent, () => initFiles());

let configTableField = null;

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
