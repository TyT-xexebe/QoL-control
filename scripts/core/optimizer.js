const _optInterceptor = require('qol-control/core/interceptor');
const _optNotify = require('qol-control/core/logger').notify;

const OPT = {
	gfxFlags:       { key: 'qol-opt-gfxflags',    def: true,  label: 'Bloom/shadows/fog/lighting off' },
	blockFx:        { key: 'qol-opt-blockfx',      def: true,  label: 'Block effects → none' },
	bulletFx:       { key: 'qol-opt-bulletfx',     def: true,  label: 'Bullet effects/trails → none' },
	unitFx:         { key: 'qol-opt-unitfx',       def: true,  label: 'Unit death/weapon effects → none' },
	liquidFx:       { key: 'qol-opt-liquidfx',     def: true,  label: 'Liquid/status effects → none' },
	blockLight:     { key: 'qol-opt-blocklight',   def: true,  label: 'Block & bullet lights off' },
	blockSound:     { key: 'qol-opt-blocksound',   def: true,  label: 'Block ambient/loop sounds off' },
	vegetation:     { key: 'qol-opt-vegetation',   def: true,  label: 'Vegetation invisible (saves draw calls)' },
	shadows:        { key: 'qol-opt-shadows',      def: true,  label: 'Block shadows off' },
	fxLifetime:     { key: 'qol-opt-fxlifetime',   def: true,  label: 'Effect lifetime x0.3' },
	floorAnim:      { key: 'qol-opt-flooranim',    def: true,  label: 'Floor animations frozen' },
};

function optGet(id) {
	return Core.settings.getBool(OPT[id].key, OPT[id].def);
}
function optSet(id, val) {
	Core.settings.put(OPT[id].key, new java.lang.Boolean(val));
	Core.settings.forceSave();
}

Events.run(Trigger.preDraw, () => {
	if (!Vars.state.isGame() || !Vars.state.rules) return;
	if (optGet('gfxFlags')) {
		Vars.state.rules.fog = false;
		Vars.state.rules.staticFog = false;
		Vars.state.rules.lighting = false;
		Vars.enableDarkness = false;
	}
});

Events.on(ClientLoadEvent, cons(() => {
	const s     = Core.settings;
	const none  = Fx.none;
	const noSnd = Sounds.none;

	if (optGet('gfxFlags')) {
		s.put('bloom',         false);
		s.put('shadows',       false);
		s.put('weather',       false);
		s.put('animatedwater', false);
		s.put('ambientlight',  false);
		s.put('lasers',        false);
		s.put('smoothlighting',false);
		s.put('fluidparticles',false);
		const zero = new java.lang.Integer(0);
		s.put('screenshake', zero);
		s.put('corpses',     zero);
		s.put('debris',      zero);
		s.put('particles',   zero);
	}

	const safe = (obj, prop, val) => { try { obj[prop] = val; } catch(e) {} };

	let clearReg;
	try {
		clearReg = Core.atlas.find('clear');
		if (!clearReg) {
			let TR = Packages.arc.graphics.g2d.TextureRegion;
			clearReg = new TR(Core.atlas.white());
		}
	} catch(e) { clearReg = null; }

	const vegClasses = new java.util.HashSet();
	try {
		['TallBlock','TreeBlock','Seaweed','Bush'].forEach(n => vegClasses.add(n));
	} catch(e) {}

	Vars.content.blocks().each(cons(b => {
		if (optGet('blockLight')) {
			b.emitLight   = false;
			b.lightRadius = 0;
		}
		if (optGet('blockSound')) {
			safe(b, 'ambientSound', noSnd);
			safe(b, 'loopSound',    noSnd);
		}
		if (optGet('blockFx')) {
			['destroyEffect','breakEffect','placeEffect','updateEffect',
			 'craftEffect','consumeEffect','smokeEffect','shootEffect',
			 'ammoUseEffect','chargeEffect','drillEffect','generateEffect'
			].forEach(f => safe(b, f, none));
		}

		let isVeg = false;
		try {
			isVeg = vegClasses.contains(b.getClass().getSimpleName());
			if (!isVeg) isVeg =
				b instanceof Packages.mindustry.world.blocks.environment.TallBlock ||
				b instanceof Packages.mindustry.world.blocks.environment.TreeBlock  ||
				b instanceof Packages.mindustry.world.blocks.environment.Seaweed;
		} catch(e) {}

		if (isVeg && optGet('vegetation') && clearReg) {
			b.region = clearReg;
			try {
				if (b.variantRegions) for (let j = 0; j < b.variantRegions.length; j++) b.variantRegions[j] = clearReg;
				if (b.regions)        for (let j = 0; j < b.regions.length;        j++) b.regions[j]        = clearReg;
			} catch(e) {}
		} else if (!isVeg && optGet('shadows')) {
			b.hasShadow = false;
			safe(b, 'shadowAlpha',         0);
			safe(b, 'shadowOffset',        0);
			safe(b, 'customShadowRegion', clearReg);
		}

		if (optGet('floorAnim')) {
			safe(b, 'animationFrames', 1);
			safe(b, 'animationSpeed',  0);
		}
	}));

	Vars.content.bullets().each(cons(b => {
		if (optGet('blockLight')) {
			b.lightRadius  = 0;
			b.lightOpacity = 0;
			safe(b, 'emitLight', false);
		}
		if (optGet('bulletFx')) {
			b.trailLength = 0;
			safe(b, 'trailEffect',   none);
			['hitEffect','despawnEffect','shootEffect','smokeEffect'
			].forEach(f => safe(b, f, none));
		}
	}));

	Vars.content.units().each(cons(u => {
		if (optGet('blockLight')) {
			u.lightRadius  = 0;
			u.lightOpacity = 0;
		}
		if (optGet('unitFx')) {
			safe(u, 'createWreck',          false);
			safe(u, 'createScorch',         false);
			safe(u, 'fallEffect',           none);
			safe(u, 'deathEffect',          none);
			safe(u, 'deathExplosionEffect', none);
			if (u.weapons) for (let i = 0; i < u.weapons.size; i++) {
				let w = u.weapons.get(i);
				safe(w, 'shootEffect', none);
				safe(w, 'smokeEffect', none);
				safe(w, 'ejectEffect', none);
			}
		}
	}));

	if (optGet('liquidFx')) {
		Vars.content.liquids().each(cons(l => {
			l.lightColor = Packages.arc.graphics.Color.clear;
			safe(l, 'effect',      none);
			safe(l, 'boilEffect',  none);
			safe(l, 'vaporEffect', none);
		}));
		Vars.content.statusEffects().each(cons(s2 => {
			safe(s2, 'effect',          none);
			safe(s2, 'parentizeEffect', none);
		}));
	}

	if (optGet('fxLifetime')) {
		try {
			let fields = java.lang.Class.forName('mindustry.content.Fx').getFields();
			for (let i = 0; i < fields.length; i++) {
				let f = fields[i];
				if (f.getType().getSimpleName() === 'Effect') {
					try { let e = f.get(null); if (e) e.lifetime *= 0.3; } catch(e2) {}
				}
			}
		} catch(e) {}
	}
}));

function _openOptDialog() {
	let d = new BaseDialog('[accent]Optimizer Settings[]');
	d.addCloseButton();

	let items = [
		{ id: 'gfxFlags',   restart: false },
		{ id: 'blockFx',    restart: true  },
		{ id: 'bulletFx',   restart: true  },
		{ id: 'unitFx',     restart: true  },
		{ id: 'liquidFx',   restart: true  },
		{ id: 'blockLight', restart: true  },
		{ id: 'blockSound', restart: true  },
		{ id: 'vegetation', restart: true  },
		{ id: 'shadows',    restart: true  },
		{ id: 'fxLifetime', restart: true  },
		{ id: 'floorAnim',  restart: true  },
	];

	let infoTable = new Table();
	let note = infoTable.add('[gray]* = needs restart to un-apply[]').left().padBottom(8).get();
	note.setWrap(true);
	infoTable.row();

	let listTable = new Table();
	items.forEach(function(item) {
		let cfg = OPT[item.id];
		let lbl = cfg.label + (item.restart ? ' [gray]*[]' : '');
		listTable.check(lbl, optGet(item.id), (checked) => {
			optSet(item.id, checked);
		}).left().growX().pad(4).row();
	});

	let scroll = new ScrollPane(listTable);
	infoTable.add(scroll).width(450).height(400).row();

	d.cont.add(infoTable);
	d.show();
}

_optInterceptor.add('opt', function(args) {
	_openOptDialog();
});

let _wpTarget   = null;
let _wpGuardEnd = 0;
let _wpShowM    = null;

function _getShowConfigM(frag) {
	if (_wpShowM) return _wpShowM;
	try {
		let m = frag.getClass().getMethod('showConfig', Packages.mindustry.gen.Building.class);
		m.setAccessible(true);
		_wpShowM = m;
	} catch(e) {}
	return _wpShowM;
}

function _doShowConfig(c) {
	try {
		let frag = Vars.control.input.config;
		let m = _getShowConfigM(frag);
		if (m) { m.invoke(frag, c); return true; }
		frag.showConfig(c); return true;
	} catch(e) {}
	try { c.onConfigureTapped(); return true; } catch(e) {}
	try {
		Vars.ui.logic.show(c.code ? String(c.code) : '', c.executor, true, cons((_x) => {}));
		return true;
	} catch(e) {}
	return false;
}

Events.run(Trigger.update, () => {
	if (!Vars.state.isGame() || Core.scene.hasMouse()) return;

	if (_wpTarget && Time.millis() < _wpGuardEnd) {
		try {
			let frag = Vars.control.input.config;
			if (!frag.isShown()) {
				let ht = Vars.world.tileWorld(Core.input.mouseWorldX(), Core.input.mouseWorldY());
				if (ht && ht.build === _wpTarget) _doShowConfig(_wpTarget);
			}
		} catch(e) {}
	} else if (Time.millis() >= _wpGuardEnd) {
		_wpTarget = null;
	}

	if (!Core.input.justTouched()) return;
	let t = Vars.world.tileWorld(Core.input.mouseWorldX(), Core.input.mouseWorldY());
	let c = t ? t.build : null;
	if (!c || c.block != Blocks.worldProcessor) return;

	try {
		let frag = Vars.control.input.config;
		if (frag.isShown() && frag.getSelected() === c) return;
	} catch(e) {}

	if (_doShowConfig(c)) {
		_wpTarget   = c;
		_wpGuardEnd = Time.millis() + 400;
	}
});
