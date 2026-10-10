const uiUtils = require('qol-control/ui/utils');

let locked = false;
let lockX = 0;
let lockY = 0;
let reset = false;
let dragHandler = null;

const buildUI = () => {
	let table = new Table();
	Vars.ui.hudGroup.addChild(table);

	// Anchor-based position: survives window resizes without drifting.
	dragHandler = uiUtils.setupDrag(
		'cam-lock-btn-x',
		'cam-lock-btn-y',
		150,
		150
	);

	let btn = table
		.button(Icon.eye, Styles.clearNonei, () => {
			if (!dragHandler.state.isDragging) {
				locked = !locked;
				if (locked && Vars.player.unit()) {
					lockX = Vars.player.unit().x;
					lockY = Vars.player.unit().y;
				}
			}
		})
		.size(50)
		.get();

	btn.addListener(dragHandler.listener);
	dragHandler.bind(table);

	table.update(() => {
		let unit = Vars.player.unit();
		if (!unit || unit.dead) {
			reset = true;
			return;
		}

		if (reset) {
			lockX = unit.x;
			lockY = unit.y;
		}

		if (locked) {
			unit.vel.set(0, 0);
			btn.color.set(Color.scarlet);
		} else {
			btn.color.set(Color.white);
		}
	});
};

Events.on(ClientLoadEvent, () => {
	buildUI();
});

Events.on(WorldLoadEvent, () => {
	locked = false;
});
