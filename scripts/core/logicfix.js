const pending = {};
let dCount = 0;

Events.run(Trigger.update, () => {
	let p = Vars.player;
	if (!p) return;
	let u = p.unit();
	if (!u || typeof u.plans === 'undefined') return;

	let ts = u.plans;
	for (let i = 0; i < ts.size; i++) {
		let plan = ts.get(i);
		if (plan && plan.config != null && plan.block instanceof LogicBlock) {
			let k = (plan.x << 16) | (plan.y & 0xffff);
			pending[k] = plan.config;
			plan.config = null;
		}
	}
});

Events.on(BlockBuildEndEvent, (e) => {
	if (!e.breaking && e.tile) {
		let k = (e.tile.x << 16) | (e.tile.y & 0xffff);
		let cfg = pending[k];
		if (cfg !== undefined) {
			dCount += 5;
			let d = dCount;
			Time.run(d, () => {
				dCount = Math.max(0, dCount - 5);
				let b = e.tile.build;
				if (b && b.isValid() && b.block instanceof LogicBlock) {
					b.configure(cfg);
				}
			});
			delete pending[k];
		}
	}
});

Events.on(WorldLoadEvent, () => {
	for (let k in pending) delete pending[k];
	dCount = 0;
});
