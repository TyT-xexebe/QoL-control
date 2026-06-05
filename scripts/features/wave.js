const interceptor = require('qol-control/core/interceptor');
const notify = require('qol-control/core/logger').notify;

var skipTask = null;
var skipLeft = 0;

function doOneSkip() {
	try {
		var action = null;
		var candidates = [
			'Packages.mindustry.net.Packets$AdminAction',
			'Packages.mindustry.net.Packets.AdminAction',
			'Packages.mindustry.net.Administration$AdminAction',
			'Packages.mindustry.net.Administration.AdminAction',
			'Packages.mindustry.net.NetServer$AdminAction',
			'Packages.mindustry.net.NetServer.AdminAction',
		];
		for (var i = 0; i < candidates.length; i++) {
			try {
				var cls = eval(candidates[i]);
				if (cls) {
					if (cls.wave) {
						action = cls.wave;
						break;
					}
					if (cls.WAVE) {
						action = cls.WAVE;
						break;
					}
					try {
						action = cls.valueOf('wave');
						break;
					} catch (e) {}
					try {
						action = cls.valueOf('WAVE');
						break;
					} catch (e) {}
				}
			} catch (e) {}
		}
		if (Vars.net.client()) {
			if (action) {
				var sent = false;
				try {
					Call.adminRequest(Vars.player, action, null);
					sent = true;
				} catch (e) {}
				if (!sent) {
					try {
						Call.adminRequest(Vars.player, action);
						sent = true;
					} catch (e) {}
				}
				if (!sent) {
					try {
						Call.adminRequest(action);
						sent = true;
					} catch (e) {}
				}
				if (!sent) {
					try {
						Call.adminRequest(null, action);
						sent = true;
					} catch (e) {}
				}
				if (sent) {
					notify('[accent]Skip wave request sent to server.');
				} else {
					notify('[red]Failed to send wave skip packet.');
				}
			} else {
				notify('[red]Failed to resolve wave action.');
			}
		} else {
			var handled = false;
			try {
				if (Vars.logic.skipWave) {
					Vars.logic.skipWave();
					handled = true;
				} else if (Vars.logic.runWave) {
					Vars.logic.runWave();
					handled = true;
				}
			} catch (e) {}
			if (!handled) {
				var wasWait = Vars.state.rules.waitEnemies;
				Vars.state.rules.waitEnemies = false;
				Vars.state.wavetime = 0;
				if (action) {
					try {
						Call.adminRequest(Vars.player, action, null);
					} catch (e) {}
				}
				Timer.schedule(function () {
					try {
						Vars.state.rules.waitEnemies = wasWait;
					} catch (e) {}
				}, 0.5);
			}
		}
	} catch (e) {
		notify('[red]Error performing skip: ' + e);
	}
}

function cancelSkip() {
	if (skipTask) {
		skipTask.cancel();
		skipTask = null;
	}
	skipLeft = 0;
}

function startSkip(count) {
	cancelSkip();

	if (count <= 1) {
		doOneSkip();
		notify(
			'[accent]Wave [white]' +
				(Vars.state.wave + 1) +
				'[accent] incoming!'
		);
		return;
	}

	notify(
		'[lightgray]Skipping [white]' +
			count +
			'[lightgray] waves... (run [white]!wave[lightgray] again to cancel)'
	);
	skipLeft = count;

	function tick() {
		if (skipLeft <= 0 || !Vars.state.isGame()) {
			skipTask = null;
			skipLeft = 0;
			notify(
				'[accent]Done. [lightgray]Now on wave [white]' +
					Vars.state.wave +
					'[lightgray].'
			);
			return;
		}
		doOneSkip();
		skipLeft--;
		if (skipLeft > 0) {
			skipTask = Timer.schedule(tick, 1.2);
		} else {
			skipTask = null;
			Timer.schedule(function () {
				notify(
					'[accent]Done. [lightgray]Now on wave [white]' +
						Vars.state.wave +
						'[lightgray].'
				);
			}, 0.6);
		}
	}

	doOneSkip();
	skipLeft--;
	if (skipLeft > 0) {
		skipTask = Timer.schedule(tick, 1.2);
	} else {
		skipTask = null;
		Timer.schedule(function () {
			notify(
				'[accent]Done. [lightgray]Now on wave [white]' +
					Vars.state.wave +
					'[lightgray].'
			);
		}, 0.6);
	}
}

interceptor.add('wave', function (args) {
	if (!Vars.state.isGame()) {
		notify('[red]Not in game.');
		return;
	}

	if (args[1] === 'status' || args[1] === 's') {
		var r = Vars.state.rules;
		notify(
			'[accent]Wave info:\n' +
				'[lightgray]Wave: [white]' +
				Vars.state.wave +
				'\n' +
				'[lightgray]Enemies alive: [white]' +
				Vars.state.enemies +
				'\n' +
				'[lightgray]Wave timer: [white]' +
				Math.ceil(Vars.state.wavetime / 60) +
				's\n' +
				'[lightgray]waitEnemies: [white]' +
				r.waitEnemies +
				'\n' +
				'[lightgray]waveSending: [white]' +
				r.waveSending +
				'\n' +
				'[lightgray]waves enabled: [white]' +
				r.waves +
				'\n' +
				'[lightgray]Admin: [white]' +
				Vars.player.admin
		);
		return;
	}

	if (!Vars.state.rules.waves) {
		notify('[red]Waves are not enabled on this map.');
		return;
	}

	if (skipTask) {
		cancelSkip();
		notify('[lightgray]Wave skip cancelled.');
		return;
	}

	var count = 1;
	if (args[1] && !isNaN(parseInt(args[1]))) {
		count = Math.max(1, Math.min(parseInt(args[1]), 50));
	}

	startSkip(count);
});
