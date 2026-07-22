const mBaseDialog = Packages.mindustry.ui.dialogs.BaseDialog;
const mTable = Packages.arc.scene.ui.layout.Table;
const mScrollPane = Packages.arc.scene.ui.ScrollPane;

let currentVersion = "1.0";
try {
	let mod = Vars.mods.getMod('qol-control');
	if (mod && mod.meta && mod.meta.version) {
		currentVersion = String(mod.meta.version);
	}
} catch (e) {}

let welcomeData = {
	guideTitle: "Welcome",
	guideText: "",
	guideButton: "OK",
	githubButton: "",
	githubUrl: "",
	updateTitle: "Updated",
	updateText: "",
	updateButton: "OK"
};

try {
	let mod = Vars.mods.getMod('qol-control');
	if (mod) {
		let file = mod.root.child('scripts').child('welcome.json');
		if (file.exists()) {
			let parsed = JSON.parse(file.readString());
			for (let key in parsed) {
				welcomeData[key] = parsed[key];
			}
		}
	}
} catch (e) {}

function isVersionNewer(current, stored) {
	if (!current) return false;
	if (!stored) return true;
	if (current === stored) return false;

	let cParts = current.split('.');
	let sParts = stored.split('.');
	let len = Math.max(cParts.length, sParts.length);

	for (let i = 0; i < len; i++) {
		let cNum = parseInt(cParts[i] || '0', 10);
		let sNum = parseInt(sParts[i] || '0', 10);
		if (cNum > sNum) return true;
		if (cNum < sNum) return false;
	}
	return false;
}

function showFirstGuideDialog(version) {
	let dialog = new mBaseDialog(welcomeData.guideTitle);
	
	let table = new mTable();
	table.top().left();
	table.defaults().left().pad(4);

	let text = welcomeData.guideText;
	let lines = text.split("\n");
	for (let i = 0; i < lines.length; i++) {
		table.add(lines[i]).row();
	}

	let scroll = new mScrollPane(table);
	dialog.cont.add(scroll).width(1200).height(Core.graphics.getHeight() * 0.7).pad(10);

	if (welcomeData.githubButton && welcomeData.githubUrl) {
		dialog.buttons.button(welcomeData.githubButton, run(() => {
			Core.app.openURI(welcomeData.githubUrl);
		})).size(200, 50);
	}

	dialog.buttons.button(welcomeData.guideButton, run(() => {
		Core.settings.put('qol-first-guide', true);
		Core.settings.put('qol-mod-version', version);
		if (typeof Core.settings.forceSave === 'function') {
			Core.settings.forceSave();
		}
		dialog.hide();
	})).size(200, 50);

	dialog.show();
}

function showUpdateDialog(current, stored) {
	let dialog = new mBaseDialog(welcomeData.updateTitle);
	
	let table = new mTable();
	table.top().left();
	table.defaults().left().pad(4);

	let text = welcomeData.updateText;
	text = text.replace("{version}", current).replace("{previous}", stored);
	
	let lines = text.split("\n");
	for (let i = 0; i < lines.length; i++) {
		table.add(lines[i]).row();
	}

	let scroll = new mScrollPane(table);
	dialog.cont.add(scroll).width(1200).height(Core.graphics.getHeight() * 0.6).pad(10);

	if (welcomeData.githubButton && welcomeData.githubUrl) {
		dialog.buttons.button(welcomeData.githubButton, run(() => {
			Core.app.openURI(welcomeData.githubUrl);
		})).size(200, 50);
	}

	dialog.buttons.button(welcomeData.updateButton, run(() => {
		Core.settings.put('qol-mod-version', current);
		if (typeof Core.settings.forceSave === 'function') {
			Core.settings.forceSave();
		}
		dialog.hide();
	})).size(200, 50);

	dialog.show();
}

function showWelcomeOrUpdate() {
	let hasShownGuide = Core.settings.getBool('qol-first-guide', false);
	let storedVersion = Core.settings.getString('qol-mod-version', '0.0.0');

	if (!hasShownGuide) {
		showFirstGuideDialog(currentVersion);
	} else if (isVersionNewer(currentVersion, storedVersion)) {
		showUpdateDialog(currentVersion, storedVersion);
	}
}

if (!Vars.headless) {
	Events.on(ClientLoadEvent, cons((e) => {
		Time.run(30, run(() => {
			showWelcomeOrUpdate();
		}));
	}));
}
