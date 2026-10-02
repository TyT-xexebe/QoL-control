// Shared chat-sending helper.
// Splits text on newlines and further splits any line over 150 chars
// (Mindustry's chat message length limit) into multiple sendChatMessage calls.
module.exports = {
	executeChat: function (text) {
		if (!text) return;
		let lines = text.split('\n');
		for (let i = 0; i < lines.length; i++) {
			let line = lines[i];
			if (line.length > 0) {
				while (line.length > 150) {
					Call.sendChatMessage(line.substring(0, 150));
					line = line.substring(150);
				}
				if (line.length > 0) {
					Call.sendChatMessage(line);
				}
			}
		}
	},
};
