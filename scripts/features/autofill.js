const notify = require("qol-control/core/logger").notify;
const interceptor = require("qol-control/core/interceptor");

let autofillEnabled = false;
const DELAY_MS = 250;
const MIN_CORE_ITEMS = 100;
const DEFAULT_PRIORITY = 10;

const TURRET_PRIORITY = {
    "foreshadow": 100,
    "fuse": 90,
    "spectre": 80,
    "swarmer": 70,
    "cyclone": 60,
    "salvo": 50,
    "scatter": 40,
    "hail": 30
};

const GLOBAL_AMMO_PRIORITY = [
    "surge-alloy",
    "plastanium",
    "thorium",
    "blast-compound",
    "pyratite",
    "metaglass",
    "lead"
];

let lastActionTime = 0;
let cacheInitialized = false;

const targets = [];
const validTurretIds = []; 
const bestAmmoById = [];
const priorityById = [];

const initCache = () => {
    if (cacheInitialized) return;
    let ItemTurret = Packages.mindustry.world.blocks.defense.turrets.ItemTurret;
    
    Vars.content.blocks().each(cons(b => {
        priorityById[b.id] = DEFAULT_PRIORITY;
        
        if (b instanceof ItemTurret) {
            let ammoTypes = b.ammoTypes;
            if (ammoTypes) {
                let list = [];
                
                // ИСПРАВЛЕНИЕ: Безопасный перебор предметов. 
                // Обходит баг с IllegalAccessException в итераторах ObjectMap на новых версиях Java.
                let allItems = Vars.content.items();
                for(let i = 0; i < allItems.size; i++) {
                    let item = allItems.get(i);
                    
                    if(ammoTypes.containsKey(item)) {
                        let bullet = ammoTypes.get(item);
                        
                        let pIndex = GLOBAL_AMMO_PRIORITY.indexOf(item.name);
                        let score = 0;
                        if (pIndex !== -1) {
                            score = 1000 - pIndex; 
                        } else {
                            let rMult = bullet.reloadMultiplier || 1;
                            let aMult = bullet.ammoMultiplier || 1;
                            score = (bullet.damage + bullet.splashDamage) * aMult * rMult;
                        }
                        list.push({ item: item, score: score });
                    }
                }
                
                list.sort((a, b) => b.score - a.score);
                
                bestAmmoById[b.id] = list.map(e => e.item);
                validTurretIds[b.id] = true;
                
                if (TURRET_PRIORITY[b.name] !== undefined) {
                    priorityById[b.id] = TURRET_PRIORITY[b.name];
                }
            }
        }
    }));
    cacheInitialized = true;
};

const autofillHandler = (args) => {
    autofillEnabled = !autofillEnabled;
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
        let blockId = b.block.id;
        
        if (validTurretIds[blockId]) {
            if (b.within(px, py, buildRange)) {
                if (b.totalAmmo <= b.block.maxAmmo / 2) {
                    targets.push(b);
                }
            }
        }
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
                if (core.items.get(item) >= MIN_CORE_ITEMS) {
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
