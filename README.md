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

#### `!mining` | `!m`
Takes all free units on the map (that are enabled in your settings) and distributes them to mine the enabled resources.

`!mining set <sec>` | `!m s <sec>`
Starts the unit distribution algorithm and updates it every `<sec>` seconds. The best option is to set it to 4-10 seconds. Type `0` in `<sec>` to run the distribution only once.

`!mining stop` | `!m stop`
Stops the distribution algorithm.

`!mining <units/items?>` | `!m <units/items?>`
Toggles the setting of a unit or resource to the opposite of what it currently is. Supports entering multiple at once: `!mining scrap poly beryllium`

`!mining status` | `!m st`
Shows the status of the algorithm, enabled/disabled units and resources, and the current unit distribution.

`!mining free <%>` | `!m f <%>`
Sets the % (0-100) of free units. Any player can take `<%>` of the units from the miner, and it won't take them back. To give the units back to the miner, you must give them a rts task to mine, or the units must not move for 5 seconds (within a 2-tile radius).

`!mining save` | `!m save`
Saves the current enabled/disabled settings for units, resources, and the % of free units as default settings.

#### `!assist` | `!as`
Units around you within an `n` tile radius will help you build, even if they are currently mining.

`!assist toggle` | `!as t`
Toggles assist mode on/off.

`!assist toggle <unit>` | `!as t <unit>`
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

`!ai mining <item?>` | `!ai m <item?>`
Toggles automatic mining  (can toggle specific items to mine).

`!ai build <name? | -1>` | `!ai b <name? | -1>`
Toggles automatic building to help another playere to build. If a player name is provided, your unit will follow and help them build. Use `-1` for AUTO mode.

`!ai lock` | `!ai l`
Toggles lock mode, will fix your unit coordinates and mining coords.

`!ai status` | `!ai s`
Shows the current AI status.

#### `!autofill` | `!af`
Toggles autofilling of turrets with resources from the core / your inventory.

#### `!grab` | `!gr`
Automatically grabs a specific item from any blocks in your radius.

`!grab <item>` | `!gr <item>`
Sets the item to grab and enables it.

`!grab toggle` | `!gr t`
Toggles autograb on/off.

`!grab min <val>` | `!gr min <val>`
Sets the minimum amount of item in block to grab it.

`!grab status` | `!gr s`
Shows the current grab status.

#### `!cghost` | `!cg`
Clears all your ghost blocks (destroyed blocks waiting to be rebuilt) if they in enemy turrets range.

#### `!detector` | `!dt`
Finds logic processors matching specific regex rules from `mlog/regex.json`.

`!detector <name>` | `!dt <name>`
Searches for processors matching the `<name>` rule.

`!detector log` | `!dt log`
Shows the coordinates of the last found processors.

#### `!here <text?> `
Sends a chat message with your current camera coordinates.

#### `!hp`
`!hp`
Toggles the display of HP and shield for the unit you are currently shooting at.

`!hp <name?>`
Tracks a specific player's HP and draws a line to them.

#### `!log`
Logs block placements, destructions and changed by players in your team. (may cause FPS drops and longer load in world)

`!log toggle` | `!log t`
Toggles the logger on/off.

`!log status`
Shows the current logger status.

`!log <name?>`
Shows the logs, optionally filtered by player name.

`!log show <name?>`
Draws the logged actions on the map, optionally filtered by player name.

`!log revert <name>`
Reverts all block destructions made by a specific player.

`!log save`
Saves the logs to a file in your data directory.

#### `!lookat` | `!la`
`!lookat <x> <y>` | `!la <x> <y>`
Moves your camera to the specified coordinates.

`!lookat last <n?>` | `!la l <n?>`
Moves your camera to the last `n` recorded locations. `!lookat last` to see saved history

#### `!mlog`
Injects mlog code from the `mlog/` folder directly into processors.

`!mlog list`
Lists all available `.txt` files in the `mlog/` folder.

`!mlog <filename>`
Injects the code from the specified file into the first empty processor found on your team.

`!mlog <filename> set`
Prepares the code to be injected into a processor you shoot at.

#### `!trace` | `!tr`
Automatically possesses a specific unit type when it becomes available.

`!trace toggle` | `!tr t`
Toggles trace mode on/off.

`!trace set <unit>` | `!tr s <unit>`
Sets a specific unit type to automatically possess.

`!trace find` | `!tr f`
Automatically possesses the best available unit based on a priority list.

`!trace status` | `!tr st`
Shows the current trace status and priority list.

#### `!trange`
Toggles the display of enemy turret ranges. (may cause FPS drops)

#### `!table`
Table of schematics which can be changed and moved.

`!table rows/cols <val>`
Sets rows / columns of table.

`!table size <val>`
Sets button size.

`!table reset`
Resets table.

`!table toggle`
Toggles On / Off table display.

#### `render <bullet/unit/block>`
Toggles render of <?> (may have some issues on PC, or with using other mods).

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

## Features

#### Camera lock button

Locks your unit, while you can move your camera anywhere.

#### Build pause button

Pauses building.

#### Quick chat button.

You can add your own quick text buttons to send them in chat.

You can send multiple messages with a single just write them on separate lines.

Long texts that exceed the games 150 character limit are automatically split into several messages.

#### Omnimovement + rotateSpeed for units

## Performance

The mod is made to be as lightweight as possible so it doesn't heavily load your device.

However, some features may cause FPS drops in certain situations (`log`, `ai`, `trange`).

There is also a optimizer that disables some unnecessary game features to increase FPS.

## Settings

All features can be fully disabled in:

`/scripts/settings.json`

By default everything is enabled, but you can disable anything if you want.


For `!mlog` you can add your own mlog codes in:

`/mlog/`

(Some stuff is already there by default. I'm too lazy to delete it.)


For `!detector` you can add your own regex in:

`/mlog/regex.json`

By default it contains `attem` and `wpx`.

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
