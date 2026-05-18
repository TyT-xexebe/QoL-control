const notify = require('qol-control/core/logger').notify;
const interceptor = require('qol-control/core/interceptor');
const ArcReflect = Packages.arc.util.Reflect;

let renderBullets = true;
let renderUnits = true;
let renderBlocks = true;
let renderLayers = true;

const origBulletSizes = [];
const origUnitSizes = [];
const origBlockDrawers = [];

function restoreOriginals() {
	let idx = 0;

	Vars.content.bullets().each(
		cons((b) => {
			if (origBulletSizes[idx] !== undefined && b.drawSize === -10000) {
				b.drawSize = origBulletSizes[idx];
			}
			idx++;
		})
	);

	Vars.content.units().each(
		cons((u) => {
			let id = u.id;
			if (origUnitSizes[id] !== undefined && u.clipSize === -10000) {
				u.clipSize = origUnitSizes[id];
			}
		})
	);

	Vars.content.blocks().each(
		cons((b) => {
			let id = b.id;
			try {
				if (origBlockDrawers[id] !== undefined && b.drawer) {
					b.drawer = origBlockDrawers[id];
				}
			} catch (e) {}
		})
	);
}

Events.on(ClientLoadEvent, () => {
	restoreOriginals();
});

let savedTileSize = -1;
let savedLinkSize = -1;
let savedLightSize = -1;
let savedDestroyedSize = -1;

Events.run(Trigger.drawOver, () => {
	if (!renderBlocks) {
		try {
			let bRenderer = Vars.renderer.blocks;
			let tview = ArcReflect.get(bRenderer, "tileview");
			if(tview) { savedTileSize = tview.size; tview.size = 0; }
			
			let pLinks = ArcReflect.get(bRenderer, "procLinks");
			if(pLinks) { savedLinkSize = pLinks.size; pLinks.size = 0; }
			
			let pLights = ArcReflect.get(bRenderer, "procLights");
			if(pLights) { savedLightSize = pLights.size; pLights.size = 0; }
			
			let destr = ArcReflect.get(bRenderer, "destroyed");
			if(destr) { savedDestroyedSize = destr.size; destr.size = 0; }
		} catch (e) {}
	}
});

Events.run(Trigger.postDraw, () => {
	if (!renderBlocks) {
		try {
			let bRenderer = Vars.renderer.blocks;
			if(savedTileSize !== -1) { ArcReflect.get(bRenderer, "tileview").size = savedTileSize; savedTileSize = -1; }
			if(savedLinkSize !== -1) { ArcReflect.get(bRenderer, "procLinks").size = savedLinkSize; savedLinkSize = -1; }
			if(savedLightSize !== -1) { ArcReflect.get(bRenderer, "procLights").size = savedLightSize; savedLightSize = -1; }
			if(savedDestroyedSize !== -1) { ArcReflect.get(bRenderer, "destroyed").size = savedDestroyedSize; savedDestroyedSize = -1; }
		} catch (e) {}
	}
});

interceptor.add('render', (args) => {
	if (args.length < 2) {
		notify('[lightgray]!render <bullet|unit|block|layer> <1/0?>');
		return;
	}

	let subcmd = args[1].toLowerCase();

	if (subcmd === 'bullet') {
		renderBullets = interceptor.parseToggle(renderBullets, args[2]);

		let idx = 0;
		Vars.content.bullets().each(
			cons((b) => {
				if (origBulletSizes[idx] === undefined) {
					origBulletSizes[idx] = b.drawSize;
				}
				b.drawSize = renderBullets ? origBulletSizes[idx] : -10000;
				idx++;
			})
		);
		notify(
			'[lightgray]Bullets ' +
				(renderBullets ? '[green]ON' : '[scarlet]OFF')
		);
	} else if (subcmd === 'unit') {
		renderUnits = interceptor.parseToggle(renderUnits, args[2]);
		Vars.content.units().each(
			cons((u) => {
				let id = u.id;
				if (origUnitSizes[id] === undefined) {
					origUnitSizes[id] = u.clipSize;
				}
				u.clipSize = renderUnits ? origUnitSizes[id] : -10000;
			})
		);
		notify(
			'[lightgray]Units ' + (renderUnits ? '[green]ON' : '[scarlet]OFF')
		);
	} else if (subcmd === 'block') {
		renderBlocks = interceptor.parseToggle(renderBlocks, args[2]);
		
		notify(
			'[lightgray]Blocks ' + (renderBlocks ? '[green]ON' : '[scarlet]OFF')
		);
	} else if (subcmd === 'layer') {
		renderLayers = interceptor.parseToggle(renderLayers, args[2]);

		let DrawDefault = Packages.mindustry.world.draw.DrawDefault;
		let simpleDrawer = new DrawDefault();

		Vars.content.blocks().each(
			cons((b) => {
				let id = b.id;
				try {
					if (b.drawer !== undefined && b.drawer !== null) {
						if (origBlockDrawers[id] === undefined) {
							origBlockDrawers[id] = b.drawer;
						}

						b.drawer = renderLayers
							? origBlockDrawers[id]
							: simpleDrawer;
					}
				} catch (e) {}
			})
		);
		notify(
			'[lightgray]Block Layers ' +
				(renderLayers ? '[green]ON' : '[scarlet]OFF')
		);
	} else {
		notify('[lightgray]!render <bullet|unit|block|layer> <1/0?>');
	}
});
