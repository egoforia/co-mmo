/** Server simulation rate. Clients send one input per tick. */
export const TICK_RATE = 20;
export const TICK_SECONDS = 1 / TICK_RATE;

/** Movement speed in tiles per second. */
export const PLAYER_SPEED = 4;
/** Half the width of a player's collision box, in tiles. */
export const PLAYER_RADIUS = 0.3;

/** Players only receive entities within this many tiles (area of interest). */
export const VIEW_RADIUS = 24;
/** "Say" chat reaches players within this many tiles. */
export const SAY_RADIUS = 16;

export const MAX_CHAT_LENGTH = 280;
export const MAX_NAME_LENGTH = 20;
export const MIN_NAME_LENGTH = 2;

/**
 * Size of one tile's art, in pixels (Style Bible: 128x128 hand-painted
 * tiles). The camera shows tiles at about half size on a 1080p screen.
 */
export const TILE_PIXELS = 128;
