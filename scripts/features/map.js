const interceptor = require("qol-control/core/interceptor");

let worldProcessorStats = {};

Events.on(WorldLoadEvent, () => {
    worldProcessorStats = {};
    Groups.build.each(cons(b => {
        if (b.block.name === "world-processor") {
            let tId = b.team.id;
            if (!worldProcessorStats[tId]) {
                let hex = b.team.color.toString().substring(0, 6);
                worldProcessorStats[tId] = { name: b.team.name, wp: 0, color: hex };
            }
            worldProcessorStats[tId].wp++;
        }
    }));
});

function addHeader(table, text) {
    table.add("[accent]==" + text + "==").padTop(15).padBottom(5).row();
}

function addRow(table, key, value, wrapWidth) {
    table.add("[lightgray]" + key + ": []").left().top();
    let cell = table.add(String(value)).left().padLeft(5);
    if (wrapWidth) {
        cell.wrap().width(wrapWidth);
    }
    cell.row();
}

function showMapDialog() {
    if (!Vars.state.isPlaying()) return;

    let dialog = new BaseDialog("Map Info");
    dialog.addCloseButton();

    let t = new Table();
    t.margin(14);

    let map = Vars.state.map;
    let rules = Vars.state.rules;
    
    let screenWidth = Core.scene.getWidth();
    let dynamicWrapWidth = Math.min(screenWidth * 0.8, 800);

    addHeader(t, "General");
    addRow(t, "Name", map.name());
    addRow(t, "Author", map.author());
    addRow(t, "Size", Vars.world.width() + " x " + Vars.world.height());
    addRow(t, "Mode", rules.mode().name());

    let desc = map.description();
    if (desc) {
        t.add("[lightgray]Description:[]").left().top().padTop(5).row();
        t.add(desc).left().wrap().width(dynamicWrapWidth).padBottom(5).row();
    }

    addHeader(t, "Teams Info");
    let hasWp = false;
    for (let id in worldProcessorStats) {
        if (Object.prototype.hasOwnProperty.call(worldProcessorStats, id)) {
            let stat = worldProcessorStats[id];
            if (stat.wp > 0) {
                hasWp = true;
                let teamName = "[#" + stat.color + "]" + stat.name + "[]";
                addRow(t, teamName, "WorldProcs: " + stat.wp);
            }
        }
    }
    if (!hasWp) {
        addRow(t, "World Processors", "None");
    }

    addHeader(t, "Global Multipliers");
    addRow(t, "Build Speed", "x" + rules.buildSpeedMultiplier);
    addRow(t, "Block Health", "x" + rules.blockHealthMultiplier);
    addRow(t, "Block Damage", "x" + rules.blockDamageMultiplier);
    addRow(t, "Unit Build Speed", "x" + rules.unitBuildSpeedMultiplier);
    addRow(t, "Unit Health", "x" + rules.unitHealthMultiplier);
    addRow(t, "Unit Damage", "x" + rules.unitDamageMultiplier);
    addRow(t, "Solar Power", "x" + rules.solarMultiplier);

    let customTeamRules = [];
    let activeTeams = Vars.state.teams.getActive();
    
    activeTeams.each(cons(teamData => {
        let team = teamData.team;
        let tr = rules.teams.get(team);
        
        if (tr) {
            let diffs = [];
            
            if(tr.buildSpeedMultiplier !== 1) diffs.push("BuildSpd: x" + tr.buildSpeedMultiplier);
            if(tr.blockHealthMultiplier !== 1) diffs.push("BlkHP: x" + tr.blockHealthMultiplier);
            if(tr.blockDamageMultiplier !== 1) diffs.push("BlkDmg: x" + tr.blockDamageMultiplier);
            if(tr.unitBuildSpeedMultiplier !== 1) diffs.push("UnitBuildSpd: x" + tr.unitBuildSpeedMultiplier);
            if(tr.unitHealthMultiplier !== 1) diffs.push("UnitHP: x" + tr.unitHealthMultiplier);
            if(tr.unitDamageMultiplier !== 1) diffs.push("UnitDmg: x" + tr.unitDamageMultiplier);
            if(tr.infiniteResources) diffs.push("InfRes: true");
            if(tr.infiniteAmmo) diffs.push("InfAmmo: true");
            if(tr.cheat) diffs.push("Cheat: true");
            
            if(diffs.length > 0){
                let hex = team.color.toString().substring(0, 6);
                customTeamRules.push({
                    name: "[#" + hex + "]" + team.name + "[]",
                    text: diffs.join(", ")
                });
            }
        }
    }));

    if(customTeamRules.length > 0){
        addHeader(t, "Custom Team Rules");
        for(let i = 0; i < customTeamRules.length; i++){
            addRow(t, customTeamRules[i].name, customTeamRules[i].text, dynamicWrapWidth);
        }
    }

    addHeader(t, "Waves & Spawns");
    addRow(t, "Waves Enabled", rules.waves);
    addRow(t, "Wave Timer", rules.waveTimer);
    if (rules.waves) {
        addRow(t, "Wave Spacing", (rules.waveSpacing / 60) + "s");
        addRow(t, "Drop Zone Radius", (rules.dropZoneRadius / 8) + " tiles");
    }

    addHeader(t, "Restrictions & Rules");
    addRow(t, "Attack Mode", rules.attackMode);
    addRow(t, "Core Protection", rules.polygonCoreProtection);
    addRow(t, "Enemy Core Build Radius", (rules.enemyCoreBuildRadius / 8) + " tiles");
    addRow(t, "Fire", rules.fire);
    addRow(t, "Reactor Explosions", rules.reactorExplosions);
    addRow(t, "Unit Ammo", rules.unitAmmo);
    addRow(t, "Lighting", rules.lighting);
    addRow(t, "Fog of War", rules.fog);

    addHeader(t, "Banned Content");
    let bannedB = [];
    rules.bannedBlocks.each(cons(b => bannedB.push(b.emoji() + " " + b.localizedName)));
    addRow(t, "Banned Blocks", bannedB.length > 0 ? bannedB.join(", ") : "None", dynamicWrapWidth);

    let bannedU = [];
    rules.bannedUnits.each(cons(u => bannedU.push(u.emoji() + " " + u.localizedName)));
    addRow(t, "Banned Units", bannedU.length > 0 ? bannedU.join(", ") : "None", dynamicWrapWidth);

    let scroll = new ScrollPane(t);
    scroll.setScrollingDisabled(false, false);
    
    dialog.cont.add(scroll).width(screenWidth * 0.9).height(Core.scene.getHeight() * 0.9);
    dialog.show();
}

interceptor.add("map", (args) => {
    Core.app.post(() => {
        showMapDialog();
    });
});
