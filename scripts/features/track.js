const notify = require('qol-control/core/logger').notify;
const interceptor = require('qol-control/core/interceptor');

let trackEnabled = Core.settings.getBool('qol-track-enabled', false);
let trackRtsEnabled = Core.settings.getBool('qol-track-rts', true);
let trackRecEnabled = Core.settings.getBool('qol-track-rec', true);
let trackRtsNotify = Core.settings.getBool('qol-track-rts-notify', true);
let trackRtsCircle = Core.settings.getBool('qol-track-rts-circle', true);
// Reports the orders of the player himself as well - handy to see what his own
// group is doing, and to test the alerts.
let trackRtsOwn = Core.settings.getBool('qol-track-rts-own', true);
let trackedPlayer = null;

let unitCommanders = {};
let unitScanTimer = 0;

let rtsHistory = {};

// The expanding alert circles of the enemy orders.
let rtsAlerts = [];
// How long a circle lives and how thick its line is.
const ALERT_LIFE = 2400;
const ALERT_STROKE = 8;
// How often the same player may cause a circle / a chat message.
const ALERT_COOLDOWN = 6000;
const NOTIFY_COOLDOWN = 6000;
const NOTIFY_UNITS_COOLDOWN = 30000;

const alertColor = Color.valueOf('ff5555');

// The radius a circle needs to cover the whole map from the given point, so
// the ring sweeps over every part of the map and is seen no matter where the
// player is looking.
function mapRadius(x, y) {
	try {
		let w = Vars.world.width() * 8;
		let h = Vars.world.height() * 8;
		let corners = [0, 0, w, 0, 0, h, w, h];
		let max = 0;
		for (let i = 0; i < corners.length; i += 2) {
			let dx = corners[i] - x;
			let dy = corners[i + 1] - y;
			let dist = Math.sqrt(dx * dx + dy * dy);
			if (dist > max) max = dist;
		}
		return max + 200;
	} catch (e) {
		return 2000;
	}
}

let rallyPoints = [];
let rallyScanTimer = 0;
let lastRallyPoints = {};

const getPlayerObj = (obj) => {
	if (!obj) return null;
	if (obj instanceof Packages.mindustry.gen.Player) return obj;
	if (obj.isPlayer && obj.isPlayer()) return obj.getPlayer();
	return null;
};

// The chat message about an order of another player.
const notifyRts = (player, unitsStr, tx, ty) => {
	let col = "[red]";
	try {
		let tc = player.team().color;
		col = "[#" + tc.toString().substring(0, 6) + "]";
	} catch (e) {}
	notify(
		col + Strings.stripColors(player.name) + "[] " +
		"[lightgray]RTS: " + unitsStr +
		" [lightgray]→ (" + tx + "," + ty + ")"
	);
};

Events.on(WorldLoadEvent, () => {
	unitCommanders = {};
	rallyPoints = [];
	rtsHistory = {};
	lastRallyPoints = {};
	rtsAlerts.length = 0;
});

Events.run(Trigger.update, () => {
	if (!trackEnabled) return;

	if (trackRtsEnabled) {
		unitScanTimer += Time.delta;
		if (unitScanTimer > 15) {
			unitScanTimer = 0;
			let newCommanders = {};

			let hasCommandAI = false;
			let hasFormationAI = false;
			try {
				if (Packages.mindustry.ai.types.CommandAI) hasCommandAI = true;
			} catch (e) {}
			// The formation AI does not exist in every game version and asking for
			// a missing class throws, so it is only used when it is really there.
			try {
				if (Packages.mindustry.ai.types.FormationAI) hasFormationAI = true;
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

				if (!p && hasFormationAI && ctrl instanceof Packages.mindustry.ai.types.FormationAI) {
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
					// A real order is the position the AI was told to go to. It does
					// not move while the order is executed, so it can be compared
					// with the last one. The cursor of a player is not an order -
					// it moves all the time and would report a new command on
					// every scan.
					let isOrder = false;
					try {
						if (ctrl.targetPos && ctrl.targetPos.x !== undefined) {
							tx = ctrl.targetPos.x; ty = ctrl.targetPos.y;
							isOrder = true;
						} else if (hasFormationAI && ctrl instanceof Packages.mindustry.ai.types.FormationAI && ctrl.leader) {
							tx = ctrl.leader.x; ty = ctrl.leader.y;
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
							newCommanders[u.id] = { p: p, tx: tx, ty: ty, u: u, isOrder: isOrder };
						}
					}
				}
			});

			try {
				let myTeam = Vars.player.team();
				let newPlayerUnits = {};
				for (let uid in newCommanders) {
					let d = newCommanders[uid];
					if (!d || !d.p) continue;
					if (d.p.team() === myTeam && !trackRtsOwn) continue;
					let pid = String(d.p.id);
					if (!newPlayerUnits[pid]) newPlayerUnits[pid] = [];
					newPlayerUnits[pid].push({ uid: uid, d: d });
				}

				for (let pid in newPlayerUnits) {
					let list = newPlayerUnits[pid];
					let d = list[0].d;

					// The order point of this player: the position his units were
					// told to go to. Units that are only following the cursor of
					// their owner have no order and are not reported.
					let order = null;
					for (let i = 0; i < list.length; i++) {
						if (list[i].d.isOrder) {
							order = list[i].d;
							break;
						}
					}

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

					let hist = rtsHistory[pid] || {
						tx: -999,
						ty: -999,
						unitsStr: "",
						// Far enough in the past that the first order of a
						// player is reported right away.
						notifyTime: -999999,
						circleTime: -999999
					};
					let now = Time.millis();

					if (order) {
						let otx = Math.floor(order.tx / 8);
						let oty = Math.floor(order.ty / 8);
						let moved = Math.abs(otx - hist.tx) > 3 || Math.abs(oty - hist.ty) > 3;

						if (moved) {
							// The order point is remembered even when nothing is
							// reported, so the same order is never reported twice.
							hist.tx = otx;
							hist.ty = oty;

							// The circle on the map: the loudest sign that the
							// enemy gave an order.
							if (trackRtsCircle && now - hist.circleTime > ALERT_COOLDOWN) {
								rtsAlerts.push({
									x: order.tx,
									y: order.ty,
									time: now,
									radius: mapRadius(order.tx, order.ty)
								});
								hist.circleTime = now;
							}

							if (trackRtsNotify && now - hist.notifyTime > NOTIFY_COOLDOWN) {
								notifyRts(d.p, unitsStr, otx, oty);
								hist.notifyTime = now;
							}
						}
					}

					// The group changed (a unit joined or left). That is worth a
					// message, but rarely.
					if (unitsStr !== hist.unitsStr) {
						hist.unitsStr = unitsStr;
						if (trackRtsNotify && now - hist.notifyTime > NOTIFY_UNITS_COOLDOWN) {
							notifyRts(d.p, unitsStr, Math.floor(d.tx / 8), Math.floor(d.ty / 8));
							hist.notifyTime = now;
						}
					}

					rtsHistory[pid] = hist;
				}
			} catch (e) {}

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

							// Only a rally point that really moved is worth a
							// message. The point is remembered every time, so the
							// same rally does not report itself again and again.
							if (!sameRally && now - lastPt.time > 4000) {
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
							}
							lastRallyPoints[key] = { tx: tx, ty: ty, time: now };
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

function showTrackSettingsDialog() {
	let d = new BaseDialog('Player & RTS Tracker Config');
	d.addCloseButton();

	let root = new Table();
	root.top().left().margin(10);

	function createCard(title, titleColor) {
		let card = root.table(Styles.black6).growX().padBottom(8).get();
		card.margin(8);
		card.top().left();
		card.add('[#' + (titleColor || 'ffd37f') + ']' + title + '[]').style(Styles.outlineLabel).fontScale(0.90).left().padBottom(4).row();
		card.image().color(Color.valueOf('3a3a46')).height(1.5).growX().padBottom(6).row();
		return card;
	}

	// 1. Modules Card
	let c1 = createCard('Tracking Features', '50fa7b');

	c1.check('Enable Player Cursor Tracking', trackEnabled, (b) => {
		trackEnabled = b;
		Core.settings.put('qol-track-enabled', b);
		if (!b) {
			trackedPlayer = null;
			unitCommanders = {};
			rallyPoints = [];
		}
		notify('[lightgray]Tracking ' + (b ? '[green]ON' : '[scarlet]OFF'));
	}).pad(3).left().row();

	c1.check('RTS Command Tracking (draw lines to orders)', trackRtsEnabled, (b) => {
		trackRtsEnabled = b;
		Core.settings.put('qol-track-rts', b);
		if (!b) {
			unitCommanders = {};
			rtsHistory = {};
		}
		notify('[lightgray]RTS Tracking ' + (b ? '[green]ON' : '[scarlet]OFF'));
	}).pad(3).left().row();

	c1.check('Reconstructor Rally Tracking', trackRecEnabled, (b) => {
		trackRecEnabled = b;
		Core.settings.put('qol-track-rec', b);
		if (!b) rallyPoints = [];
		notify('[lightgray]Rally Tracking ' + (b ? '[green]ON' : '[scarlet]OFF'));
	}).pad(3).left().row();

	c1.check('Notify On New RTS Commands', trackRtsNotify, (b) => {
		trackRtsNotify = b;
		Core.settings.put('qol-track-rts-notify', b);
		if (!b) {
			rtsHistory = {};
			lastRallyPoints = {};
		}
		notify('[lightgray]RTS Notify ' + (b ? '[green]ON' : '[scarlet]OFF'));
	}).pad(3).left().row();

	c1.check('Red Alert Circle On Enemy Orders', trackRtsCircle, (b) => {
		trackRtsCircle = b;
		Core.settings.put('qol-track-rts-circle', b);
		if (!b) rtsAlerts.length = 0;
		notify('[lightgray]RTS Alert Circle ' + (b ? '[green]ON' : '[scarlet]OFF'));
	}).pad(3).left().row();

	c1.check('Also Report Own Orders', trackRtsOwn, (b) => {
		trackRtsOwn = b;
		Core.settings.put('qol-track-rts-own', b);
		notify('[lightgray]Own Orders ' + (b ? '[green]ON' : '[scarlet]OFF'));
	}).pad(3).left().row();

	root.row();

	// 2. Tracked Player Card
	let c2 = createCard('Tracked Target', 'ffd37f');
	let pName = trackedPlayer ? ('[accent]' + trackedPlayer.name + '[]') : '[gray]None (no active target)[]';
	c2.add('[lightgray]Current Target: ' + pName).left().padBottom(6).row();

	let hasOtherPlayers = false;
	if (Vars.state && Vars.state.isGame() && Groups.player) {
		let pTable = c2.table().growX().padBottom(4).get();
		Groups.player.each(cons(p => {
			if (p === Vars.player) return;
			hasOtherPlayers = true;
			let pRow = pTable.table().growX().pad(2).get();
			let pLabel = pRow.add('[white]' + p.name).left().growX().minWidth(0);
			pLabel.get().setEllipsis(true);

			let isCurrent = (trackedPlayer === p);
			pRow.button(isCurrent ? '[#ff5555]Untrack[]' : '[#73d216]Track[]', Styles.grayt, () => {
				if (isCurrent) {
					trackedPlayer = null;
					notify('[lightgray]Stopped tracking player');
				} else {
					trackedPlayer = p;
					notify('[green]Now tracking [accent]' + p.name);
				}
				d.hide();
				showTrackSettingsDialog();
			}).size(100, 32);
			pTable.row();
		}));
	}

	if (!hasOtherPlayers) {
		c2.add('[gray]No other players on server. In multiplayer, players will appear here for 1-click tracking.[]').fontScale(0.85).left().growX().wrap().padBottom(4).row();
	}

	if (trackedPlayer) {
		let stopBtn = c2.button('[#ff5555]Stop Tracking[]', Styles.grayt, () => {
			trackedPlayer = null;
			notify('[lightgray]Stopped tracking player');
			d.hide();
			showTrackSettingsDialog();
		}).size(160, 34).left().padTop(4).get();
		c2.row();
	}

	root.row();

	let scroll = new ScrollPane(root);
	scroll.setScrollingDisabled(true, false);
	scroll.setOverscroll(false, true);

	let dw = Math.min(Core.scene.getWidth() * 0.95, 680);
	let dh = Math.min(Core.scene.getHeight() * 0.85, 480);
	d.cont.add(scroll).width(dw).height(dh).row();
	d.show();
}

interceptor.add('track', (args) => {
	let arg1 = args[1] ? args[1].toLowerCase() : '';

	if (arg1 === 'ui' || arg1 === 'settings') {
		showTrackSettingsDialog();
		return;
	}

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

	if (arg1 === 'circle' || arg1 === 'c') {
		trackRtsCircle = interceptor.parseToggle(trackRtsCircle, args[2]);
		Core.settings.put('qol-track-rts-circle', trackRtsCircle);
		if (!trackRtsCircle) rtsAlerts.length = 0;
		notify('[lightgray]RTS Alert Circle ' + (trackRtsCircle ? '[green]ON' : '[scarlet]OFF'));
		return;
	}

	if (arg1 === 'own' || arg1 === 'o') {
		trackRtsOwn = interceptor.parseToggle(trackRtsOwn, args[2]);
		Core.settings.put('qol-track-rts-own', trackRtsOwn);
		notify('[lightgray]Own Orders ' + (trackRtsOwn ? '[green]ON' : '[scarlet]OFF'));
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

	// The alert circles: a red ring that spreads over the whole map from the
	// order point, so it is noticed even when the chat is not looked at.
	if (trackRtsCircle && rtsAlerts.length > 0) {
		let now = Time.millis();
		Draw.z(Layer.max);
		for (let i = rtsAlerts.length - 1; i >= 0; i--) {
			let alert = rtsAlerts[i];
			let age = now - alert.time;
			if (age >= ALERT_LIFE) {
				rtsAlerts.splice(i, 1);
				continue;
			}
			let t = age / ALERT_LIFE;
			// The ring grows fast at first, so it covers the whole map before
			// it fades away.
			let grown = 1 - (1 - t) * (1 - t);
			let radius = 8 + grown * alert.radius;
			// It holds for a while and fades at the end.
			let alpha = t < 0.1 ? t / 0.1 : t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
			alpha = alpha * 0.85;

			Draw.color(alertColor, alpha);
			Lines.stroke(ALERT_STROKE);
			Lines.circle(alert.x, alert.y, radius);
		}
		Draw.reset();
	}
});

// Expose this module's config dialog to the mod settings screen (gear button).
require('qol-control/core/settings-ui').register(
	'features/track',
	'Tracking',
	showTrackSettingsDialog,
	{ menuSafe: true }
);
