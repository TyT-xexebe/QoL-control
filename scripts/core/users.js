const notify = require('qol-control/core/logger').notify;
const interceptor = require('qol-control/core/interceptor');

let users = {},
	conf = {};
const mX = 0.375,
	mY = 0.625,
	tol = 0.05;

Events.on(WorldLoadEvent, () => {
	users = {};
	conf = {};
});

Events.run(Trigger.update, () => {
	if (!Vars.state.isGame() || !Vars.player) return;

	let px = Vars.player.mouseX,
		py = Vars.player.mouseY;
	Vars.player.mouseX = px - (px % 1) + (px < 0 ? -mX : mX);
	Vars.player.mouseY = py - (py % 1) + (py < 0 ? -mY : mY);

	Groups.player.each((p) => {
		if (users[p.id]) return;

		let fX = Math.abs(p.mouseX % 1),
			fY = Math.abs(p.mouseY % 1);

		if (Math.abs(fX - mX) < tol && Math.abs(fY - mY) < tol) {
			if ((conf[p.id] = (conf[p.id] || 0) + 3) >= 15) users[p.id] = true;
		} else if (conf[p.id] > 0) {
			conf[p.id]--;
		}
	});
});

interceptor.add('users', () => {
	let out = [];
	Groups.player.each((p) => {
		if (users[p.id])
			out.push(
				Strings.stripColors(p.name) +
					(p === Vars.player ? ' (You)' : '')
			);
	});
	notify(
		out.length
			? '[green]QoL Users online: [white]' + out.join(', ')
			: '[lightgray]No QoL users found.'
	);
});
