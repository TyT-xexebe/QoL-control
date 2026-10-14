const interceptor = require('qol-control/core/interceptor');

const mColor = Packages.arc.graphics.Color;
const mTex = Packages.mindustry.gen.Tex;
const mCore = Packages.arc.Core;
const mIcon = Packages.mindustry.gen.Icon;
const mStyles = Packages.mindustry.ui.Styles;
const mTable = Packages.arc.scene.ui.layout.Table;
const mBaseDialog = Packages.mindustry.ui.dialogs.BaseDialog;
const mScrollPane = Packages.arc.scene.ui.ScrollPane;
const mImage = Packages.arc.scene.ui.Image;
const mTextField = Packages.arc.scene.ui.TextField;
const mImageButton = Packages.arc.scene.ui.ImageButton;

const PREFIX = 'qol-pal-';
let colors = [];
let initialized = false;

const isHex = (str) => {
	if (str.length !== 6 && str.length !== 8) return false;
	for (let i = 0; i < str.length; i++) {
		let c = str.charCodeAt(i);
		if (
			!(c >= 48 && c <= 57) &&
			!(c >= 65 && c <= 70) &&
			!(c >= 97 && c <= 102)
		)
			return false;
	}
	return true;
};

const initColors = () => {
	if (initialized && colors.length > 0) return;
	try {
		let loader = Vars.ui.getClass().getClassLoader();
		let palClass = java.lang.Class.forName(
			'mindustry.graphics.Pal',
			true,
			loader
		);
		let colorClass = java.lang.Class.forName(
			'arc.graphics.Color',
			true,
			loader
		);
		let fields = palClass.getDeclaredFields();

		colors = [];
		for (let i = 0; i < fields.length; i++) {
			let f = fields[i];
			if (f.getType().equals(colorClass)) {
				f.setAccessible(true);
				let obj = f.get(null);
				let name = String(f.getName());
				let def = String(obj.toString());

				let saved = mCore.settings.getString(PREFIX + name, null);
				if (saved) {
					try {
						obj.set(mColor.valueOf(saved));
					} catch (e) {}
				}

				colors.push({ name: name, obj: obj, def: def });
			}
		}
		colors.sort((a, b) => a.name.localeCompare(b.name));
		initialized = true;
	} catch (e) {}
};

if (Vars.ui) initColors();
Events.on(ClientLoadEvent, initColors);

function openColorsDialog() {
	if (!initialized || colors.length === 0) {
		initColors();
	}

	if (colors.length === 0) return;

	let dialog = new mBaseDialog('Palette & Custom Colors');
	dialog.addCloseButton();

	let root = new mTable();
	root.top().left().margin(10);

	function createCard(title, titleColor) {
		let card = root.table(mStyles.black6).growX().padBottom(8).get();
		card.margin(8);
		card.top().left();
		card.add('[#' + (titleColor || 'ffd37f') + ']' + title + '[]').style(mStyles.outlineLabel).fontScale(0.90).left().padBottom(4).row();
		card.image().color(mColor.valueOf('3a3a46')).height(1.5).growX().padBottom(6).row();
		return card;
	}

	let c1 = createCard('Color Swatches (Hex RGBA / RRGGBBAA)', 'f1fa8c');

	colors.forEach((c) => {
		let row = c1.table().growX().pad(2).get();

		let img = new mImage(mTex.whiteui);
		img.setColor(c.obj);

		let previewBox = row.table(mStyles.black5).size(32, 32).padRight(8).get();
		previewBox.add(img).size(26);

		let nameLabel = row.add('[lightgray]' + c.name + '[]').growX().minWidth(140).padRight(8).left().get();

		let tf = new mTextField(String(c.obj.toString()));
		tf.setMaxLength(8);
		tf.changed(() => {
			let text = String(tf.getText());
			if (isHex(text)) {
				try {
					c.obj.set(mColor.valueOf(text));
					img.setColor(c.obj);
					mCore.settings.put(PREFIX + c.name, text);
				} catch (e) {}
			}
		});

		row.add(tf).width(110).height(34).padRight(8);

		let btn = new mImageButton(mIcon.cancel, mStyles.clearNonei);
		btn.clicked(() => {
			c.obj.set(mColor.valueOf(c.def));
			img.setColor(c.obj);
			tf.setText(c.def);
			mCore.settings.remove(PREFIX + c.name);
		});
		row.add(btn).size(32);

		c1.row();
	});

	root.row();

	// Quick Actions
	let actCard = root.table(mStyles.black6).growX().padBottom(2).get();
	actCard.margin(8);
	let actRow = actCard.table().center().get();

	actRow.button('[accent]Reset All Colors[]', mStyles.grayt, () => {
		colors.forEach((c) => {
			c.obj.set(mColor.valueOf(c.def));
			mCore.settings.remove(PREFIX + c.name);
		});
		dialog.hide();
		openColorsDialog();
	}).size(180, 36);

	root.row();

	let scroll = new mScrollPane(root);
	scroll.setScrollingDisabled(true, false);
	scroll.setOverscroll(false, true);

	let dw = Math.min(mCore.scene.getWidth() * 0.95, 660);
	let dh = Math.min(mCore.scene.getHeight() * 0.85, 520);
	dialog.cont.add(scroll).width(dw).height(dh);
	dialog.show();
}

interceptor.add('colors', openColorsDialog);

// Expose this module's config dialog to the mod settings screen (gear button).
require('qol-control/core/settings-ui').register(
	'core/colors',
	'Colors',
	openColorsDialog,
	{ menuSafe: true }
);
