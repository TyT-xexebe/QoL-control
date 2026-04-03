const notify = require("qol-control/core/logger").notify;
const interceptor = require("qol-control/core/interceptor");

let autofillEnabled = false;
const DELAY_MS = 250;
const MIN_CORE_ITEMS = 100;
const DEFAULT_PRIORITY = 10;

const TURRET_PRIORITY = {
    "fuse": 100, "cyclone": 90, "foreshadow": 80, "swarmer": 70,
    "ripple": 60, "scatter": 50, "salvo": 40, "hail": 30
};

const GLOBAL_AMMO_PRIORITY = [
    "surge-alloy", "plastanium", "thorium", "blast-compound",
    "pyratite", "metaglass", "lead"
];

let lastActionTime = 0;
let cacheInitialized = false;

const targets = [];
const validTargetIds = []; 
const bestAmmoById = [];
const priorityById = [];
const ignoreMinCoreById = [];

let domeBlock, siliconItem, phaseItem;

const initCache = () => {
    if (cacheInitialized) return;
    let ItemTurret = Packages.mindustry.world.blocks.defense.turrets.ItemTurret;
    
    domeBlock = Vars.content.block("overdrive-dome");
    siliconItem = Vars.content.item("silicon");
    phaseItem = Vars.content.item("phase-fabric");
    
    Vars.content.blocks().each(cons(b => {
        priorityById[b.id] = DEFAULT_PRIORITY;
        ignoreMinCoreById[b.id] = false;
        
        if (b instanceof ItemTurret) {
            let ammoTypes = b.ammoTypes;
            if (ammoTypes) {
                let list = [];
                let allItems = Vars.content.items();
                for(let i = 0; i < allItems.size; i++) {
                    let item = allItems.get(i);
                    if(ammoTypes.containsKey(item)) {
                        let bullet = ammoTypes.get(item);
                        let pIndex = GLOBAL_AMMO_PRIORITY.indexOf(item.name);
                        let score = pIndex !== -1 ? 1000 - pIndex : (bullet.damage + bullet.splashDamage) * (bullet.ammoMultiplier || 1) * (bullet.reloadMultiplier || 1);
                        list.push({ item: item, score: score });
                    }
                }
                list.sort((a, b) => b.score - a.score);
                bestAmmoById[b.id] = list.map(e => e.item);
                validTargetIds[b.id] = true;
                if (TURRET_PRIORITY[b.name] !== undefined) priorityById[b.id] = TURRET_PRIORITY[b.name];
            }
        }
    }));

    if (domeBlock && siliconItem && phaseItem) {
        bestAmmoById[domeBlock.id] = [siliconItem, phaseItem];
        validTargetIds[domeBlock.id] = true;
        priorityById[domeBlock.id] = 200;
        ignoreMinCoreById[domeBlock.id] = true;
    }
    
    cacheInitialized = true;
};

const autofillHandler = (args) => {
    autofillEnabled = interceptor.parseToggle(autofillEnabled, args[1]);
    notify("[lightgrey]Autofill " + (autofillEnabled ? "[green]ON" : "[scarlet]OFF"));
};

interceptor.add("autofill", autofillHandler);
interceptor.add("af", autofillHandler);

Events.run(Trigger.update, () => {
    if (!autofillEnabled || !Vars.state.isGame()) return;
    
    initCache();
    
    let p = Vars.player;
    let u = p.unit();
    if (!u || u.dead || u.type.itemCapacity <= 0) return;
    
    let now = Time.millis();
    if (now - lastActionTime < DELAY_MS) return;

    let core = u.closestCore();
    let buildRange = 220; 
    let nearCore = core != null && u.within(core, buildRange);
    
    let stack = u.stack;
    let hasItem = stack.amount > 0 && stack.item != null;

    if (!nearCore && !hasItem) return;

    let px = u.x, py = u.y;
    let BlockFlag = Packages.mindustry.world.meta.BlockFlag;
    let turrets = Vars.indexer.getFlagged(p.team(), BlockFlag.turret);
    
    targets.length = 0;
    
    for (let i = 0; i < turrets.size; i++) {
        let b = turrets.get(i);
        if (validTargetIds[b.block.id] && b.within(px, py, buildRange)) {
            if (b.totalAmmo <= b.block.maxAmmo / 2) targets.push(b);
        }
    }

    if (domeBlock) {
        Groups.build.each(b => {
            if (b.block === domeBlock && b.team === p.team() && b.within(px, py, buildRange)) {
                if (b.items && (b.items.get(siliconItem) === 0 || b.items.get(phaseItem) === 0)) {
                    targets.push(b);
                }
            }
        });
    }

    if (targets.length === 0) return;

    targets.sort((a, b) => {
        let pA = priorityById[a.block.id];
        let pB = priorityById[b.block.id];
        if (pA !== pB) return pB - pA;
        return u.dst2(a) - u.dst2(b);
    });

    if (hasItem) {
        let itemTransferred = false;
        for (let i = 0; i < targets.length; i++) {
            let t = targets[i];
            if (t.acceptItem(t, stack.item)) {
                if (t.block === domeBlock && t.items && t.items.get(stack.item) > 0) continue;
                
                Call.transferInventory(p, t);
                lastActionTime = now;
                itemTransferred = true;
                break;
            }
        }
        
        if (!itemTransferred && nearCore) {
            Call.transferInventory(p, core);
            lastActionTime = now;
        }
        return;
    } 
    
    if (nearCore && !hasItem) {
        for (let i = 0; i < targets.length; i++) {
            let t = targets[i];
            let bestItems = bestAmmoById[t.block.id];
            if (!bestItems) continue;
            
            let chosenItem = null;
            for (let j = 0; j < bestItems.length; j++) {
                let item = bestItems[j];
                
                if (t.block === domeBlock && t.items && t.items.get(item) > 0) continue;
                
                let minReq = ignoreMinCoreById[t.block.id] ? 0 : MIN_CORE_ITEMS;
                if (core.items.get(item) > minReq) {
                    chosenItem = item;
                    break;
                }
            }
            
            if (chosenItem != null) {
                Call.requestItem(p, core, chosenItem, u.type.itemCapacity);
                lastActionTime = now;
                return;
            }
        }
    }
});
