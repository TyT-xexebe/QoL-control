const interceptor = require('qol-control/core/interceptor');
const notify = require('qol-control/core/logger').notify;

var BEACON = 0xabc;
var HELLO = 0xbcd;
var HELLO_R = 0xbce;
var TOL = 2;
var EXPIRE_MS = 90000;

var _buf = null;
function getBuf() {
	if (!_buf)
		try {
			_buf = java.nio.ByteBuffer.allocate(4);
		} catch (e) {}
	return _buf;
}
function floatBits(f) {
	try {
		var b = getBuf();
		if (!b) return 0;
		b.clear();
		b.putFloat(new java.lang.Float(f));
		var r = b.getInt(0);
		return r < 0 ? r + 4294967296 : r;
	} catch (e) {
		return 0;
	}
}
function bitsFloat(bits) {
	try {
		var b = getBuf();
		if (!b) return 0;
		b.clear();
		b.putInt(
			new java.lang.Integer(bits > 2147483647 ? bits - 4294967296 : bits)
		);
		return b.getFloat(0);
	} catch (e) {
		return 0;
	}
}
function embed(f, v12) {
	return bitsFloat((floatBits(f) & 0xfffff000) | (v12 & 0xfff));
}
function extract(f) {
	return floatBits(f) & 0xfff;
}
function near(hx, target) {
	return Math.abs(hx - target) <= TOL;
}

var modUsers = {};
var tracker = {};
var sendHelloUntil = 0;
var sendHelloRUntil = 0;

var classFieldCache = {};

interceptor.addPacketModifier(function (packet) {
	try {
		var clazz = packet.getClass();
		var className = String(clazz.getName());
		var xf = classFieldCache[className];
		if (xf === undefined) {
			xf = null;
			var fields = clazz.getDeclaredFields();
			for (var i = 0; i < fields.length; i++) {
				var fd = fields[i];
				if (String(fd.getType().getName()) !== 'float') continue;
				var nm = String(fd.getName());
				if (nm === 'mouseX' || nm === 'pointerX' || nm === 'aimX') {
					fd.setAccessible(true);
					xf = fd;
					break;
				}
			}
			classFieldCache[className] = xf;
		}
		if (!xf) return;

		if (Vars.player) {
			var isShooting = false;
			try {
				if (Vars.player.shooting) isShooting = true;
			} catch (e) {}
			var u = Vars.player.unit();
			if (u && u.isShooting && u.isShooting()) isShooting = true;
			if (isShooting) return;
		}

		var now = Date.now();
		var val = BEACON;
		if (now < sendHelloUntil) {
			val = HELLO;
		} else if (now < sendHelloRUntil) {
			val = HELLO_R;
		}

		xf.set(packet, new java.lang.Float(embed(xf.get(packet), val)));
	} catch (e) {}
});

var _tick = 0;
Events.run(Trigger.update, function () {
	if (!Vars.state.isGame()) return;

	try {
		if (Vars.player) {
			var isShooting = false;
			try {
				if (Vars.player.shooting) isShooting = true;
			} catch (e) {}
			var u = Vars.player.unit();
			if (u && u.isShooting && u.isShooting()) isShooting = true;
			if (!isShooting) {
				var now = Date.now();
				var val = BEACON;
				if (now < sendHelloUntil) {
					val = HELLO;
				} else if (now < sendHelloRUntil) {
					val = HELLO_R;
				}
				Vars.player.mouseX = embed(Vars.player.mouseX, val);
			}
		}
	} catch (e) {}

	if (++_tick < 8) return;
	_tick = 0;

	var now = Date.now();
	var activeKeys = {};
	try {
		Groups.player.each(function (p) {
			try {
				if (!p) return;
				var idKey = null;
				if (p.id !== undefined && p.id !== null) {
					idKey = String(p.id);
				}
				if (!idKey) {
					try {
						if (typeof p.id === 'function') {
							idKey = String(p.id());
						}
					} catch (e) {}
				}
				if (!idKey) {
					idKey = String(p.name);
				}
				if (idKey) {
					activeKeys[idKey] = true;
				}
			} catch (e) {}
		});
	} catch (e) {}

	for (var k in modUsers) {
		if (!activeKeys[k] || now - modUsers[k].lastSeen > EXPIRE_MS) {
			delete modUsers[k];
		}
	}
	for (var k in tracker) {
		if (!activeKeys[k]) {
			delete tracker[k];
		}
	}

	Groups.player.each(function (p) {
		try {
			if (!p || p === Vars.player) return;
			var hx = extract(p.mouseX);

			var idKey = null;
			try {
				if (p.id !== undefined && p.id !== null) {
					idKey = String(p.id);
				}
			} catch (e) {}
			if (!idKey) {
				try {
					if (typeof p.id === 'function') {
						idKey = String(p.id());
					}
				} catch (e) {}
			}
			if (!idKey) {
				idKey = String(p.name);
			}

			var name = String(p.name);

			var trk = tracker[idKey];
			if (!trk) {
				trk = {
					name: name,
					lastSeen: now,
					lastMatchTime: 0,
					lastX: p.mouseX,
					score: 0,
					hasMoved: false,
					confirmed: false,
				};
				tracker[idKey] = trk;
			}

			trk.lastSeen = now;

			var moved = Math.abs(p.mouseX - trk.lastX) > 0.1;
			if (moved) {
				trk.lastX = p.mouseX;
				trk.hasMoved = true;
			}

			var isMatch =
				near(hx, BEACON) || near(hx, HELLO) || near(hx, HELLO_R);

			if (isMatch) {
				trk.lastMatchTime = now;
				if (moved) {
					trk.score = Math.min(trk.score + 2, 30);
				} else {
					trk.score = Math.min(trk.score + 1, 30);
				}
			} else {
				if (moved) {
					trk.score = Math.max(trk.score - 4, 0);
				} else {
					trk.score = Math.max(trk.score - 1, 0);
				}
			}

			if (trk.hasMoved && trk.score >= 20 && !trk.confirmed) {
				trk.confirmed = true;
				modUsers[idKey] = { name: name, lastSeen: now };
				notify('[cyan]' + name + ' [lightgray]is using QoL Control!');
				sendHelloUntil = now + 4000;
			}

			if (trk.confirmed) {
				if (isMatch) {
					if (modUsers[idKey]) {
						modUsers[idKey].lastSeen = now;
					} else {
						modUsers[idKey] = { name: name, lastSeen: now };
					}
					if (near(hx, HELLO)) {
						sendHelloRUntil = now + 4000;
					}
				} else {
					if (trk.score === 0 && now - trk.lastMatchTime > 10000) {
						trk.confirmed = false;
						delete modUsers[idKey];
					}
				}
			}
		} catch (e) {}
	});
});

Events.on(WorldLoadEvent, function () {
	for (var k in modUsers) delete modUsers[k];
	for (var k in tracker) delete tracker[k];
	sendHelloUntil = 0;
	sendHelloRUntil = 0;
});

interceptor.add('user', function (args) {
	var now = Date.now(),
		lines = [];
	for (var u in modUsers)
		if (now - modUsers[u].lastSeen < EXPIRE_MS)
			lines.push('[cyan]' + modUsers[u].name);
	notify(
		lines.length === 0
			? '[lightgray]No QoL users detected yet.'
			: '[accent]QoL users (' + lines.length + '):\n' + lines.join('\n')
	);
});

interceptor.add('users', function (args) {
	var now = Date.now(),
		lines = [];
	for (var u in modUsers)
		if (now - modUsers[u].lastSeen < EXPIRE_MS)
			lines.push('[cyan]' + modUsers[u].name);
	notify(
		lines.length === 0
			? '[lightgray]No QoL users detected yet.'
			: '[accent]QoL users (' + lines.length + '):\n' + lines.join('\n')
	);
});
