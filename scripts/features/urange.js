const notify = require('qol-control/core/logger').notify;
const interceptor = require('qol-control/core/interceptor');

let urangeEnabled = Core.settings.getBool('qol-urange-enabled', false);
let urangeUpdateTimer = 0;
let cachedUnits = [];

Events.on(WorldLoadEvent, () => {
	cachedUnits = [];
});

interceptor.add('urange', (args) => {
	if (args[1] && !interceptor.isBooleanArg(args[1])) {
		notify('[lightgray]Usage: !urange <1/0?>');
		return;
	}
	urangeEnabled = interceptor.parseToggle(urangeEnabled, args[1]);
	Core.settings.put('qol-urange-enabled', urangeEnabled);
	if (!urangeEnabled) cachedUnits = [];
	notify(
		'[lightgrey]Enemy Unit Ranges ' +
			(urangeEnabled ? '[green]ON' : '[scarlet]OFF')
	);
});

Events.run(Trigger.draw, () => {
	if (!Vars.state.isGame()) return;
	let u = Vars.player.unit();

	if (!urangeEnabled || !u) return;
	if (urangeUpdateTimer++ >= 5) {
		urangeUpdateTimer = 0;
		cachedUnits = [];

		let limitDist = 1200;

		Groups.unit.each((unit) => {
			if (unit.team !== u.team && !unit.dead) {
				let r = unit.type.maxRange;
				if (r && r > 0) {
					let limit = Math.max(r + 300, limitDist);

					if (u.dst2(unit) <= limit * limit) {
						let color = Color.valueOf('eab678');
						if (unit.type.targetAir && unit.type.targetGround) {
							color = Color.valueOf('cc81f5');
						} else if (unit.type.targetAir) {
							color = Color.valueOf('84f5f5');
						}

						cachedUnits.push({
							x: unit.x,
							y: unit.y,
							r: r,
							color: color,
						});
					}
				}
			}
		});
	}

	Draw.z(Layer.max);
	Lines.stroke(0.9);
	for (let i = 0, len = cachedUnits.length; i < len; i++) {
		let t = cachedUnits[i];
		Draw.color(t.color, 0.6);
		Lines.circle(t.x, t.y, t.r);
	}
});
