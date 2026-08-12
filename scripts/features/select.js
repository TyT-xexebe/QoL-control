const notify = require('qol-control/core/logger').notify;
const interceptor = require('qol-control/core/interceptor');

interceptor.add('select', (args) => {
	if (args.length === 1) {
		notify('[lightgrey]Usage: !select <units...>\nExample: !select poly mega\nSelects all units of specified types on your team and enables RTS control.');
		return;
	}

	if (!Vars.control || !Vars.control.input) {
		notify('[scarlet]Control input is not initialized.');
		return;
	}

	if (!Vars.control.input.selectedUnits) {
		notify('[scarlet]RTS selection (selectedUnits) is not available in this client.');
		return;
	}

	const specifiedTypes = {};
	for (let i = 1; i < args.length; i++) {
		specifiedTypes[args[i].toLowerCase()] = true;
	}

	Vars.control.input.selectedUnits.clear();

	let count = 0;
	Groups.unit.each((u) => {
		if (u.team === Vars.player.team() && !u.dead) {
			let typeName = u.type.name.toLowerCase();
			if (specifiedTypes.hasOwnProperty(typeName)) {
				Vars.control.input.selectedUnits.add(u);
				count++;
			}
		}
	});

	if (count > 0) {
		if ('commandMode' in Vars.control.input) {
			Vars.control.input.commandMode = true;
		}
		notify('[lightgrey]Selected [accent]' + count + '[lightgrey] units and enabled RTS control.');
	} else {
		notify('[scarlet]No units of the specified types found on your team.');
	}
});
