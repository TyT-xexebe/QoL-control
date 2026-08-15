let targetFps = 60;
let lastPreemptTime = 0;

Events.run(Trigger.update, () => {
	if (!Vars.state.isGame()) return;

	let p = Vars.player;
	if (!p) return;

	let u = p.unit();
	if (!u) return;

	let fps = Core.graphics.getFramesPerSecond();
	if (fps >= 55 || fps <= 3) return;

	let multiplier = targetFps / fps;

	if (u.vel) {
		let speed = u.vel.len();
		let maxSpeed = u.type ? u.type.speed : 1.0;

		if (speed > maxSpeed * 0.25) {
			let dist = u.dst(p.mouseX, p.mouseY);
			let scale = 1.0;
			if (dist < 48) {
				scale = Math.max(0, (dist - 16) / 32);
			}

			if (scale > 0) {
				let boostX = u.vel.x * (multiplier - 1) * 0.15 * scale;
				let boostY = u.vel.y * (multiplier - 1) * 0.15 * scale;
				u.vel.add(boostX, boostY);
				u.vel.limit(maxSpeed * 1.5);
			}
		}
	}

	try {
		let plan = u.buildPlan();
		if (plan != null && plan.tile() != null) {
			let b = plan.tile().build;
			if (b != null && b instanceof Packages.mindustry.world.blocks.ConstructBlock.ConstructBuild) {
				let threshold = 0.93 + (fps / 1000);
				if (threshold > 0.98) threshold = 0.98;

				if (b.progress >= threshold && u.plans && u.plans.size > 1) {
					let now = Time.millis();
					if (now - lastPreemptTime > 80) {
						lastPreemptTime = now;
						let nextPlan = u.plans.get(1);
						if (nextPlan != null && nextPlan.tile() != null) {
							Call.requestBuild(nextPlan.x, nextPlan.y, nextPlan.block, nextPlan.rotation);
						}
					}
				}
			}
		}
	} catch (e) {}
});
