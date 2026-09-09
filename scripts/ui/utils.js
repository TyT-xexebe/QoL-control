module.exports = {
	setupDrag: function (
		settingsKeyX,
		settingsKeyY,
		defaultX,
		defaultY,
		onDragUpdate
	) {
		let state = {
			x: Core.settings.getFloat(settingsKeyX, defaultX),
			y: Core.settings.getFloat(settingsKeyY, defaultY),
			isDragging: false,
			startX: 0,
			startY: 0,
			startStageX: 0,
			startStageY: 0,
			offsetX: 0,
			offsetY: 0,
			attachedElement: null,
		};

		const listener = extend(InputListener, {
			touchDown(event, x, y, pointer, button) {
				state.isDragging = false;
				state.startX = x;
				state.startY = y;
				state.startStageX = event.stageX;
				state.startStageY = event.stageY;

				let curX = state.attachedElement
					? state.attachedElement.x
					: state.x;
				let curY = state.attachedElement
					? state.attachedElement.y
					: state.y;

				state.offsetX = event.stageX - curX;
				state.offsetY = event.stageY - curY;
				state.x = curX;
				state.y = curY;
				return true;
			},
			touchDragged(event, x, y, pointer) {
				if (
					!state.isDragging &&
					(Math.abs(event.stageX - state.startStageX) > 5 ||
						Math.abs(event.stageY - state.startStageY) > 5)
				) {
					state.isDragging = true;
				}
				if (state.isDragging) {
					let newX = event.stageX - state.offsetX;
					let newY = event.stageY - state.offsetY;
					if (onDragUpdate) onDragUpdate(newX, newY);
					if (state.attachedElement) {
						state.x = state.attachedElement.x;
						state.y = state.attachedElement.y;
					} else {
						state.x = newX;
						state.y = newY;
					}
				}
				return true;
			},
			touchUp(event, x, y, pointer) {
				if (state.attachedElement) {
					state.x = state.attachedElement.x;
					state.y = state.attachedElement.y;
				}
				Core.settings.put(settingsKeyX, new java.lang.Float(state.x));
				Core.settings.put(settingsKeyY, new java.lang.Float(state.y));
				try {
					Time.run(
						6,
						run(() => {
							state.isDragging = false;
						})
					);
				} catch (err) {
					try {
						Timer.schedule(
							run(() => {
								state.isDragging = false;
							}),
							0.1
						);
					} catch (e2) {
						state.isDragging = false;
					}
				}
				return true;
			},
		});

		return {
			state: state,
			listener: listener,
			attach: function (element) {
				state.attachedElement = element;
				element.addListener(listener);
				element.setPosition(state.x, state.y);
			},
		};
	},
};
