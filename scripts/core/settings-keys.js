// Settings keys that are shared as a contract between multiple modules.
// Module-local keys (e.g. 'qol-binds', 'qol-cbinds', 'qol-last-port') stay
// defined where they're used — only cross-file shared state belongs here.
module.exports = {
	// Last IP the player connected to via the mod's own "connect" flow
	// (features/server.js writes it; core/net.js reads it as a fallback when
	// deciding whether an IP-restricted bind/button is allowed to run).
	LAST_IP_KEY: 'qol-last-ip',

	// Vanilla Mindustry's own "last connected server IP" setting, used by
	// the game's built-in reconnect UI. Not mod-specific — do not prefix.
	VANILLA_IP_KEY: 'ip',
};
