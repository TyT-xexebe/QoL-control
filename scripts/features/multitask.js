const logger = require('qol-control/core/logger');
let lastUnitId = -1;
let lastRotation = 0;

Events.run(Trigger.preDraw, () => {
	let p = Vars.player;
	if (!p || !p.unit() || !p.unit().type || !p.unit().type.hasWeapons) {
		lastUnitId = -1;
		return;
	}
	let isBuilding = p.unit().activelyBuilding();
	let isMining = p.unit().mining();
	if (!isBuilding && !isMining) {
		lastUnitId = -1;
		return;
	}
	let shouldShoot = false;
	let boosted = false;
	if (!Vars.mobile) {
		shouldShoot = Core.input.keyDown(Binding.select);
		boosted = p.unit().isFlying() && p.unit().type.canBoost;
	} else {
		let state = Vars.state;
		if (!state.isEditor()) {
			boosted = p.unit().isFlying() && p.unit().type.canBoost;
			let type = p.unit().type;
			let enemy = Units.closestTarget(
				p.unit().team,
				p.unit().x,
				p.unit().y,
				type.maxRange,
				(u) => true,
				(t) => true
			);
			if (enemy || Core.input.isTouched()) {
				shouldShoot = true;
			}
		}
	}
	if (shouldShoot && !boosted) {
		let aimX = 0;
		let aimY = 0;
		let type = p.unit().type;
		if (!Vars.mobile) {
			let mouse = Core.input.mouseWorld();
			aimX = mouse.x;
			aimY = mouse.y;
		} else {
			let enemy = Units.closestTarget(
				p.unit().team,
				p.unit().x,
				p.unit().y,
				type.maxRange,
				(u) => true,
				(t) => true
			);
			if (enemy) {
				aimX = enemy.x;
				aimY = enemy.y;
			} else {
				aimX = Core.input.mouseWorldX();
				aimY = Core.input.mouseWorldY();
			}
		}
		p.shooting = true;
		p.unit().aim(aimX, aimY);
		p.mouseX = aimX;
		p.mouseY = aimY;
		if (type.omniMovement && type.faceTarget) {
			let mouseAngle = p.unit().angleTo(aimX, aimY);
			if (lastUnitId !== p.unit().id) {
				lastRotation = p.unit().rotation;
				lastUnitId = p.unit().id;
			}
			let spd = p.unit().speedMultiplier;
			if (typeof spd === 'function') spd = spd();
			if (spd === undefined || spd === null) spd = 1;
			lastRotation = Angles.moveToward(
				lastRotation,
				mouseAngle,
				type.rotateSpeed * Time.delta * spd
			);
			p.unit().rotation = lastRotation;
		}
		p.unit().controlWeapons(true, true);
	} else {
		lastUnitId = -1;
	}
});
