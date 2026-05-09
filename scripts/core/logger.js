module.exports = {
	notify: function (text) {
		// Unify lightgray/lightgray and remove starting newline from text if any
		Vars.ui.chatfrag.addMessage(
			'[accent][QoL][]\n' +
				text
					.replace(/^([\n\r]|\\n)+/, '')
					.replace(/lightgray/g, 'lightgray')
		);
	},
	info: function (text) {
		Log.info('[QoL] ' + text);
	},
	err: function (text) {
		Log.err('[QoL Error] ' + text);
	},
};
