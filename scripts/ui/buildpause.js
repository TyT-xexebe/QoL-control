const uiUtils = require('qol-control/ui/utils');
let dragHandler;

const buildUI = () => {
	let table = new Table(Tex.buttonTrans);
	Vars.ui.hudGroup.addChild(table);

	let btn = table
		.button(Icon.pause, Styles.clearNonei, () => {
			if (!(dragHandler && dragHandler.state.isDragging)) {
				Vars.control.input.isBuilding = !Vars.control.input.isBuilding;
			}
		})
		.size(50)
		.get();

	dragHandler = uiUtils.setupDrag(
		'pause-build-btn-x',
		'pause-build-btn-y',
		150,
		210,
		(x, y) => {
			let nx = Mathf.clamp(x, 25, Core.graphics.getWidth() - 25);
			let ny = Mathf.clamp(y, 25, Core.graphics.getHeight() - 25);
			table.setPosition(nx, ny);
		}
	);
	// Attach listener to button, but don't let attach() set position of button
	btn.addListener(dragHandler.listener);
	// Explicitly set position of table
	table.setPosition(
		Mathf.clamp(dragHandler.state.x, 25, Core.graphics.getWidth() - 25),
		Mathf.clamp(dragHandler.state.y, 25, Core.graphics.getHeight() - 25)
	);

	table.update(() => {
		if (dragHandler)
			table.setPosition(
				Mathf.clamp(
					dragHandler.state.x,
					25,
					Core.graphics.getWidth() - 25
				),
				Mathf.clamp(
					dragHandler.state.y,
					25,
					Core.graphics.getHeight() - 25
				)
			);

		if (!Vars.control.input.isBuilding) {
			btn.getStyle().imageUp = Icon.play;
			btn.color.set(Color.scarlet);
		} else {
			btn.getStyle().imageUp = Icon.pause;
			btn.color.set(Color.white);
		}
	});
};

Events.on(ClientLoadEvent, () => {
	buildUI();
});
