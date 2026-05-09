const uiUtils = require('qol-control/ui/utils');
let setup = false;
let infoTable;
let infoLabel;
let lastText = '';
let targetBuild = null;
let lastTapBuild = null;
let lastBuild = null;
let timer = 0;

let dragHandler;

const formatNum = (n) => {
	let num = Number(n);
	let abs = Math.abs(num);
	if (abs >= 1000000) return Math.round(num / 100000) / 10 + 'm';
	if (abs >= 1000) return Math.round(num / 100) / 10 + 'k';
	return Math.floor(num).toString();
};

const initUI = () => {
	if (setup || !Vars.ui || !Vars.ui.hudGroup) return;
	setup = true;

	infoTable = new Table(Tex.pane);
	infoTable.touchable = Packages.arc.scene.event.Touchable.enabled;

	infoLabel = new Label('');
	infoLabel.setWrap(true);
	infoLabel.setAlignment(Packages.arc.util.Align.topLeft);
	infoLabel.setFontScale(0.9);
	infoTable.add(infoLabel).width(180).pad(10);

	infoTable.pack();

	Vars.ui.hudGroup.addChild(infoTable);

	dragHandler = uiUtils.setupDrag('binfo-x', 'binfo-y', 15, 180, (x, y) => {
		let nx = Mathf.clamp(
			x,
			0,
			Core.scene.getWidth() - infoTable.getWidth()
		);
		let ny = Mathf.clamp(
			y,
			0,
			Core.scene.getHeight() - infoTable.getHeight()
		);
		infoTable.setPosition(nx, ny);
	});
	dragHandler.attach(infoTable);
};

if (Vars.ui && Vars.ui.hudGroup) initUI();
else Events.on(ClientLoadEvent, initUI);

Events.run(Trigger.update, () => {
	if (!setup || !infoTable) return;

	if (!Vars.state.isGame() || !Vars.ui.hudfrag.shown) {
		infoTable.visible = false;
		return;
	}

	if (Vars.mobile) {
		if (
			Core.input.isTouched() &&
			!Core.scene.hasMouse() &&
			!(dragHandler && dragHandler.state.isDragging)
		) {
			lastTapBuild = Vars.world.buildWorld(
				Core.input.mouseWorldX(),
				Core.input.mouseWorldY()
			);
		}
		targetBuild = lastTapBuild;
	} else {
		targetBuild = Vars.world.buildWorld(
			Core.input.mouseWorldX(),
			Core.input.mouseWorldY()
		);
	}

	if (targetBuild == null || !targetBuild.isValid()) {
		infoTable.visible = false;
		return;
	}

	infoTable.visible = true;
	timer += Time.delta;

	if (dragHandler) {
		dragHandler.state.x = Mathf.clamp(
			dragHandler.state.x,
			0,
			Core.scene.getWidth() - infoTable.getWidth()
		);
		dragHandler.state.y = Mathf.clamp(
			dragHandler.state.y,
			0,
			Core.scene.getHeight() - infoTable.getHeight()
		);
		infoTable.setPosition(dragHandler.state.x, dragHandler.state.y);
	}

	if (timer > 10 || lastBuild !== targetBuild) {
		timer = 0;
		lastBuild = targetBuild;

		let tName = targetBuild.team ? targetBuild.team.name : 'unknown';
		let text =
			'[accent]' +
			targetBuild.block.localizedName +
			' [lightgray](' +
			tName +
			')\n';
		text +=
			'[#ff8888]HP: [white]' +
			formatNum(targetBuild.health) +
			' / ' +
			formatNum(targetBuild.maxHealth) +
			'\n';

		if (targetBuild.items != null) {
			let itemStr = '';
			Vars.content.items().each(
				cons((item) => {
					let amt = targetBuild.items.get(item);
					if (amt > 0) itemStr += item.emoji() + formatNum(amt) + ' ';
				})
			);
			if (itemStr !== '') text += itemStr + '\n';
		}

		if (targetBuild.liquids != null) {
			let liqStr = '';
			Vars.content.liquids().each(
				cons((liq) => {
					let amt = targetBuild.liquids.get(liq);
					if (amt > 0) liqStr += liq.emoji() + formatNum(amt) + ' ';
				})
			);
			if (liqStr !== '') text += liqStr + '\n';
		}

		if (targetBuild.power != null) {
			if (targetBuild.power.graph != null) {
				let bal = targetBuild.power.graph.getPowerBalance() * 60;
				let sign = bal > 0 ? '+' : '';
				let color =
					bal > 0 ? '[green]' : bal < 0 ? '[scarlet]' : '[white]';
				text +=
					'[#ffaa55]Power: ' + color + sign + formatNum(bal) + '\n';

				if (targetBuild.power.graph.getTotalBatteryCapacity() > 0) {
					text +=
						'[#ffaa55]Bat: [white]' +
						formatNum(targetBuild.power.graph.getBatteryStored()) +
						' / ' +
						formatNum(
							targetBuild.power.graph.getTotalBatteryCapacity()
						) +
						'\n';
				}
			} else {
				text += '[#ffaa55]Power: [white]0\n';
			}
		}

		text = text.trim();
		if (lastText !== text) {
			infoLabel.setText(text);
			lastText = text;
			infoTable.pack();
		}
	}
});
