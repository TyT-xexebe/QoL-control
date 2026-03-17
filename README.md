## About

This mod tries to combine most basic features that may be useful during gameplay and a QoL functional.

You can see more detailed info about commands directly in the game by typing:

`!qol <cmd?>`

you can use `!` or `?` prefixes for commands

## Foo's Client Compatibility

If you use Foo's Client, my mod chat commands will conflict with it because of 2 character ID in Foo's messages, to fix this:

Go to Settings -> QoL Control.
Enable "Turn on if you using Foo's client" and restart the game.

You must use the ? prefix for my commands (?qol instead of !qol), because Foo's Client already reserves the ! prefix for its own commands.

## Commands

**Note on Toggles:** Most commands that toggle a feature on or off (e.g., `!trace toggle`, `!autofill`, `!log toggle`) can now accept an optional argument to explicitly set the state. 
You can use `1`, `true`, or `on` to enable the feature, and `0`, `false`, or `off` to disable it. 
For example: `!trace toggle 1` will always turn trace ON, regardless of its previous state. If no argument is provided, it will simply switch the current state.
This added for easier using commands, and also for quickchat things.

#### `!mining` | `!m`
Takes all free units on the map (that are enabled in your settings) and distributes them to mine the enabled resources.

`!mining set <sec>` | `!m s <sec>`
Starts the unit distribution algorithm and updates it every `<sec>` seconds. The best option is to set it to 4-10 seconds. Type `0` in `<sec>` to run the distribution only once.

`!mining stop` | `!m stop`
Stops the distribution algorithm.

`!mining <units/items?> <1/0?>` | `!m <units/items?> <1/0?>`
Toggles the setting of a unit or resource to the opposite of what it currently is (or explicitly sets it). Supports entering multiple at once: `!mining scrap poly beryllium` or `!mining scrap poly 1`

`!mining status` | `!m st`
Shows the status of the algorithm, enabled/disabled units and resources, and the current unit distribution.

`!mining free <%>` | `!m f <%>`
Sets the % (0-100) of free units. Any player can take `<%>` of the units from the miner, and it won't take them back. To give the units back to the miner, you must give them a rts task to mine, or the units must not move for 5 seconds (within a 2-tile radius).

`!mining ignore <unit> <items.../clear> <1/0?> | !m ig <unit? <items.../clear> <1/0?>`
Toggles the setting of a unit which items it will ignore to mine
Supports entering multiple items at once:
`!m ig poly scrap lead`
!!! settings of `!m <items?>` >>> then `!m ig` !!!

`!mining save` | `!m save`
Saves the current enabled/disabled settings for units, resources, and the % of free units as default settings.

#### `!assist` | `!as`
Units around you within an `n` tile radius will help you build, even if they are currently mining.

`!assist toggle <1/0?>` | `!as t <1/0?>`
Toggles assist mode on/off.

`!assist toggle <unit> <1/0?>` | `!as t <unit> <1/0?>`
Toggles assist mode for a specific unit type.

`!assist max <unit> <val>` | `!as m <unit> <val>`
Sets the maximum number of a specific unit type that can assist you.

`!assist range <val>` | `!as r <val>`
Sets the assist radius in blocks.

`!assist status` | `!as s`
Shows the current assist settings and status.

`!assist save` | `!as save`
Saves the current assist settings as default.

#### `!ai`
AI for automatic mining, building help and unit lock.

`!ai mining <item?> <1/0?>` | `!ai m <item?> <1/0?>`
Toggles automatic mining  (can toggle specific items to mine).

`!ai build <name? | -1> <1/0?>` | `!ai b <name? | -1> <1/0?>`
Toggles automatic building to help another playere to build. If a player name is provided, your unit will follow and help them build. Use `-1` for AUTO mode.

`!ai lock <1/0?>` | `!ai l <1/0?>`
Toggles lock mode, will fix your unit coordinates and mining coords.

`!ai status` | `!ai s`
Shows the current AI status.

#### `!autofill <1/0?>` | `!af <1/0?>`
Toggles autofilling of turrets with resources from the core / your inventory.

#### `!grab` | `!gr`
Automatically grabs a specific item from any blocks in your radius.

`!grab <item>` | `!gr <item>`
Sets the item to grab and enables it.

`!grab toggle <1/0?>` | `!gr t <1/0?>`
Toggles autograb on/off.

`!grab min <val>` | `!gr min <val>`
Sets the minimum amount of item in block to grab it.

`!grab status` | `!gr s`
Shows the current grab status.

#### `!cghost` | `!cg`
Clears all your ghost blocks (destroyed blocks waiting to be rebuilt) if they in enemy turrets range.

#### `!detector` | `!dt`
Finds logic processors matching specific regex rules from `qol/mlog/regex.json` (in your Mindustry directory),

`!detector <name>` | `!dt <name>`
Searches for processors matching the `<name>` rule.

`!detector log` | `!dt log`
Shows the coordinates of the last found processors.

#### `!here <text?> `
Sends a chat message with your current camera coordinates.

#### `!hp`
`!hp <1/0?>`
Toggles the display of HP and shield for the unit you are currently shooting at.

`!hp <name?> <1/0?>`
Tracks a specific player's HP and draws a line to them.

#### `!log`
Logs block placements, destructions and changed by players in your team. (may cause FPS drops and longer load in world)

`!log toggle <1/0?>` | `!log t <1/0?>`
Toggles the logger on/off.

`!log status`
Shows the current logger status.

`!log <name?>`
Shows the logs, optionally filtered by player name.

`!log show <name?>`
Draws the logged actions on the map, optionally filtered by player name.

`!log revert <name>`
Reverts all block destructions made by a specific player.

`!log chat`
Show chat loga (join/leave/ingame name change also).

`!log save`
Saves the logs to a file in Mindustry directory (/qol/).

#### `!lookat` | `!la`
`!lookat <x> <y>` | `!la <x> <y>`
Moves your camera to the specified coordinates.

`!lookat last <n?>` | `!la l <n?>`
Moves your camera to the last `n` recorded locations. `!lookat last` to see saved history

#### `!mlog`
Injects mlog code from the `/qol/mlog/` folder (in Mindustry directory) into processors.

`!mlog list`
Lists all available `.txt` files in the `mlog/` folder.

`!mlog <filename>`
Injects the code from the specified file into the first empty processor found on your team.

`!mlog <filename> set`
Prepares the code to be injected into a processor you shoot at.

`!mlog <filename> set`
Deletes .txt file

#### `!trace` | `!tr`
Automatically possesses a specific unit type when it becomes available.

`!trace toggle <1/0?>` | `!tr t <1/0?>`
Toggles trace mode on/off.

`!trace set <unit>` | `!tr s <unit>`
Sets a specific unit type to automatically possess.

`!trace find` | `!tr f`
Automatically possesses the best available unit based on a priority list.

`!trace status` | `!tr st`
Shows the current trace status and priority list.

#### `!trange <1/0?>`
Toggles the display of enemy turret ranges. (may cause FPS drops)

#### `!table`
Table of schematics which can be changed and moved.

`!table rows/cols <val>`
Sets rows / columns of table.

`!table size <val>`
Sets button size.

`!table reset`
Resets table.

`!table toggle <1/0?>`
Toggles On / Off table display.

#### `render <bullet/unit/block/layer> <1/0?>`
Toggles render of <?> (may have some issues on PC, or with using other mods, layers cursed af).

#### `server`
Fast join to servers which you added to it.

#### `!mute`
Local chat mute for specific players. Hides their messages from your chat (dont work for bubble chat).

`!mute list`
Shows all currently muted players (both exact and partial mutes).

`!mute add <name>`
Mutes a player by their exact name (ignoring color tags. You can write only part of a name, it will search for player on server with it and add full name in mute list).

`!mute addp <name>`
Mutes any player whose name contains the specified `<name>` (partial match).

`!mute remove <name>` | `!mute rem <name>`
Unmutes a player by removing them from the mute list.

#### `!map`

Shows current map stats.

## Features

#### Camera lock button

Locks your unit, while you can move your camera anywhere.

#### Build pause button

Pauses building.

#### Quick chat button.

You can add your own quick text buttons to send them in chat.

You can send multiple messages with a single just write them on separate lines.

Long texts that exceed the games 150 character limit are automatically split into several messages.

Includes a default Auto Execute button that automatically sends your text or commands every time you join server/world. It has crash protection that disables it if the game crashes during execution.

#### Build info

Shows build info (name, team, hp, itmes, liquids, power, battery) when hover/tap on it

#### Omnimovement + rotateSpeed for units

#### Mlog Editor Extensions

##### Requires "Features mlog" enabled in settings. This feature is experimental and lightly tested; bugs may occur. Always backup your processor code before merging.

##### Available at the processors Edit menu:

Copy with Labels
Converts absolute line numbers in jump commands into text labels, and copies the result to the clipboard.

Save/Load to QoL
Saves the current processor code to the Mindustry/qol/mlog/ folder (survives mod updates), or opens a menu to load/delete existing one.

Save Range to QoL
Saves a specific chunk of code by defining start and end lines (0-indexed). 
(Jumps within the range are converted to labels, jumps pointing outside the range are set to -1)

Insert Code
Injects code from the clipboard or a saved file after a specified line (use -1 to insert at the very beginning). 
Automatically assigns unique label prefixes to both the existing and inserted code to prevent jump conflicts.

Replace Code
Finds and replaces specific lines or multi-line blocks of code throughout all processor.
Automatically protects and updates all jump targets using labels, ensuring that replacing code blocks of different lengths wont break your existing jumps.

^! Its a testing feature that may contain bugs !^

## Performance

The mod is made to be as lightweight as possible so it doesn't heavily load your device.

However, some features may cause FPS drops in certain situations (`log`, `ai`, `trange`).

There is also a optimizer that disables some unnecessary game features to increase FPS.

## Settings

All features can be fully disabled ingame settings meny.

By default everything is enabled, but you can disable anything if you want.


For `!mlog` you can add your own mlog codes in:

`/qol/mlog/` which is in your Mindustry directory `/files/`

(Some stuff is already there by default.)


For `!detector` you can add your own regex in:

`/qol/mlog/regex.json`

By default it contains `attem` and `wpx`.

All logs from `!log save` saving in `/qol/`, it also always have default log `/qol/main_log.txt` from your last game if `!log toggle` was enabled.

## Who Cares

The mod code is complete garbage, and about 30% of it was written with AI.  
Don't judge too hard — it works, and it works well xD

## Issues

Make an issue on GitHub if you find bugs.

Suggestions for expanding the mod (or improving the garbage code) are not really needed.  
I'm too lazy to expand it and make it heavier, I think the current features are enough.

## Note

`!mining` and `!assist` are **not synchronized between players** using the mod.  
This may cause some problems if multiple players use them at the same time.

---

⭐ Leave a star if you like it :3
