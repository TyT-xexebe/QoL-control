const notify = require('qol-control/core/logger').notify;
const interceptor = require('qol-control/core/interceptor');

let trackEnabled = Core.settings.getBool('qol-track-enabled', false);
let trackRtsEnabled = Core.settings.getBool('qol-track-rts', true);
let trackRecEnabled = Core.settings.getBool('qol-track-rec', true);
let trackRtsNotify = Core.settings.getBool('qol-track-rts-notify', true);
let trackedPlayer = null;

let unitCommanders = {};
let unitScanTimer = 0;

let rtsHistory = {};

let rallyPoints = [];
let rallyScanTimer = 0;
let lastRallyPoints = {};

const getPlayerObj = (obj) => {
	if (!obj) return null;
	if (obj instanceof Packages.mindustry.gen.Player) return obj;
	if (obj.isPlayer && obj.isPlayer()) return obj.getPlayer();
	return null;
};

Events.on(WorldLoadEvent, () => {
	unitCommanders = {};
	rallyPoints = [];
	rtsHistory = {};
	lastRallyPoints = {};
});

Events.run(Trigger.update, () => {
	if (!trackEnabled) return;

	if (trackRtsEnabled) {
		unitScanTimer += Time.delta;
		if (unitScanTimer > 15) {
			unitScanTimer = 0;
			let newCommanders = {};

			let hasCommandAI = false;
			try {
				if (Packages.mindustry.ai.types.CommandAI) hasCommandAI = true;
			} catch (e) {}

			Groups.unit.each((u) => {
				let p = null;
				let ctrl = u.controller();

				if (u.lastCommanded) {
					let cmdrName = String(u.lastCommanded);
					Groups.player.each((player) => {
						if (
							String(player.coloredName()) === cmdrName ||
							String(player.name) === cmdrName
						) p = player;
					});
				}

				if (!p && ctrl instanceof Packages.mindustry.ai.types.FormationAI) {
					let leader = ctrl.leader;
					if (leader && leader.isPlayer && leader.isPlayer())
						p = getPlayerObj(leader);
				}

				if (!p && hasCommandAI && ctrl instanceof Packages.mindustry.ai.types.CommandAI) {
					let cmdr = ctrl.commander;
					if (cmdr && cmdr.isPlayer && cmdr.isPlayer())
						p = getPlayerObj(cmdr);
				}

				if (!p && u.team === Vars.player.team() &&
					Vars.control && Vars.control.input &&
					Vars.control.input.selectedUnits.contains(u)
				) {
					p = Vars.player;
				}

				if (p) {
					let tx = null, ty = null;
					try {
						if (ctrl instanceof Packages.mindustry.ai.types.FormationAI && ctrl.leader) {
							tx = ctrl.leader.x; ty = ctrl.leader.y;
						} else if (ctrl.targetPos && ctrl.targetPos.x !== undefined) {
							tx = ctrl.targetPos.x; ty = ctrl.targetPos.y;
						} else if (u.targetFlag && u.targetFlag.x !== undefined) {
							tx = u.targetFlag.x; ty = u.targetFlag.y;
						} else if (ctrl.target && ctrl.target.x !== undefined) {
							tx = ctrl.target.x; ty = ctrl.target.y;
						}
					} catch (e) {}

					let isMining = false;
					try { if (u.mining && u.mining()) isMining = true; } catch (e) {}

					if (tx !== null && ty !== null && !isMining && (tx !== 0 || ty !== 0)) {
						if (Math.abs(u.x - tx) + Math.abs(u.y - ty) > 32) {
							newCommanders[u.id] = { p: p, tx: tx, ty: ty, u: u };
						}
					}
				}
			});

			if (trackRtsNotify) {
				try {
					let myTeam = Vars.player.team();
					let newPlayerUnits = {};
					for (let uid in newCommanders) {
						let d = newCommanders[uid];
						if (!d.p || d.p.team() === myTeam) continue;
						let pid = String(d.p.id);
						if (!newPlayerUnits[pid]) newPlayerUnits[pid] = [];
						newPlayerUnits[pid].push({ uid: uid, d: d });
					}

					for (let pid in newPlayerUnits) {
						let list = newPlayerUnits[pid];
						let d = list[0].d;
						let tx = Math.floor(d.tx / 8);
						let ty = Math.floor(d.ty / 8);

						let counts = {};
						list.forEach((item) => {
							let typeName = String(item.d.u.type.name);
							if (!counts[typeName]) {
								counts[typeName] = { count: 0, emoji: "", name: typeName };
								try {
									let em = "";
									if (typeof item.d.u.type.emoji === "function") {
										em = String(item.d.u.type.emoji());
									} else if (item.d.u.type.emoji !== undefined) {
										em = String(item.d.u.type.emoji);
									}
									counts[typeName].emoji = em;
								} catch (e) {}
								try {
									let ln = String(item.d.u.type.localizedName || item.d.u.type.name);
									counts[typeName].name = ln;
								} catch (e) {}
							}
							counts[typeName].count++;
						});

						let unitStrings = [];
						for (let typeName in counts) {
							let info = counts[typeName];
							let iconPart = info.emoji ? info.emoji : info.name;
							unitStrings.push("[accent]" + info.count + "[lightgray]" + iconPart);
						}
						let unitsStr = unitStrings.join(", ");

						let hist = rtsHistory[pid] || { time: 0, tx: -999, ty: -999, unitsStr: "" };
						let now = Time.millis();

						let sameCoords = (Math.abs(tx - hist.tx) <= 2 && Math.abs(ty - hist.ty) <= 2);
						let sameUnits = (unitsStr === hist.unitsStr);

						let shouldNotify = false;

						if (now - hist.time > 3000) {
							if (!sameCoords) {
								shouldNotify = true;
							} else if (!sameUnits && now - hist.time > 8000) {
								shouldNotify = true;
							} else if (now - hist.time > 20000) {
								shouldNotify = true;
							}
						}

						if (shouldNotify) {
							let col = "[red]";
							try {
								let tc = d.p.team().color;
								col = "[#" + tc.toString().substring(0, 6) + "]";
							} catch (e) {}

							notify(
								col + Strings.stripColors(d.p.name) + "[] " +
								"[lightgray]RTS: " + unitsStr +
								" [lightgray]→ (" + tx + "," + ty + ")"
							);

							rtsHistory[pid] = {
								time: now,
								tx: tx,
								ty: ty,
								unitsStr: unitsStr
							};
						}
					}
				} catch (e) {}
			}

			unitCommanders = newCommanders;
		}
	}

	if (trackRecEnabled) {
		rallyScanTimer += Time.delta;
		if (rallyScanTimer > 180) {
			rallyScanTimer = 0;
			let newPoints = [];
			let myTeam = Vars.player.team();

			Groups.build.each((b) => {
				if (b.commandPos && b.commandPos.x !== undefined) {
					if (b.commandPos.x !== 0 || b.commandPos.y !== 0) {
						let tx = b.commandPos.x;
						let ty = b.commandPos.y;
						newPoints.push({
							x: b.x,
							y: b.y,
							tx: tx,
							ty: ty,
							color: b.team.color,
							team: b.team,
						});

						if (b.team !== myTeam && trackRtsNotify) {
							let key = b.x + "," + b.y;
							let lastPt = lastRallyPoints[key] || { tx: -999, ty: -999, time: 0 };
							let now = Time.millis();

							let rx = Math.floor(tx / 8);
							let ry = Math.floor(ty / 8);
							let lastRx = Math.floor(lastPt.tx / 8);
							let lastRy = Math.floor(lastPt.ty / 8);

							let sameRally = (rx === lastRx && ry === lastRy);

							if ((!sameRally || now - lastPt.time > 15000) && now - lastPt.time > 4000) {
								let blockName = String(b.block.localizedName || b.block.name);
								let blockEmoji = "";
								try {
									if (typeof b.block.emoji === "function") {
										blockEmoji = String(b.block.emoji());
									} else if (b.block.emoji !== undefined) {
										blockEmoji = String(b.block.emoji);
									}
								} catch (e) {}

								let col = "[red]";
								try {
									let tc = b.team.color;
									col = "[#" + tc.toString().substring(0, 6) + "]";
								} catch (e) {}

								let iconPart = blockEmoji ? blockEmoji : blockName;

								notify(
									col + b.team.name + "[] " +
									"[lightgray]Rally: " + iconPart +
									" [lightgray]→ (" + rx + "," + ry + ")"
								);
								lastRallyPoints[key] = { tx: tx, ty: ty, time: now };
							}
						}
					}
				}
			});

			for (let key in lastRallyPoints) {
				let exists = newPoints.some(p => (p.x + "," + p.y) === key);
				if (!exists) {
					delete lastRallyPoints[key];
				}
			}

			rallyPoints = newPoints;
		}
	}
});

interceptor.add('track', (args) => {
	let arg1 = args[1] ? args[1].toLowerCase() : '';

	if (arg1 === 'notify' || arg1 === 'n') {
		trackRtsNotify = interceptor.parseToggle(trackRtsNotify, args[2]);
		Core.settings.put('qol-track-rts-notify', trackRtsNotify);
		notify('[lightgray]RTS Notify ' + (trackRtsNotify ? '[green]ON' : '[scarlet]OFF'));
		if (!trackRtsNotify) {
			rtsHistory = {};
			lastRallyPoints = {};
		}
		return;
	}

	if (arg1 === 'rts') {
		trackRtsEnabled = interceptor.parseToggle(trackRtsEnabled, args[2]);
		Core.settings.put('qol-track-rts', trackRtsEnabled);
		notify('[lightgray]RTS Tracking ' + (trackRtsEnabled ? '[green]ON' : '[scarlet]OFF'));
		if (!trackRtsEnabled) unitCommanders = {};
		return;
	}

	if (arg1 === 'rec') {
		trackRecEnabled = interceptor.parseToggle(trackRecEnabled, args[2]);
		Core.settings.put('qol-track-rec', trackRecEnabled);
		notify('[lightgray]Rally Tracking ' + (trackRecEnabled ? '[green]ON' : '[scarlet]OFF'));
		if (!trackRecEnabled) rallyPoints = [];
		return;
	}

	if (arg1 && !interceptor.isBooleanArg(arg1)) {
		let found = null;
		Groups.player.each((p) => {
			if (Strings.stripColors(p.name).toLowerCase().includes(arg1)) found = p;
		});
		if (found) {
			trackedPlayer = found;
			notify('Tracking ' + found.name);
		} else {
			notify('[scarlet]Player [white]' + args[1] + ' [scarlet]not found');
		}
	} else {
		trackEnabled = interceptor.parseToggle(trackEnabled, arg1);
		Core.settings.put('qol-track-enabled', trackEnabled);
		if (!trackEnabled) {
			trackedPlayer = null;
			unitCommanders = {};
			rallyPoints = [];
		}
		notify('[lightgray]Tracking ' + (trackEnabled ? '[green]ON' : '[scarlet]OFF'));
	}
});

Events.run(Trigger.draw, () => {
	if (!Vars.state.isGame() || !trackEnabled) return;

	if (trackRtsEnabled) {
		let playerClusters = {};
		let chunkSize = 160;

		Groups.unit.each((u) => {
			let data = unitCommanders[u.id];
			if (data) {
				let p = data.p;
				if (p && (!trackedPlayer || p === trackedPlayer)) {
					let pu = p.unit();
					if (pu && u !== pu) {
						if (!playerClusters[p.id]) playerClusters[p.id] = {};
						let cx = Math.floor(u.x / chunkSize);
						let cy = Math.floor(u.y / chunkSize);
						let key = cx + ',' + cy;
						if (!playerClusters[p.id][key])
							playerClusters[p.id][key] = { x: 0, y: 0, count: 0, tx: 0, ty: 0 };
						playerClusters[p.id][key].x += u.x;
						playerClusters[p.id][key].y += u.y;
						playerClusters[p.id][key].count++;
						playerClusters[p.id][key].tx += data.tx;
						playerClusters[p.id][key].ty += data.ty;
					}
				}
			}
		});

		Groups.player.each((p) => {
			if (trackedPlayer && p !== trackedPlayer) return;
			let c = p.color;
			Draw.z(Layer.max);

			if (p !== Vars.player) {
				Lines.stroke(1.5);
				Draw.color(c, 0.6);
				Lines.square(p.mouseX, p.mouseY, 4, 45);
				let u = p.unit();
				if (u && u.isAdded()) {
					Lines.stroke(1.2);
					Draw.color(c, 0.45);
					Lines.line(u.x, u.y, p.mouseX, p.mouseY);
				}
			}

			let u = p.unit();
			if (u && u.isAdded()) {
				let clusters = playerClusters[p.id];
				if (clusters) {
					for (let k in clusters) {
						let cl = clusters[k];
						let avgX = cl.x / cl.count, avgY = cl.y / cl.count;
						let avgTx = cl.tx / cl.count, avgTy = cl.ty / cl.count;
						Draw.color(c, 0.35); Lines.stroke(1.2);
						Lines.line(u.x, u.y, avgX, avgY);
						Draw.color(c, 0.6); Lines.stroke(1.0);
						let dist = Math.abs(avgX - avgTx) + Math.abs(avgY - avgTy);
						let segments = Math.floor(Math.max(2, dist / 8));
						Lines.dashLine(avgX, avgY, avgTx, avgTy, segments);
						Lines.stroke(1.5);
						Lines.line(avgTx - 3, avgTy - 3, avgTx + 3, avgTy + 3);
						Lines.line(avgTx - 3, avgTy + 3, avgTx + 3, avgTy - 3);
					}
				}
			}
			Draw.reset();
		});
	}

	if (trackRecEnabled && rallyPoints.length > 0) {
		Draw.z(Layer.max);
		rallyPoints.forEach((p) => {
			if (trackedPlayer && p.team !== trackedPlayer.team()) return;
			Draw.color(p.color, 0.4); Lines.stroke(1.5);
			let dist = Math.abs(p.x - p.tx) + Math.abs(p.y - p.ty);
			let segments = Math.floor(Math.max(2, dist / 8));
			Lines.dashLine(p.x, p.y, p.tx, p.ty, segments);
			Lines.square(p.tx, p.ty, 4, 45);
		});
		Draw.reset();
	}
});
