module.exports = {
	notify: function (text) {
		if (typeof text !== 'string') text = String(text);
		text = text.replace(/^([\n\r]|\\n)+/, '');
		var colorMap = {
			accent: 'f59e0b',
			lightgray: 'a1a1aa',
			lightgrey: 'a1a1aa',
			gray: '71717a',
			grey: '71717a',
			green: '10b981',
			red: 'f43f5e',
			scarlet: 'f43f5e',
			coral: 'f43f5e',
			cyan: '06b6d4',
			yellow: 'fbbf24',
			orange: 'f97316',
			blue: '3b82f6',
			white: 'f4f4f5',
		};
		for (var key in colorMap) {
			var regex = new RegExp('\\[' + key + '\\]', 'gi');
			text = text.replace(regex, '[#' + colorMap[key] + ']');
		}
		text = text.replace(/\[\]/g, '[#f4f4f5]');
		var prefix = '[#d97706]qol [#71717a]» [#f4f4f5]';
		Vars.ui.chatfrag.addMessage(prefix + text);
	},
	info: function (text) {
		Log.info('[QoL] ' + text);
	},
	err: function (text) {
		Log.err('[QoL Error] ' + text);
	},
};
