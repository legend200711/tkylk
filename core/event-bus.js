/**
 * 24-HOUR CLOUD ENGINE — Internal Event Bus
 * cloud-engine/core/event-bus.js
 *
 * Simple publish/subscribe event system.
 * Decouples modules: emitters don't know about subscribers, and vice versa.
 *
 * Usage:
 *   import { CloudEngineEventBus } from '../core/event-bus.js';
 *   import { CLOUD_ENGINE_EVENTS }  from '../core/events.js';
 *
 *   // Subscribe
 *   const unsub = CloudEngineEventBus.on(CLOUD_ENGINE_EVENTS.ENGINE_READY, (payload) => { … });
 *
 *   // Emit
 *   CloudEngineEventBus.emit(CLOUD_ENGINE_EVENTS.ENGINE_READY, { version: '0.1.0' });
 *
 *   // Unsubscribe
 *   unsub();
 */

const _listeners = new Map(); // eventName → Set<handler>

/**
 * Subscribe to an event.
 * @param {string}   eventName
 * @param {Function} handler    Called with (payload) when the event fires.
 * @returns {Function} Unsubscribe function — call it to stop listening.
 */
function on(eventName, handler) {
  if (!_listeners.has(eventName)) {
    _listeners.set(eventName, new Set());
  }
  _listeners.get(eventName).add(handler);

  return function unsubscribe() {
    _listeners.get(eventName)?.delete(handler);
  };
}

/**
 * Subscribe to an event for exactly one invocation, then auto-unsubscribe.
 * @param {string}   eventName
 * @param {Function} handler
 * @returns {Function} Unsubscribe function.
 */
function once(eventName, handler) {
  const unsub = on(eventName, (payload) => {
    unsub();
    handler(payload);
  });
  return unsub;
}

/**
 * Emit an event to all registered listeners.
 * Errors thrown inside listeners are caught and logged to console.error
 * so that a bad listener never prevents other listeners from receiving the event.
 *
 * @param {string} eventName
 * @param {*}      [payload]
 */
function emit(eventName, payload) {
  const handlers = _listeners.get(eventName);
  if (!handlers || handlers.size === 0) return;

  for (const handler of handlers) {
    try {
      handler(payload);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[CloudEngineEventBus] Listener error for event "${eventName}":`, err);
    }
  }
}

/**
 * Remove all listeners for a specific event, or all events if omitted.
 * @param {string} [eventName]
 */
function off(eventName) {
  if (eventName) {
    _listeners.delete(eventName);
  } else {
    _listeners.clear();
  }
}

/**
 * Returns the count of registered listeners for a given event.
 * Primarily for diagnostics.
 * @param {string} eventName
 * @returns {number}
 */
function listenerCount(eventName) {
  return _listeners.get(eventName)?.size ?? 0;
}

export const CloudEngineEventBus = Object.freeze({ on, once, emit, off, listenerCount });
