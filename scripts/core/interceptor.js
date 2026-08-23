const commands = {};
const packetModifiers = [];

function registerCommand(name, handler) {
	commands[name.toLowerCase()] = handler;
}

function addPacketModifier(modifier) {
	packetModifiers.push(modifier);
}

function cleanColors(str) {
	if (!str) return '';
	try {
		if (typeof Strings !== 'undefined' && typeof Strings.stripColors === 'function') {
			return String(Strings.stripColors(str));
		}
	} catch (e) {}
	return String(str).replace(/\[([a-zA-Z0-9#_]+|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8})?\]/g, '');
}

function handleCommand(msg) {
	let raw = cleanColors(msg);

	let fooState = Core.settings.getBool('qol-control-foo-client', false);
	if (fooState && raw.length > 1) {
		raw = raw.replace(
			/[\s\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\uE000-\uF8FF\uFFF0-\uFFFF\x00-\x1F\u0F80-\u107F]+$/,
			''
		);
	}

	let cleanMsg = raw.replace(/^\/(t|a)\s+/i, '');

	if (!cleanMsg.startsWith('!') && !cleanMsg.startsWith('?')) return false;
	let args = cleanMsg.substring(1).split(' ');
	let cmd = args[0].toLowerCase();

	if (commands.hasOwnProperty(cmd)) {
		try {
			commands[cmd](args, cleanMsg);
		} catch (e) {
			Log.err('[QoL Exception] Command ' + cmd + ' failed: ' + e + '\n' + (e.stack || ''));
		}

		return true;
	}
	return false;
}

Events.on(ClientLoadEvent, (e) => {
	try {
		const NetProvider = Packages.mindustry.net.Net.NetProvider;
		const providerField = Vars.net.getClass().getDeclaredField('provider');
		providerField.setAccessible(true);
		const originalProvider = providerField.get(Vars.net);

		let resolvedProvider = originalProvider;
		while (
			resolvedProvider &&
			(String(resolvedProvider).indexOf('ChatInterceptorProxy') !== -1 ||
				Packages.java.lang.reflect.Proxy.isProxyClass(
					resolvedProvider.getClass()
				) ||
				typeof resolvedProvider.getOriginalProvider === 'function')
		) {
			if (
				Packages.java.lang.reflect.Proxy.isProxyClass(
					resolvedProvider.getClass()
				)
			) {
				let handler =
					Packages.java.lang.reflect.Proxy.getInvocationHandler(
						resolvedProvider
					);
				if (handler && handler.originalProvider) {
					resolvedProvider = handler.originalProvider;
					continue;
				}
			}
			if (typeof resolvedProvider.getOriginalProvider === 'function') {
				let next = resolvedProvider.getOriginalProvider();
				if (next && next !== resolvedProvider) {
					resolvedProvider = next;
					continue;
				}
			}
			break;
		}

		let isRhino = false;
		try {
			Packages.org.mozilla.javascript.Context;
			isRhino = true;
		} catch (ctxErr) {}

		function withContext(fn) {
			return function () {
				let entered = false;
				if (isRhino) {
					try {
						let current =
							Packages.org.mozilla.javascript.Context.getCurrentContext();
						if (!current) {
							Packages.org.mozilla.javascript.Context.enter();
							entered = true;
						}
					} catch (e) {
						try {
							Packages.org.mozilla.javascript.Context.enter();
							entered = true;
						} catch (ce) {}
					}
				}
				try {
					return fn.apply(this, arguments);
				} finally {
					if (entered && isRhino) {
						try {
							Packages.org.mozilla.javascript.Context.exit();
							} catch (e) {}
					}
				}
			};
		}

		function findSendClientMethod(clazz) {
			let current = clazz;
			while (current != null) {
				let interfaces = current.getInterfaces();
				for (let i = 0; i < interfaces.length; i++) {
					let name = String(interfaces[i].getName());
					if (
						name.indexOf('NetProvider') !== -1 ||
						name.indexOf('arc.Net') !== -1 ||
						name.indexOf('mindustry.net') !== -1
					) {
						let methods = interfaces[i].getMethods();
						for (let j = 0; j < methods.length; j++) {
							if (
								String(methods[j].getName()) === 'sendClient' &&
								methods[j].getParameterTypes().length === 2
							) {
								return methods[j];
							}
						}
					}
				}
				current = current.getSuperclass();
			}
			return null;
		}

		let sendClientMethod = null;
		try {
			sendClientMethod = findSendClientMethod(
				originalProvider.getClass()
			);
		} catch (e) {
			Log.err('[Interceptor] Error finding sendClient: ' + e);
		}

		if (
			String(originalProvider).indexOf('ChatInterceptorProxy') === -1 ||
			resolvedProvider !== originalProvider
		) {
			const proxy = extend(NetProvider, {
				getOriginalProvider: withContext(function () {
					return resolvedProvider;
				}),

				connectClient: withContext(function (ip, port, success) {
					resolvedProvider.connectClient(ip, port, success);
				}),

				sendClient: withContext(function (object, reliable) {
					try {
						if (object != null) {
							let className = String(
								object.getClass().getSimpleName()
							).toLowerCase();
							if (
								className.indexOf('chat') !== -1 ||
								className.indexOf('message') !== -1
							) {
								try {
									let msgField = object
										.getClass()
										.getField('message');
									let msg = msgField.get(object);
									if (msg && handleCommand(msg)) {
										return;
									}
								} catch (cmdErr) {}
							}

							for (let i = 0; i < packetModifiers.length; i++) {
								try {
									packetModifiers[i](object);
								} catch (modifierErr) {}
							}
						}
					} catch (procErr) {}

					try {
						if (sendClientMethod) {
							sendClientMethod.invoke(resolvedProvider, [
								object,
								java.lang.Boolean.valueOf(reliable),
							]);
						} else {
							resolvedProvider.sendClient(object, reliable);
						}
					} catch (invokeErr) {}
				}),

				disconnectClient: withContext(function () {
					resolvedProvider.disconnectClient();
				}),
				discoverServers: withContext(function (callback, done) {
					resolvedProvider.discoverServers(callback, done);
				}),
				pingHost: withContext(function (address, port, valid, failed) {
					resolvedProvider.pingHost(address, port, valid, failed);
				}),
				hostServer: withContext(function (port) {
					resolvedProvider.hostServer(port);
				}),
				getConnections: withContext(function () {
					return resolvedProvider.getConnections();
				}),
				closeServer: withContext(function () {
					resolvedProvider.closeServer();
				}),
				dispose: withContext(function () {
					resolvedProvider.dispose();
				}),
				setConnectFilter: withContext(function (filter) {
					resolvedProvider.setConnectFilter(filter);
				}),
				getConnectFilter: withContext(function () {
					return resolvedProvider.getConnectFilter();
				}),

				toString: withContext(function () {
					return 'ChatInterceptorProxy';
				}),
			});

			providerField.set(Vars.net, proxy);
		}
	} catch (e) {}

	try {
		const ChatFilter = Packages.mindustry.net.Administration.ChatFilter;

		let filtersField = Vars.netServer.admins
			.getClass()
			.getDeclaredField('chatFilters');
		filtersField.setAccessible(true);
		let filters = filtersField.get(Vars.netServer.admins);

		let alreadyAdded = false;
		for (let i = 0; i < filters.size; i++) {
			if (String(filters.get(i)).indexOf('HostChatInterceptor') !== -1) {
				alreadyAdded = true;
				break;
			}
		}

		if (!alreadyAdded) {
			let filter = extend(ChatFilter, {
				filter: withContext(function (player, text) {
					if (player === Vars.player && text) {
						if (handleCommand(text)) {
							return null;
						}
					}
					return text;
				}),
				toString: withContext(function () {
					return 'HostChatInterceptor';
				}),
			});

			Vars.netServer.admins.addChatFilter(filter);
		}
	} catch (e) {}
});

function isBooleanArg(arg) {
	if (!arg) return true;
	let lower = String(arg).toLowerCase();
	return lower === '1' || lower === '0' || lower === 'true' || lower === 'false' || lower === 'on' || lower === 'off' || lower === 'yes' || lower === 'no';
}

function parseToggle(current, arg) {
	if (!arg) return !current;
	arg = String(arg).toLowerCase();
	if (arg === '1' || arg === 'true' || arg === 'on' || arg === 'yes')
		return true;
	if (arg === '0' || arg === 'false' || arg === 'off' || arg === 'no')
		return false;
	return !current;
}

module.exports = {
	add: registerCommand,
	parseToggle: parseToggle,
	isBooleanArg: isBooleanArg,
	addPacketModifier: addPacketModifier,
	cleanColors: cleanColors,
};
