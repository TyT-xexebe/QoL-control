const notify = require('qol-control/core/logger').notify;

let trangeEnabled = false;
let trangeUpdateTimer = 0;
let cachedTurrets = [];

Events.on(WorldLoadEvent, () => {
	cachedTurrets = [];
});

Events.on(ClientChatEvent, (e) => {
	let msg = String(e.message);
	let args = msg.trim().toLowerCase().split(' ');
	let cmd = args[0];

	if (cmd === '/trange') {
		trangeEnabled = !trangeEnabled;
		if (!trangeEnabled) cachedTurrets = [];
		notify(
			'[lightgrey]Turret Ranges ' +
				(trangeEnabled ? '[green]ON' : '[scarlet]OFF')
		);
	}
});

Events.run(Trigger.draw, () => {
	if (!Vars.state.isGame()) return;
	let u = Vars.player.unit();

	if (!trangeEnabled || !u) return;
	if (trangeUpdateTimer++ >= 10) {
		trangeUpdateTimer = 0;
		cachedTurrets = [];

		Vars.indexer.allBuildings(u.x, u.y, 800, (b) => {
			if (b.team !== u.team && b.block.category === Category.turret) {
				let r = b.block.range;
				let limit = r + 100;

				if (u.dst2(b) <= limit * limit) {
					let color = Color.valueOf('eab678');
					if (b.block.targetAir && b.block.targetGround)
						color = Color.valueOf('cc81f5');
					else if (b.block.targetAir) color = Color.valueOf('84f5f5');

					cachedTurrets.push({ x: b.x, y: b.y, r: r, color: color });
				}
			}
		});
	}

	Draw.z(Layer.max);
	Lines.stroke(0.9);
	for (let i = 0, len = cachedTurrets.length; i < len; i++) {
		let t = cachedTurrets[i];
		Draw.color(t.color, 0.3);
		Lines.circle(t.x, t.y, t.r);
	}
});
