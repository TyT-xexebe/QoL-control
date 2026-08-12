Events.on(
	ClientLoadEvent,
	cons((e) => {
		Vars.content.units().each((u) => {
			u.rotateSpeed = 9999;
			u.omniMovement = true;
		});
	})
);

Events.on(
	WorldLoadEvent,
	cons((e) => {
		Vars.content.units().each((u) => {
			u.rotateSpeed = 9999;
			u.omniMovement = true;
		});
	})
);
