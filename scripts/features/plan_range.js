const notify = require('qol-control/core/logger').notify;

Events.run(Trigger.draw, () => {
	if (!Vars.state.isGame() || !Vars.player || !Vars.player.unit()) return;
	
	let input = Vars.control.input;
	if (!input) return;

	let plansMap = {};
	let plans = [];

	const addPlan = p => {
		let key = p.x + ',' + p.y;
		if (!plansMap[key]) {
			plansMap[key] = p;
			plans.push(p);
		}
	};
	
	if (input.selectPlans && !input.selectPlans.isEmpty()) {
		input.selectPlans.each(cons(p => addPlan(p)));
	}
	
	if (input.linePlans && !input.linePlans.isEmpty()) {
		input.linePlans.each(cons(p => addPlan(p)));
	}

	if (Vars.player.unit().plans && Vars.player.unit().plans.size > 0) {
		Vars.player.unit().plans.each(cons(p => addPlan(p)));
	}

	Draw.z(Layer.overlayUI);
	Lines.stroke(1);

	let selBlock = input.block;
	if (selBlock && selBlock.name && (selBlock.name.indexOf('overdrive') > -1 || selBlock.name.indexOf('mass-driver') > -1)) {
		let pTeam = Vars.player.team();
		if (pTeam) {
			Groups.build.each(bld => {
				if (bld.team === pTeam) {
					let type = bld.block;
					if (type === selBlock) {
						let r = type.range;
						if (type.phaseRangeBoost !== undefined && bld.phaseHeat !== undefined) {
							r += bld.phaseHeat * type.phaseRangeBoost;
						}

						if (r && r > 0) {
							let color = Pal.accent;
							if (type.name.indexOf('overdrive') > -1) color = Color.valueOf("feb380");
							else color = Pal.accent;
							
							Draw.color(color, 0.5);
							Lines.circle(bld.x, bld.y, r);
						}
					}
				}
			});
		}
	}

	if (plans.length > 0) {
		for (let i = 0; i < plans.length; i++) {
			let plan = plans[i];
			if (!plan.breaking && plan.block) {
				let b = plan.block;
				
				if (b.category === Category.logic || b.category === Category.power || b.category === Category.distribution || b.category === Category.liquid) {
					continue;
				}
				
				let r = undefined;
				if (typeof b.range === 'function') r = b.range();
				else if (b.range !== undefined) r = b.range;
				else if (b.radius !== undefined) r = b.radius;
				
				if (r && r > 0) {
					let px = plan.x * Vars.tilesize + b.offset;
					let py = plan.y * Vars.tilesize + b.offset;
					
					let color = Pal.accent;
					if (b.name) {
						if (b.name.indexOf('overdrive') > -1) color = Color.valueOf("feb380");
						else if (b.name.indexOf('force') > -1) color = Pal.shield;
						else if (b.name.indexOf('mend') > -1) color = Pal.heal;
						else if (b.category === Category.turret) color = Color.valueOf("f25555");
					}
					
					Draw.color(color, 0.7);
					if (b.sides !== undefined) {
						Lines.poly(px, py, b.sides, r, b.shieldRotation !== undefined ? b.shieldRotation : 0);
					} else {
						Lines.circle(px, py, r);
					}
				}
			}
		}
	}
	
	Draw.reset();
});
