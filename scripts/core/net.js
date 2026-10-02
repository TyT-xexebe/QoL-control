const { LAST_IP_KEY, VANILLA_IP_KEY } = require('qol-control/core/settings-keys');

// Returns true if the current server (or, when not connected, the last known
// IP) matches any entry in a comma-separated list of `ip` / `ip:port`
// patterns. An empty list allows everything. Shared by core/bind.js and
// ui/cbinds.js, which previously each carried an identical copy.
function isAllowedOnServer(ipsStr) {
	if (!ipsStr) return true;

	let currentIpOnly = null;
	let currentIpAndPort = null;

	try {
		if (Vars.net.active() && Vars.net.client()) {
			let hostField = Vars.netClient.getClass().getDeclaredField('host');
			hostField.setAccessible(true);
			let currentHost = hostField.get(Vars.netClient);
			if (currentHost) {
				let address = String(currentHost.address);
				if (address.startsWith('/')) address = address.substring(1);
				if (address.indexOf(':') !== -1) {
					address = address.split(':')[0];
				}
				currentIpOnly = address;
				currentIpAndPort = address + ':' + String(currentHost.port);
			}
		}
	} catch (e) {}

	if (!currentIpOnly) {
		let lastIp = String(Core.settings.getString(LAST_IP_KEY, ''));
		if (lastIp) {
			if (lastIp.startsWith('/')) lastIp = lastIp.substring(1);
			currentIpOnly = lastIp;
			currentIpAndPort = lastIp;
		}
	}
	if (!currentIpOnly) {
		let ipSetting = String(Core.settings.getString(VANILLA_IP_KEY, ''));
		if (ipSetting) {
			if (ipSetting.startsWith('/')) ipSetting = ipSetting.substring(1);
			currentIpOnly = ipSetting;
			currentIpAndPort = ipSetting;
		}
	}

	if (!currentIpOnly) return false;

	let ips = ipsStr.split(',').map(s => String(s).trim().toLowerCase());

	for (let i = 0; i < ips.length; i++) {
		let pattern = ips[i];
		if (pattern.indexOf(':') !== -1) {
			if (currentIpAndPort && currentIpAndPort.toLowerCase() === pattern) {
				return true;
			}
		} else {
			if (currentIpOnly && currentIpOnly.toLowerCase() === pattern) {
				return true;
			}
		}
	}
	return false;
}

module.exports = { isAllowedOnServer: isAllowedOnServer };
