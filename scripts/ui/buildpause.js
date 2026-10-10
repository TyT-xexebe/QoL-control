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
		210
	);

	// The listener lives on the button (so the button still handles left clicks),
	// while bind() places the table and re-anchors it on every window resize.
	// Dragging is bound to the right mouse button on desktop.
	btn.addListener(dragHandler.listener);
	dragHandler.bind(table);

	table.update(() => {
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
