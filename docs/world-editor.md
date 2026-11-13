# The world editor

The Owner and Stewards change the lands from inside the game: the **Edit
world** button on the HUD opens edit mode. This page says how it works for
the person editing. How it is built is in `docs/architecture.md` (the world
editor), and the plan it was built from is the World Editor Redesign
proposal (https://claude.ai/code/artifact/QwzvrLNrhdy6J6w6hBWvRR).

## Edit mode

Edit mode takes over the screen. The game's HUD, chat and windows of play
step back (**Chat** in the status strip brings the chat back), and your
character stays where they stand: the camera is free of them. Around the
world:

- **The top bar**: the land being edited, the camera (World or Plan), the
  floor shown, the hour and weather to see the land in (only you see them),
  the Tiles and Hitboxes marks, the drafts pill with **Publish**, and
  **Done**.
- **The rail** on the left: six groups of tools, each with a letter. Press
  the letter again for the group's next tool.

  | Key | Group | Tools |
  | --- | --- | --- |
  | V | Select | Select, Copy and paste |
  | G | Ground | Paint, Scenery, Road |
  | B | Build | Kit building, House, Wall, Storey, Stairs |
  | F | Furnish | Furniture, Set piece, Light |
  | L | Life | Person, Monsters, Gathering |
  | P | Places | Bookmark, Land settings |

  A tool a wish adds that no group names goes under **More** (M).
- **The options bar** above the world: the chosen group's tools.
- **The panel** on the right: the tool's settings, what Select picked, or,
  with Select and nothing picked, the land itself. Drag its left edge to
  make it wider or narrower. This browser remembers the width, and a double
  click puts it back.
- **The status strip** at the bottom: what is under the pointer (and, for a
  tool that makes something, whether it fits there), the last thing that
  happened, Back to me, Bring me here, Chat, Keys, Undo and Redo.

## Two cameras

**Tab** switches between them, as do **World** and **Plan** in the top bar.

- **World**: the game's own view. Pan with W A S D or the arrow keys (Shift
  to go faster) or a right drag, zoom with the wheel or + and −, and press
  **Home** to come back to your character. A tool that makes something shows
  a see-through ghost of it under the pointer before anything is sent.
- **Plan**: any land from above, even one far from where you stand, on any
  floor, coloured by tile. It has its own land menu (workshop lands too),
  zoom, and Tiles, Hitboxes, Spots and People layers. The same tools, panel
  and drafts work here. The Art Studio's **Map editor** tab opens the game
  straight into the Plan camera.

## Walls on one side of a tile

**Wall** (under Build) stands an upright wall on one side of each tile you
drag over, in a building's look, a storey high or half that. The tiles stay
open; only the line between them is closed, so nobody walks through it.
**R** turns the side (north, east, south, west), and **Shift R** turns it
back; a thin outline along the tile under the pointer shows the side. Choose
**Line** as the shape for a straight run. Tick **Take walls down instead** and
drag again to take walls away. A wall standing in front of your character
turns see-through so it never hides them. With **Hitboxes** on, each wall shows a thin red band along its
edge: the part that stops you, not a whole tile.

## Select first, then change

Select (V) picks the smallest thing on a tile: a bookmark, spot, person,
monster's home, piece, stairs, storey or building. The panel then says what
it is and holds what can be done to it: **Move** (M), **Copy** (Ctrl C),
**Take away** (Delete), and a fold for each kind of change that fits it
(look and size, floors above and below, a monster's level and hours, a
patrol path, a quest). Dragging over bare ground with Select copies that
area for Copy and paste.

## The land panel

With nothing picked, the panel shows the land in five tabs:

- **Changes**: the drafts only editors see, what is published, and what the
  land was built with. Hover a row to outline it, and press Go to look at it.
- **Places**: the land's bookmarks, and **Bookmark this view** (Ctrl D).
- **Checks**: what is wrong with the land: shapes that do not hold, places
  players cannot walk to, pictures not painted yet. The checks run again
  after each change, and the places they name are marked red.
- **Architect**: the AI Map Architect. Say in plain words what to change. It
  proposes steps, the server checks each one, and they are marked on the land
  (cyan on the plan) for you to tick before anything is made. Typing a
  sentence in the finder asks it too.
- **Land**: the land's weather and where players arrive, making a workshop
  land (a blank land off the map to build and try things in), and saving the
  land's edits to a file or laying edits from one.

## Drafts

New changes are drafts that only editors see, until **Publish**. The
drafts pill's menu throws them away (Redo brings them back) or makes your
changes go live at once.

## Keys

Press **?** (or **Keys** in the status strip) for the sheet of every key.
**R** turns the Wall tool's side.
**Ctrl K** or **/** opens the finder: type a few letters to choose a tool,
go to a bookmark or do one of the editor's actions. **Esc** first stops what
a tool is part way through, then closes the editor.

Phones get a short note instead: the editor needs a bigger screen.
