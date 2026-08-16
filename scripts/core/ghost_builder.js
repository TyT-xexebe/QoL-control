let ghostUnit = null;

Events.run(Trigger.update, () => {
	if (!Vars.state || !Vars.state.isGame()) {
		if (ghostUnit) ghostUnit = null;
		return;
	}

	try {
		if (Vars.state.rules && Vars.state.rules.enemyCoreBuildRadius > 0) {
			Vars.state.rules.enemyCoreBuildRadius = 0;
		}
	} catch (e) {}

	let p = Vars.player;
	if (!p) return;

	let u = p.unit();
	let isNullUnit = !u || u.dead || typeof u.plans === 'undefined' || (u.type && u.type.name === 'block');

	if (isNullUnit) {
		try {
			if (!ghostUnit || ghostUnit.dead) {
				ghostUnit = UnitTypes.alpha.create(p.team());
			}
			ghostUnit.team = p.team();
			ghostUnit.set(p.x, p.y);
			p.unit(ghostUnit);
		} catch (e) {}
	}
});

Events.on(WorldLoadEvent, () => {
	ghostUnit = null;
	try {
		if (Vars.state && Vars.state.rules) {
			Vars.state.rules.enemyCoreBuildRadius = 0;
		}
	} catch (e) {}
});
