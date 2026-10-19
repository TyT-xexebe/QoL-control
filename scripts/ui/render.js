// ui/render - turn rendering layers off to save performance.
//
// Commands:
//   !render <bullet|unit|block|layer> [1/0]
//
// How each layer is hidden
//   bullets - drawSize pushed negative, nothing to draw
//   blocks  - tile views emptied for the duration of the frame
//   layer   - block drawers replaced with a bare one
//   units   - the draw list is emptied for the duration of the frame
//
// Why units are not hidden with clipSize any more
//   Unit.clipSize() is not a plain field read. For a unit that is building it
//   returns max(type.clipSize, region.width) + buildRange + 32, and for a mining
//   unit type.clipSize + mineRange. A negative type.clipSize therefore loses to
//   the positive region width, which is why builder and miner units kept showing
//   up while every other unit disappeared. Hiding the draw list instead works for
//   all of them, is exact, and does not touch values the game logic reads.

const notify = require('qol-control/core/logger').notify;
const interceptor = require('qol-control/core/interceptor');
const ArcReflect = Packages.arc.util.Reflect;

let renderBullets = Core.settings.getBool('qol-render-bullets', true);
let renderUnits = Core.settings.getBool('qol-render-units', true);
let renderBlocks = Core.settings.getBool('qol-render-blocks', true);
let renderLayers = Core.settings.getBool('qol-render-layers', true);

const origBulletSizes = [];
const origBlockDrawers = [];

function applyRenderSettings() {
	let idx = 0;

	try {
		Vars.content.bullets().each(
			cons((b) => {
				if (origBulletSizes[idx] === undefined) origBulletSizes[idx] = b.drawSize;
				b.drawSize = renderBullets ? origBulletSizes[idx] : -10000;
				idx++;
			})
		);
	} catch (e) {}

	let DrawDefault = Packages.mindustry.world.draw.DrawDefault;
	let simpleDrawer = new DrawDefault();

	try {
		Vars.content.blocks().each(
			cons((b) => {
				let id = b.id;
				try {
					if (b.drawer !== undefined && b.drawer !== null) {
						if (origBlockDrawers[id] === undefined) origBlockDrawers[id] = b.drawer;
						b.drawer = renderLayers ? origBlockDrawers[id] : simpleDrawer;
					}
				} catch (e) {}
			})
		);
	} catch (e) {}
}

Events.on(ClientLoadEvent, () => {
	applyRenderSettings();
});

// Saved values are restored in the same frame, so a thrown error or a skipped
// restore can never leave the world permanently invisible.
let savedTileSize = -1;
let savedLinkSize = -1;
let savedLightSize = -1;
let savedDestroyedSize = -1;
let savedUnitDrawSize = -1;

function hideBlocks() {
	try {
		let bRenderer = Vars.renderer.blocks;

		let tview = ArcReflect.get(bRenderer, 'tileview');
		if (tview) {
			savedTileSize = tview.size;
			tview.size = 0;
		}

		let pLinks = ArcReflect.get(bRenderer, 'procLinks');
		if (pLinks) {
			savedLinkSize = pLinks.size;
			pLinks.size = 0;
		}

		let pLights = ArcReflect.get(bRenderer, 'procLights');
		if (pLights) {
			savedLightSize = pLights.size;
			pLights.size = 0;
		}

		let destr = ArcReflect.get(bRenderer, 'destroyed');
		if (destr) {
			savedDestroyedSize = destr.size;
			destr.size = 0;
		}
	} catch (e) {}
}

function restoreBlocks() {
	try {
		let bRenderer = Vars.renderer.blocks;
		if (savedTileSize !== -1) {
			ArcReflect.get(bRenderer, 'tileview').size = savedTileSize;
			savedTileSize = -1;
		}
		if (savedLinkSize !== -1) {
			ArcReflect.get(bRenderer, 'procLinks').size = savedLinkSize;
			savedLinkSize = -1;
		}
		if (savedLightSize !== -1) {
			ArcReflect.get(bRenderer, 'procLights').size = savedLightSize;
			savedLightSize = -1;
		}
		if (savedDestroyedSize !== -1) {
			ArcReflect.get(bRenderer, 'destroyed').size = savedDestroyedSize;
			savedDestroyedSize = -1;
		}
	} catch (e) {}
}

// Groups.draw is the entity group the renderer walks to draw every unit; emptying
// its backing sequence for the duration of the frame hides all of them at once,
// including builders and miners that clipSize cannot suppress.
function hideUnits() {
	try {
		let group = Groups.draw;
		let array = ArcReflect.get(group, 'array');
		if (!array) return;
		savedUnitDrawSize = array.size;
		array.size = 0;
	} catch (e) {
		savedUnitDrawSize = -1;
	}
}

function restoreUnits() {
	if (savedUnitDrawSize === -1) return;
	try {
		let array = ArcReflect.get(Groups.draw, 'array');
		if (array) array.size = savedUnitDrawSize;
	} catch (e) {}
	savedUnitDrawSize = -1;
}

Events.run(Trigger.draw, () => {
	if (!renderBlocks) hideBlocks();
	if (!renderUnits) hideUnits();
});

Events.run(Trigger.postDraw, () => {
	restoreBlocks();
	restoreUnits();
});

// Leaving a world while a layer is hidden must not carry the hidden state over.
Events.on(WorldLoadEvent, () => {
	savedTileSize = -1;
	savedLinkSize = -1;
	savedLightSize = -1;
	savedDestroyedSize = -1;
	savedUnitDrawSize = -1;
});

interceptor.add('render', (args) => {
	if (args.length < 2) {
		notify('[lightgray]!render <bullet|unit|block|layer> <1/0?>');
		return;
	}

	let subcmd = args[1].toLowerCase();

	if (args[2] && !interceptor.isBooleanArg(args[2])) {
		notify('[lightgray]Usage: !render ' + subcmd + ' <1/0?>');
		return;
	}

	if (subcmd === 'bullet') {
		renderBullets = interceptor.parseToggle(renderBullets, args[2]);
		Core.settings.put('qol-render-bullets', renderBullets);
		applyRenderSettings();
		notify('[lightgray]Bullets ' + (renderBullets ? '[green]ON' : '[scarlet]OFF'));
	} else if (subcmd === 'unit') {
		renderUnits = interceptor.parseToggle(renderUnits, args[2]);
		Core.settings.put('qol-render-units', renderUnits);
		notify('[lightgray]Units ' + (renderUnits ? '[green]ON' : '[scarlet]OFF'));
	} else if (subcmd === 'block') {
		renderBlocks = interceptor.parseToggle(renderBlocks, args[2]);
		Core.settings.put('qol-render-blocks', renderBlocks);
		notify('[lightgray]Blocks ' + (renderBlocks ? '[green]ON' : '[scarlet]OFF'));
	} else if (subcmd === 'layer') {
		renderLayers = interceptor.parseToggle(renderLayers, args[2]);
		Core.settings.put('qol-render-layers', renderLayers);
		applyRenderSettings();
		notify('[lightgray]Block Layers ' + (renderLayers ? '[green]ON' : '[scarlet]OFF'));
	} else {
		notify('[lightgray]!render <bullet|unit|block|layer> <1/0?>');
	}
});
