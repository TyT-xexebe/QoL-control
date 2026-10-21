# QoL Control

A comprehensive Quality-of-Life (QoL), automation, and utility mod for Mindustry.

---

## Important: How to Read Command Arguments (Placeholders)

Commands in this guide use standard notation. **Do NOT type the brackets literally into chat!**

- **`[1/0]` (or `<1/0>`):** represents a boolean choice. Supply `1` (or `on`, `true`) to turn the feature ON, or `0` (or `off`, `false`) to turn it OFF.
  - *Correct:* `!path 1`, `!autofill on`, `!trange 0`
  - *Incorrect:* `!path <1/0>`, `!autofill [1/0]`
- **`[param?]` with a question mark:** optional parameter. Calling the command without this parameter toggles its current state or opens its settings dialog.
  - *Example:* `!path` opens the settings dialog, whereas `!path 1` directly enables it.
- **`[units/items...]` or `[params...]` with an ellipsis:** indicates that **multiple values can be specified in a single command, separated by spaces**.
  - *Example:* `!mining poly mega copper mono coal 1` enables mining automation for poly, mega, mono, copper, and coal all at once.
  - *Example:* `!select poly mega mono` selects all three unit types in RTS mode simultaneously.

---

## Command Prefixes & Window Management

- **Default prefix:** `!` (e.g. `!goto`, `!path`, `!core`).
- **Changing prefix:** use `!prefix [new_prefix]` (e.g. `!prefix ?`). The prefix input field in the mod settings category dynamically updates in real time.
- **Foo's Client compatibility:** Enable "Turn on if using Foo's client" in mod settings to route commands to the `?` prefix and resolve message ID collisions.
- **Settings persistence:** All toggles, custom keybinds, and window coordinates are saved to `Core.settings` and persist across game restarts.
- **Dragging HUD widgets:** All widgets and panels are dragged across the screen using the **Right Mouse Button** (RMB) on desktop, or a direct finger drag on mobile touchscreens. This ensures left-clicks do not accidentally fire buttons while repositioning.

---

## Commands & Features

### 1. Movement & Navigation

#### `!goto`
Directs your unit to fly to the current cursor position and hold position upon arrival.
- **Command:** `!goto` — opens the keybind assignment dialog.
- **Controls:**
  - Hover your cursor over any destination on the map and tap the bound key (e.g. `G`, `Z`, or mouse button). The unit flies to that spot and anchors its position upon arrival.
  - **Camera support:** Works seamlessly in normal view, Freecam, and Minimap Pan View.
  - **Instant manual override:** Pressing any movement key (`W`, `A`, `S`, `D`, arrow keys) or moving the axis immediately disengages the autopilot and returns manual control.
  - **Visuals:** Renders a thin, dual-layered high-contrast path line with an arrival marker, visible across all map biomes.

#### `!path` | `!autopath` | `!ap`
Intelligent A* pathfinding for conveyors, ducts, conduits, and bridges.
- **Commands:**
  - `!path` (or `!ap`) — opens settings dialog and hold-key assignment.
  - `!path [1/0]` — quick on/off toggle.
- **Controls:**
  - Select a conveyor/conduit/duct and drag **while holding** the bound activation key: the pathfinder navigates around obstacles, inserts bridges over gaps and buildings, and places sorter/junction cross-overs.
  - Releasing the key or dragging without it preserves standard vanilla line-dragging behavior (straight lines and native diagonals).

---

### 2. Match Analysis

#### `!spec`
PvP match tracer. Records a compact event log of the whole match and builds a self-contained HTML report with charts.

- **Commands:**
  - `!spec` — start / stop recording. Auto-saves on world change, kick or reload.
  - `!spec ui` — recordings and triggers dialog.
  - `!spec status` — current recording state.
  - `!spec save [name]` — keep the current recording out of the rotation.
  - `!spec open` — open the last report in the browser.
  - `!spec units <name> [once|every]` — log every spawn of a unit type, or only the first one per team.
  - `!spec blocks <name> [once|every]` — same for block placements.
  - `!spec clear` — drop all triggers.
- **Recorded:**
  - Team list as of match start: team ids, names, core counts, player names (colours kept and converted to CSS in the report).
  - Unit spawns and deaths, block placements, resource and power snapshots every second (delta-encoded, so only changed items are written).
  - Peaks of live units/blocks per team with the exact timestamp the peak was reached.
- **Storage:** `qol/spec/` inside the Mindustry data directory. The 3 newest `auto-*` matches are kept; renamed or saved copies are never rotated out.
- **Report:** `<name>.html` next to the `.spec`. No internet needed; tables sort on click, resources and power are drawn as inline SVG.

---

### 2.1 Building Utilities

#### Water Extractor Fix
Replaces water extractors that would sit on liquid with 1x1 mechanical pumps while a schematic is held.
- **No command.** It works whenever the module is enabled in the mod settings.
- **What it does:** a water extractor (2x2) needs dry ground under it and is skipped when its footprint is flooded. The replacement depends on how much is wet:
  - **all 4 cells dry** — the extractor is left alone;
  - **exactly 1 cell wet** — a `rotary-pump` (also 2x2) goes on the same spot;
  - **2, 3 or 4 cells wet** — a `mechanical-pump` goes on every wet cell.
- **Reversible:** back over dry ground the extractor returns and the pumps disappear.
- **What it leaves alone:** extractors on solid ground, mechanical pumps, and every other block.

#### Build Plan Keeper
Restores the build plan that is lost when the player's unit dies and respawns at the core.
- **No command.** It works whenever the module is enabled in the mod settings.
- **The bug it fixes:** the build plan lives on the unit, so a unit that dies takes its plan with it. The unit that spawns at the core starts with an empty plan, and a queued layout is gone - sometimes only half of it, when the game hands the player a nearby unit of the same type that still carries a plan of its own.
- **What it does:** a snapshot of the plan is kept while the player is alive and written back onto the new unit right after the respawn, replacing whatever plan that unit came with.
- **What it leaves alone:** a plan the player edits by hand is never touched - the restore only fires for a unit that actually replaced the dead one.

---

### 3. Unit & Resource Automation

#### `!mining` | `!m`
Global autonomous distribution of unassigned friendly mining units across needed ores.
- `!mining ui` (or `!m ui`) — open the interactive visual mining control panel.
- `!mining set [seconds]` — start automatic distribution, refreshing every N seconds (`0` for single execution).
- `!mining stop` — stop unit distribution.
- `!mining [units/items...] [1/0?]` — enable or disable groups of units or ores (e.g. `!mining poly mega copper mono coal 1`).
- `!mining free [0-100]` — reserve a percentage of units for manual player control.
- `!mining ignore [unit] [items... | clear] [1/0?]` — configure ignored ores for a specific unit type.
- `!mining status` — display current miner assignments and resource quotas.
- `!mining save` — save active setup as default.

#### `!mine`
Automated player-unit mining for copper and lead with core stock balancing.
- `!mine [1/0?]` — toggle player auto-mining.
- `!mine settings` (or `!mine s`) — configure lower trigger threshold and upper fill limits in the core.
- **Thresholds:** *Min core count to START* is the amount below which a resource counts as missing, *Max core count to STOP* is the amount at which it stops counting as missing (hysteresis in between).
- **Max amount to mine (cap):** once the core holds that much copper/lead, the unit stops digging that resource entirely — and picks it up again on its own once the amount drops back down. `0` = no limit. A shortage below the START threshold is always dug, cap or no cap.
- **Short on resources:** while copper/lead in the core is below the trigger threshold, building is paused and the unit digs the nearest ore in its mining range.
- **Stocked up again:** building resumes immediately, and the unit keeps targeting nearby ore — it digs whenever it has no active build plan (the game never lets a unit mine and build at the same time).

#### `!ai`
Autonomous helper for building assistance, ore mining, and coordinate anchoring.
- `!ai` — display AI module status.
- `!ai lock [1/0?]` (or `!ai l`) — freeze unit position and current mining tile.
- `!ai build [player_name | -1] [1/0?]` — follow and assist a builder with construction plans (`-1` for AUTO mode targeting nearest builder).
- `!ai mining [1/0?]` — automatically mine specified resources to fill the core.
- `!ai mining [items...] [1/0?]` — specify items to mine.

#### `!assist` | `!as`
Nearby unit construction and repair assistance.
- `!assist ui` (or `!as ui`) — open the interactive visual assist control panel.
- `!assist [1/0?]` — toggle assist mode.
- `!assist [units...] [1/0?]` — toggle assistance for specific unit types (e.g. `!assist poly mega 1`).
- `!assist max [unit] [number]` — set maximum helper count for a unit type.
- `!assist range [tiles]` — set detection radius in tiles.
- `!assist status` — view active helper limits and units.
- `!assist save` — save current settings as default.

#### `!autofill` | `!af`
Automatically feeds ammunition and production resources into turrets and factories within player radius from core or inventory.
- `!autofill [1/0?]` — toggle auto-replenishment.
- `!autofill settings` (or `!af s`) — open the interactive visual autofill control panel.
- **Ammo & fuel config:** every turret and every item-burning generator gets its own list dialog (`Ammo` / `Fuel` button) with the item order (top = loaded first) and a per-item on/off switch.
- **Generator fuel:** the combustion generator can burn coal, pyratite, spore-pod and blast-compound; the RTG generator burns thorium, phase-fabric and fissile matter. By default only coal / thorium + phase-fabric are enabled, the rest is listed but switched off.

#### `!grab` | `!gr`
Automatically pulls designated item from nearby blocks into your unit inventory.
- `!grab [item]` — specify item to collect and activate collector.
- `!grab [1/0?]` — toggle autograb on/off.
- `!grab min [number]` — minimum item threshold in block before grabbing.
- `!grab status` — view active grab configuration.
- `!grab effects` — toggle visual on block.

#### `!trace` | `!tr`
Auto-possesses designated unit types as soon as they spawn or become free.
- `!trace [1/0?]` — toggle auto-possession.
- `!trace set [unit]` — set single target unit type.
- `!trace find` — possess highest-priority unit available.
- `!trace fconfig [units...]` — configure priority hierarchy (e.g. `!trace fconfig corvus mega reign`).
- `!trace status` — view queue and active target.

#### `!select`
Mass RTS selection for specified unit types across the map.
- `!select [units...]` — select all friendly units of specified types in RTS mode (e.g. `!select poly mega mono`).

---

### 4. Combat, Aiming & Range Overlays

#### `!aim`
Advanced combat aimbot with target priority filters, lead prediction, and heal targeting.
- `!aim` — opens draggable aimbot configuration widget.
- **Features:**
  - Independent toggles for targeting enemy units and structures.
  - Auto-targets damaged friendly structures with repair weapons.
  - Ballistic lead calculation accounting for bullet speed, ping, and target velocity.
  - Priority Modes: `Nearest`, `Farthest`, `Min/Max Current HP`, `Min/Max Max HP`.
  - Filter Modes: `Ground/Air`, `Air/Ground`, `Ground Only`, `Air Only`.
  - Tap-to-Lock: click any unit or block to lock as exclusive priority; tap empty ground to release.

#### `!trange`
- `!trange [1/0?]` — weapon range circles for all enemy turrets.

#### `!urange`
- `!urange [1/0?]` — weapon range circles around all enemy units.

#### `!hp`
- `!hp [1/0?]` — health and shield bars above targeted units and buildings.
- `!hp [player_name] [1/0?]` — track a specific player with a line and health HUD.

---

### 5. HUD Panels & Widgets

#### `!core`
Draggable real-time statistics panel showing core storage, dynamic income rates, and power balance.
- `!core` — open interactive GUI configuration.
- `!core all` — display resource panels for ALL teams on the map that own cores.
- `!core clear` (or `!core close`) — close all open core panels.
- `!core [team_name | id]` — toggle panel for a specific team.
- **Displays:** item counts with live rate of change (`+/-` per second), power generation vs. consumption balance, battery storage, and remaining construction plan costs.
- Drag panels with Right Mouse Button (RMB).

#### `!units` | `!u`
Draggable HUD showing active unit counts and icons for all teams on the map.
- `!units [1/0?]` (or `!u`) — toggle visibility.
- `!units settings` (or `!units s`) — configure icon size, columns, refresh rate, and blacklist.
- **Interactions:**
  - Hover: traces laser lines to all units of that type across the map.
  - Click (Enemy): centers camera on nearest enemy unit of that type.
  - Click (Friendly): selects all units of this type in RTS command mode.
  - Double-Click (Friendly): immediately possesses the nearest unit of that type.
  - Right-Click: selects units in RTS mode.

#### `!table`
Draggable schematic palette HUD for one-click placement.
- `!table [1/0?]` — toggle table display.
- `!table settings` (or `!table s`) — configure rows, columns, button sizes, hover preview (on/off + scale), and resets.
- **Interactions:**
  - Left-Click: select and place schematic.
  - Double-Click: open slot configuration.
  - Hover: schematic preview (toggleable and scalable in `!table settings`).
  - **Shift + Left-Click Drag:** drag and drop slot icons to reorder or swap schematics.
  - Right-Click Drag: move the entire table across the screen.

#### `!cmap`
Draggable real-time minimap widget displaying terrain, units, structures, and player viewports.
- `!cmap` — open minimap settings dialog.
- Left-Click / Tap: open vanilla full-screen map.
- Left-Drag / Tap & Drag: move the minimap widget across HUD.
- Right-Click / Long-Press (0.4s): instantly teleport camera to clicked location.
- Right-Drag / Long-Press & Drag: smoothly pan camera across the map.

#### `!cbinds` | `!cbind`
Create custom draggable on-screen action buttons.
- `!cbinds` — open editor dialog to create, resize, style, and assign chat commands or texts to buttons.
- Drag buttons across HUD with Right Mouse Button.

#### `!quickchat`
Customizable on-screen macros and chat automation widget.
- Supports multi-line messages, automatic 150-character message splitting, and command triggers.
- Auto Execute: automatically runs selected commands upon joining any world or server.

---

### 6. Diagnostics, System & Utilities

#### `!opt`
Visual Performance & FPS Optimizer dialog.
- Toggle particle effects, bullet trails, smoke, vegetation rendering, block shadows, floor animations, and lighting.
- One-click "Max Performance" profile and "Reset Defaults".
- Automatic configuration bypass for World Processors.

#### `!log`
Action and chat logging engine.
- `!log [1/0?]` — toggle logging.
- `!log status` — view log status and total recorded actions.
- `!log [player_name?]` — view recent actions (optional player filter).
- `!log show [player_name?]` — render logged block placements/destructions directly on world tiles.
- `!log revert [player_name]` — revert all block destructions performed by a player.
- `!log chat` — view chat history including player joins, leaves, and name changes.
- `!log save [path?]` — export log to file.
- `!log path [path / reset]` — configure export directory.

#### `!mlog`
Processor Mlog script loader, injector, and editor extensions.
- `!mlog list` — list available scripts in `qol/mlog/`.
- `!mlog [file]` — inject code into the first empty friendly processor.
- `!mlog [file] set` — prime code to inject into the next processor you shoot.
- **Editor Extensions (inside Processor Edit screen):**
  - Copy with Labels: converts line-number jumps to readable symbolic labels.
  - Save / Load to QoL: persist processor code directly to local files.
  - Insert & Replace Code: search/replace code with automatic jump and label remapping.

#### `!detector` | `!dt`
Scans all logic processors on the map matching regex patterns defined in `Mindustry/qol/mlog/regex.json`.
- `!detector [pattern_name]` — find processors matching pattern.
- `!detector log` — display coordinates of matching processors.

#### `!track`
Real-time player cursor and RTS command path visualizer.
- `!track [player_name?]` — show cursor positions for all players or a specific player.
- `!track ui` (or `!track settings`) — open tracking configuration dialog.
- `!track [rts / rec]` — toggle visual RTS path lines or factory rally lines.
- `!track notify [1/0]` — chat notifications when players issue RTS commands.

#### `!bind` | `!binds`
Keyboard shortcut manager for chat commands and text macros with multi-key combos and server IP filtering.

#### `!colors`
Real-time color palette customizer for Mindustry engine colors (`Pal.java`).

#### `!mute`
Local chat mute for specific players.
- `!mute list` — list muted players.
- `!mute add [player_name]` — mute exact player name.
- `!mute addp [substring]` — mute any player name containing substring.
- `!mute remove [player_name]` — unmute player.

#### `!lookat` | `!la`
- `!lookat [x] [y]` — center camera on world tile coordinates.
- `!lookat last [number?]` — review or jump to recent coordinate history.

#### `!here` | `!herec`
- `!here [message?]` — broadcast camera center coordinates to team chat.
- `!herec [message?]` — broadcast mouse cursor coordinates to team chat.

#### `!cghost` | `!cg`
Instantly deletes broken structure ghost plans that lie within enemy turret range to prevent auto-rebuilding units from dying.

#### `!wave`
Skips waves immediately, bypassing the `waitEnemies` map rule.
- `!wave [number?]` — skip 1 wave, or N waves at 1 wave/sec.
- `!wave status` — view wave status, alive enemies, and map rules.
*(Requires admin/host on multiplayer servers)*.

#### `!render`
Toggle rendering of visual layers to save performance.
- `!render <bullets | units | blocks | layers> [1/0?]`

#### `!server`
Fast server connection dialog to ping, favorite, and connect to multiplayer servers.

#### `!users` | `!user`
Lists all players on the current server running QoL-Control.

---

### 7. Passive & Background Features

- **Logic Processor Buffer (`core/logicfix`):** When placing processors, it placings empty and only then pastes the code? so it bypasses server bug when code is big.
- **Research & Sandbox Unlocker (`core/unlocker`):** Removes research locks on items, units, and structures, and exposes sandbox blocks and hidden ones.
- **Multitask (`features/multitask`):** Allows firing weapons at enemies or cursor while simultaneously building, deconstructing, or mining.
- **Omni Rotation & Speed (`features/omnirot`):** Enables omnidirectional movement and maximum rotation speed on all units.
- **Plan Range & Projector Highlights (`features/plan_range`):** Renders range circles for planned turrets and overdrives.
- **Building Info HUD (`ui/binfo`):** Draggable HUD displaying building name, team, HP, items, liquids, and power balance when hovering or tapping structures.
- **Build Pause Button (`ui/buildpause`):** Draggable HUD button to pause and resume the construction queue.
- **Camera Lock Button (`ui/camera`):** Draggable HUD button to lock player unit in place while freely moving camera.
