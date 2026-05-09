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
			offsetX: 0,
			offsetY: 0,
		};

		const listener = extend(InputListener, {
			touchDown(event, x, y, pointer, button) {
				state.isDragging = false;
				state.startX = x;
				state.startY = y;
				state.offsetX = event.stageX - state.x;
				state.offsetY = event.stageY - state.y;
				return true;
			},
			touchDragged(event, x, y, pointer) {
				if (
					!state.isDragging &&
					(Math.abs(x - state.startX) > 5 ||
						Math.abs(y - state.startY) > 5)
				) {
					state.isDragging = true;
				}
				if (state.isDragging) {
					state.x = event.stageX - state.offsetX;
					state.y = event.stageY - state.offsetY;
					if (onDragUpdate) onDragUpdate(state.x, state.y);
				}
				return true;
			},
			touchUp(event, x, y, pointer) {
				Core.settings.put(settingsKeyX, new java.lang.Float(state.x));
				Core.settings.put(settingsKeyY, new java.lang.Float(state.y));
				Timer.schedule(() => {
					state.isDragging = false;
				}, 0.1);
				return true;
			},
		});

		return {
			state: state,
			listener: listener,
			attach: function (element) {
				element.addListener(listener);
				element.setPosition(state.x, state.y);
			},
		};
	},
};
