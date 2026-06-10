/**
 * GroupControlRegistry
 *
 * Module-level singleton that holds the muted-group set and per-thread
 * last-activity timestamps.
 *
 * Used by:
 *   • groupMuteMiddleware   — silently block commands from muted threads
 *   • ControlPlugin         — reads/writes mute state and activity
 */

const _mutedThreads = new Set<string>();
const _lastActivity = new Map<string, number>();

export function muteThread(id: string): void   { _mutedThreads.add(id); }
export function unmuteThread(id: string): void { _mutedThreads.delete(id); }
export function isMuted(id: string): boolean   { return _mutedThreads.has(id); }
export function getMutedThreads(): ReadonlySet<string> { return _mutedThreads; }

export function recordActivity(id: string): void    { _lastActivity.set(id, Date.now()); }
export function getLastActivity(id: string): number { return _lastActivity.get(id) ?? 0; }
