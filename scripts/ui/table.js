const uiUtils = require('qol-control/ui/utils');
const notify = require('qol-control/core/logger').notify;
const interceptor = require('qol-control/core/interceptor');

var cfg = {
	rows: Core.settings.getInt('qol-schem-rows', 4),
	cols: Core.settings.getInt('qol-schem-cols', 4),
	size: Core.settings.getInt('qol-schem-size', 32),
	enabled: Core.settings.getBool('qol-schem-enabled', false),
	slots: {},
};

try {
	cfg.slots = JSON.parse(Core.settings.getString('qol-schem-slots', '{}'));
} catch (e) {
	cfg.slots = {};
}

var saveCfg = () => {
	Core.settings.put('qol-schem-rows', new java.lang.Integer(cfg.rows));
	Core.settings.put('qol-schem-cols', new java.lang.Integer(cfg.cols));
	Core.settings.put('qol-schem-size', new java.lang.Integer(cfg.size));
	Core.settings.put('qol-schem-enabled', new java.lang.Boolean(cfg.enabled));
	Core.settings.put('qol-schem-slots', JSON.stringify(cfg.slots));
};

var getIcon = (name, typeStr) => {
	if (!name) return Icon.add.getRegion();

	if (typeStr && ContentType[typeStr]) {
		let c = Vars.content.getByName(ContentType[typeStr], name);
		if (c) return c.uiIcon;
	}

	let c =
		Vars.content.getByName(ContentType.block, name) ||
		Vars.content.getByName(ContentType.item, name) ||
		Vars.content.getByName(ContentType.liquid, name) ||
		Vars.content.getByName(ContentType.unit, name);
	return c ? c.uiIcon : Icon.add.getRegion();
};

Events.on(EventType.ClientLoadEvent, (e) => {
	let allIcons = [];

	Vars.content.getBy(ContentType.block).each((c) => {
		if (
			c.uiIcon &&
			c.uiIcon !== Core.atlas.find('error') &&
			c.uiIcon !== Core.atlas.find('clear')
		) {
			allIcons.push({
				name: String(c.name),
				type: 'block',
				icon: c.uiIcon,
				order: c.category ? c.category.ordinal() * 100 : 0,
			});
		}
	});

	const addIcons = (type, typeStr, typeOrder) => {
		Vars.content.getBy(type).each((c) => {
			if (
				c.uiIcon &&
				c.uiIcon !== Core.atlas.find('error') &&
				c.uiIcon !== Core.atlas.find('clear')
			) {
				allIcons.push({
					name: String(c.name),
					type: typeStr,
					icon: c.uiIcon,
					order: typeOrder,
				});
			}
		});
	};

	addIcons(ContentType.item, 'item', 10000);
	addIcons(ContentType.liquid, 'liquid', 10001);
	addIcons(ContentType.unit, 'unit', 10002);
	allIcons.sort((a, b) =>
		a.order !== b.order ? a.order - b.order : a.name.localeCompare(b.name)
	);

	let uiTable = new Table(Styles.black5);
	uiTable.margin(0);
	let gridTable = new Table();
	gridTable.margin(0);
	let tableX = Core.settings.getFloat(
		'qol-schem-x',
		Core.graphics.getWidth() / 2
	);
	let tableY = Core.settings.getFloat(
		'qol-schem-y',
		Core.graphics.getHeight() / 2
	);
	let dragHandler,
		lastClickTime = 0,
		lastClickSlot = -1;

	dragHandler = uiUtils.setupDrag(
		'qol-schem-x',
		'qol-schem-y',
		tableX,
		tableY,
		(x, y) => {
			tableX = Mathf.clamp(
				x,
				0,
				Core.graphics.getWidth() - uiTable.getWidth()
			);
			tableY = Mathf.clamp(
				y,
				0,
				Core.graphics.getHeight() - uiTable.getHeight()
			);
			uiTable.setPosition(tableX, tableY);
		}
	);
	dragHandler.attach(uiTable);

	const openConfig = (idx) => {
		let dialog = new BaseDialog('');
		dialog.addCloseButton();
		let slot = cfg.slots[idx] || { schem: '', icon: null, type: null };
		let currentSchem = slot.schem;
		let currentIconName = slot.icon;
		let currentIconType = slot.type;

		let t = new Table();
		t.add('Schematic: ').padRight(8);
		t.field(currentSchem, (s) => {
			currentSchem = s;
		}).width(300);
		dialog.cont.add(t).row();

		let iconPane = new Table();
		let colsCount = 0;
		for (let i = 0; i < allIcons.length; i++) {
			let ic = allIcons[i];
			iconPane
				.button(
					new TextureRegionDrawable(ic.icon),
					Styles.clearNonei,
					32,
					() => {
						currentIconName = ic.name;
						currentIconType = ic.type;
						dialog.title.setText(ic.name);
					}
				)
				.size(40);
			if (++colsCount % 10 === 0) iconPane.row();
		}

		dialog.cont
			.add(new ScrollPane(iconPane))
			.size(520, 300)
			.padTop(10)
			.row();

		dialog.buttons
			.button('@ok', Icon.ok, () => {
				cfg.slots[idx] = {
					schem: currentSchem,
					icon: currentIconName,
					type: currentIconType,
				};
				saveCfg();
				rebuildGrid();
				dialog.hide();
			})
			.size(150, 50);

		dialog.buttons
			.button('@cancel', Icon.cancel, () => {
				delete cfg.slots[idx];
				saveCfg();
				rebuildGrid();
				dialog.hide();
			})
			.size(150, 50);

		dialog.show();
	};

	const rebuildGrid = () => {
		gridTable.clear();
		let iconSize = Math.max(8, cfg.size - 8);
		for (let r = 0; r < cfg.rows; r++) {
			for (let c = 0; c < cfg.cols; c++) {
				let idx = r * cfg.cols + c;
				let slot = cfg.slots[idx];
				gridTable
					.button(
						new TextureRegionDrawable(
							getIcon(
								slot ? slot.icon : null,
								slot ? slot.type : null
							)
						),
						Styles.clearNonei,
						iconSize,
						() => {
							if (dragHandler && dragHandler.state.isDragging)
								return;
							let time = Time.millis();
							if (
								time - lastClickTime < 300 &&
								lastClickSlot === idx
							)
								openConfig(idx);
							else if (slot && slot.schem) {
								let s = Vars.schematics
									.all()
									.find(
										(sc) => String(sc.name()) === slot.schem
									);
								if (s) Vars.control.input.useSchematic(s);
								else
									notify(
										'[scarlet]Schematic not found: ' +
											slot.schem
									);
							}
							lastClickTime = time;
							lastClickSlot = idx;
						}
					)
					.size(cfg.size);
			}
			gridTable.row();
		}
		uiTable.pack();
	};

	interceptor.add('table', (args) => {
		let sub = args[1] ? args[1].toLowerCase() : '';
		let val = args[2] ? parseInt(args[2]) : 0;

		if (sub === 'rows' && val > 0) {
			cfg.rows = val;
			saveCfg();
			rebuildGrid();
			notify('[lightgray]Rows set to [accent]' + val);
		} else if (sub === 'cols' && val > 0) {
			cfg.cols = val;
			saveCfg();
			rebuildGrid();
			notify('[lightgray]Columns set to [accent]' + val);
		} else if (sub === 'size' && val > 0) {
			cfg.size = val;
			saveCfg();
			rebuildGrid();
			notify('[lightgray]Size set to [accent]' + val);
		} else if (sub === 'reset') {
			cfg.rows = 4;
			cfg.cols = 4;
			cfg.size = 32;
			cfg.slots = {};
			saveCfg();
			tableX = Core.graphics.getWidth() / 2;
			tableY = Core.graphics.getHeight() / 2;
			Core.settings.put('qol-schem-x', new java.lang.Float(tableX));
			Core.settings.put('qol-schem-y', new java.lang.Float(tableY));
			rebuildGrid();
			notify('[lightgray]Table [green]RESET');
		} else if (sub === 'help') {
			notify(
				'[lightgray]!table\n!table <1/0?>\n!table rows <val>\n!table cols <val>\n!table size <val>\n!table reset'
			);
		} else {
			if (sub && !interceptor.isBooleanArg(sub)) {
				notify(
					'[scarlet]Unknown command option\n[lightgray]!table <1/0?> or !table rows/cols/size/reset'
				);
				return;
			}
			cfg.enabled = interceptor.parseToggle(cfg.enabled, args[1]);
			saveCfg();
			notify(
				'[lightgray]Table ' +
					(cfg.enabled ? '[green]ON' : '[scarlet]OFF')
			);
		}
	});

	uiTable.add(gridTable);
	rebuildGrid();

	Events.run(Trigger.update, () => {
		uiTable.visible =
			cfg.enabled && Vars.state.isGame() && Vars.ui.hudfrag.shown;
		if (!uiTable.visible) return;
		tableX = Mathf.clamp(
			tableX,
			0,
			Core.graphics.getWidth() - uiTable.getWidth()
		);
		tableY = Mathf.clamp(
			tableY,
			0,
			Core.graphics.getHeight() - uiTable.getHeight()
		);
		uiTable.setPosition(tableX, tableY);
	});

	Vars.ui.hudGroup.addChild(uiTable);
});
