/**
 * @license
 * Copyright (c) 2017 Google Inc. All rights reserved.
 * This code may only be used under the BSD style license found at
 * http://polymer.github.io/LICENSE.txt
 * Code distributed by Google as part of this project is also
 * subject to an additional IP rights grant found at
 * http://polymer.github.io/PATENTS.txt
 */
'use strict';

import {assert} from '../platform/assert-web.js';
import {CrdtCollectionModel} from './storage/crdt-collection-model.js';

const SyncState = {none: 0, pending: 1, full: 2};

/** @class StorageProxy
 * Mediates between one or more Handles and the backing store outside the PEC.
 *
 * This can operate in two modes, based on how observing handles are configured:
 * - synchronized: the proxy maintains a copy of the full data held by the backing store, keeping
 *                 it in sync by listening to change events from the store.
 * - unsynchronized: the proxy simply passes through calls from Handles to the backing store.
 *
 * In synchronized mode we maintain a queue of sorted update events received from the backing store.
 * While events are received correctly - each update is one version ahead of our stored model - they
 * are processed immediately and observing handles are notified accordingly. If we receive an update
 * with a "future" version, the proxy is desynchronized:
 * - a request for the full data is sent to the backing store;
 * - any update events received after that (and before the response) are added to the queue;
 * - any new updates that can be applied will be (which may cause the proxy to "catch up" and resync
 *   before the full data response arrives);
 * - once the resync response is received, stale queued updates are discarded and any remaining ones
 *   are applied.
 */
export class StorageProxy {
  constructor(id, type, port, pec, scheduler, name) {
    return type.isCollection
        ? new CollectionProxy(id, type, port, pec, scheduler, name)
        : new VariableProxy(id, type, port, pec, scheduler, name);
  }
}

class StorageProxyBase {
  constructor(id, type, port, pec, scheduler, name) {
    this._id = id;
    this._type = type;
    this._port = port;
    this._pec = pec;
    this._scheduler = scheduler;
    this.name = name;

    this._version = undefined;
    this._listenerAttached = false;
    this._keepSynced = false;
    this._synchronized = SyncState.none;
    this._observers = [];
    this._updates = [];
  }

  raiseSystemException(exception, methodName, particleId) {
    this._port.RaiseSystemException({exception: {message: exception.message, stack: exception.stack, name: exception.name}, methodName, particleId});
  }

  get id() {
    return this._id;
  }

  get type() {
    return this._type;
  }

  // Called by ParticleExecutionContext to associate (potentially multiple) particle/handle pairs with this proxy.
  register(particle, handle) {
    if (!handle.canRead)
      return;
    this._observers.push({particle, handle});

    // Attach an event listener to the backing store when the first readable handle is registered.
    if (!this._listenerAttached) {
      this._port.InitializeProxy({handle: this, callback: x => this._onUpdate(x)});
      this._listenerAttached = true;
    }

    // Change to synchronized mode as soon as we get any handle configured with keepSynced and send
    // a request to get the full model (once).
    // TODO: drop back to non-sync mode if all handles re-configure to !keepSynced
    if (handle.options.keepSynced) {
      if (!this._keepSynced) {
        this._port.SynchronizeProxy({handle: this, callback: x => this._onSynchronize(x)});
        this._keepSynced = true;
      }

      // If a handle configured for sync notifications registers after we've received the full
      // model, notify it immediately.
      if (handle.options.notifySync && this._synchronized == SyncState.full) {
        let syncModel = this._getModelForSync();
        this._scheduler.enqueue(particle, handle, ['sync', particle, syncModel]);
      }
    }
  }

  // `model` contains 'version' and one of 'data' or 'list'.
  _onSynchronize(model) {
    if (this._version !== undefined && model.version <= this._version) {
      console.warn(`StorageProxy '${this._id}' received stale model version ${model.version}; ` +
                   `current is ${this._version}`);
      return;
    }

    // We may have queued updates that were received after a desync; discard any that are stale
    // with respect to the received model.
    this._synchronized = SyncState.full;
    while (this._updates.length > 0 && this._updates[0].version <= model.version) {
      this._updates.shift();
    }

    // Replace the stored data with the new one and notify handles that are configured for it.
    this._synchronizeModel(model);

    let syncModel = this._getModelForSync();
    this._notify('sync', syncModel, options => options.keepSynced && options.notifySync);
    this._processUpdates();
  }

  // `update` contains 'version' and one of 'data', 'add' or 'remove'.
  _onUpdate(update) {
    // Immediately notify any handles that are not configured with keepSynced but do want updates.
    if (this._observers.find(({handle}) => !handle.options.keepSynced && handle.options.notifyUpdate)) {
      let handleUpdate = this._processUpdate(update, false);
      this._notify('update', handleUpdate, options => !options.keepSynced && options.notifyUpdate);
    }

    // Bail if we're not in synchronized mode or this is a stale event.
    if (!this._keepSynced)
      return;
    if (update.version <= this._version) {
      console.warn(`StorageProxy '${this._id}' received stale update version ${update.version}; ` +
                   `current is ${this._version}`);
      return;
    }

    // Add the update to the queue and process. Most of the time the queue should be empty and
    // _processUpdates will consume this event immediately.
    this._updates.push(update);
    this._updates.sort((a, b) => a.version - b.version);
    this._processUpdates();
  }

  _notify(kind, details, predicate=() => true) {
    for (let {handle, particle} of this._observers) {
      if (predicate(handle.options)) {
        this._scheduler.enqueue(particle, handle, [kind, particle, details]);
      }
    }
  }

  _processUpdates() {
    // Consume all queued updates whose versions are monotonically increasing from our stored one.
    while (this._updates.length > 0 && this._updates[0].version === this._version + 1) {
      let update = this._updates.shift();

      // Fold the update into our stored model.
      let handleUpdate = this._processUpdate(update);
      this._version = update.version;

      // Notify handles configured with keepSynced and notifyUpdates (non-keepSynced handles are
      // notified as updates are received).
      if (handleUpdate) {
        this._notify('update', handleUpdate, options => options.keepSynced && options.notifyUpdate);
      }
    }

    // If we still have update events queued, we must have received a future version are are now
    // desynchronized. Send a request for the full model and notify handles configured for it.
    if (this._updates.length > 0) {
      if (this._synchronized != SyncState.none) {
        this._synchronized = SyncState.none;
        this._port.SynchronizeProxy({handle: this, callback: x => this._onSynchronize(x)});
        for (let {handle, particle} of this._observers) {
          if (handle.options.notifyDesync) {
            this._scheduler.enqueue(particle, handle, ['desync', particle]);
          }
        }
      }
    } else if (this._synchronized != SyncState.full) {
      // If we were desynced but have now consumed all update events, we've caught up.
      this._synchronized = SyncState.full;
    }
  }

  generateID(component) {
    return this._pec.generateID(component);
  }

  generateIDComponents() {
    return this._pec.generateIDComponents();
  }
}


// Collections are synchronized in a CRDT Observed/Removed scheme.
// Each value is identified by an ID and a set of membership keys.
// Concurrent adds of the same value will specify the same ID but different
// keys. A value is removed by removing all of the observed keys. A value
// is considered to be removed if all of it's keys have been removed.
//
// In synchronized mode mutation takes place synchronously inside the proxy.
// The proxy uses the originatorId to skip over redundant events sent back
// by the storage object.
//
// In unsynchronized mode removal is not based on the keys observed at the
// proxy, since the proxy does not remember the state, but instead the set
// of keys that exist at the storage object at the time it receives the
// request.
class CollectionProxy extends StorageProxyBase {
  constructor(...args) {
    super(...args);
    this._model = new CrdtCollectionModel();
  }
  _getModelForSync() {
    return this._model.toList();
  }
  _synchronizeModel({version, model}) {
    this._version = version;
    this._model = new CrdtCollectionModel(model);
  }
  _processUpdate(update, apply=true) {
    if (this._synchronized == SyncState.full) {
      // If we're synchronized, then any updates we sent have
      // already been applied/notified.
      for (let {handle} of this._observers) {
        if (update.originatorId == handle._particleId) {
          return null;
        }
      }
    }
    let added = [];
    let removed = [];
    if ('add' in update) {
      for (let {value, keys, effective} of update.add) {
        if (apply && this._model.add(value.id, value, keys) || !apply && effective) {
          added.push(value);
        }
      }
    } else if ('remove' in update) {
      for (let {value, keys, effective} of update.remove) {
        if (apply && this._model.remove(value.id, keys) || !apply && effective) {
          removed.push(value);
        }
      }
    } else {
      assert(false, `StorageProxy received invalid update event: ${JSON.stringify(update)}`);
    }
    if (added.length || removed.length) {
      let result = {};
      if (added.length) result.add = added;
      if (removed.length) result.remove = removed;
      result.originatorId = update.originatorId;
      return result;
    }
    return null;
  }
  // Read ops: if we're synchronized we can just return the local copy of the data.
  // Otherwise, send a request to the backing store.
  toList(particleId) {
    if (this._synchronized == SyncState.full) {
      return Promise.resolve(this._model.toList());
    } else {
      // TODO: in synchronized mode, this should integrate with SynchronizeProxy rather than
      //       sending a parallel request
      return new Promise((resolve, reject) =>
        this._port.HandleToList({callback: r => resolve(r), handle: this, particleId}));
    }
  }
  store(value, keys, particleId) {
    let id = value.id;
    let data = {
      value,
      keys,
    };
    this._port.HandleStore({data, handle: this, particleId});

    if (this._synchronized != SyncState.full) {
      return;
    }
    if (!this._model.add(id, value, keys)) {
      return;
    }
    let update = {
      originatorId: particleId,
      add: [value],
    };
    this._notify('update', update, options => options.notifyUpdate);
  }

  remove(id, keys, particleId) {
    if (this._synchronized != SyncState.full) {
      let data = {
        id,
        keys: [],
      };
      this._port.HandleRemove({data, handle: this, particleId});
      return;
    }

    let value = this._model.getValue(id);
    if (!value) return;
    if (keys.length == 0) {
      keys = this._model.getKeys(id);
    }
    let data = {
      id,
      keys,
    };
    this._port.HandleRemove({data, handle: this, particleId});

    if (!this._model.remove(id, keys)) {
      return;
    }
    let update = {
      originatorId: particleId,
      remove: [value],
    };
    this._notify('update', update, options => options.notifyUpdate);
  }
}

// Variables are synchronized in a 'last-writer-wins' scheme. When the
// VariableProxy mutates the model, it sets a barrier and expects to
// receive the barrier value echoed back in a subsequent update event.
// Between those two points in time updates are not applied or
// notified about as these reflect concurrent writes that did not 'win'.
class VariableProxy extends StorageProxyBase {
  constructor(...args) {
    super(...args);
    this._model = null;
    this._barrier = null;
  }
  _getModelForSync() {
    return this._model;
  }
  _synchronizeModel({version, model}) {
    this._version = version;
    this._model = model.length == 0 ? null : model[0].value;
    assert(this._model !== undefined);
  }
  _processUpdate(update, apply=true) {
    assert('data' in update);
    if (!apply) return update;
    // If we have set a barrier, suppress updates until after
    // we have seen the barrier return via an update.
    if (this._barrier != null) {
      if (update.barrier == this._barrier) {
        this._barrier = null;
      }
      return null;
    }
    this._model = update.data;
    return update;
  }
  // Read ops: if we're synchronized we can just return the local copy of the data.
  // Otherwise, send a request to the backing store.
  // TODO: in synchronized mode, these should integrate with SynchronizeProxy rather than
  //       sending a parallel request
  get(particleId) {
    if (this._synchronized == SyncState.full) {
      return Promise.resolve(this._model);
    } else {
      return new Promise((resolve, reject) =>
        this._port.HandleGet({callback: resolve, handle: this, particleId}));
    }
  }
  set(entity, particleId) {
    assert(entity !== undefined);
    if (JSON.stringify(this._model) == JSON.stringify(entity)) {
      return;
    }
    let barrier = this.generateID('barrier');
    // TODO: is this already a clone?
    this._model = JSON.parse(JSON.stringify(entity));
    this._barrier = barrier;
    this._port.HandleSet({data: entity, handle: this, particleId, barrier});
    let update = {
      originatorId: particleId,
      data: entity,
    };
    this._notify('update', update, options => options.notifyUpdate);
  }

  clear(particleId) {
    if (this._model == null) {
      return;
    }
    let barrier = this.generateID('barrier');
    this._model = null;
    this._barrier = barrier;
    this._port.HandleClear({handle: this, particleId, barrier});
    let update = {
      originatorId: particleId,
      data: null,
    };
    this._notify('update', update, options => options.notifyUpdate);
  }
}

export class StorageProxyScheduler {
  constructor() {
    this._scheduled = false;
    // Particle -> {Handle -> [Queue of events]}
    this._queues = new Map();
  }

  // TODO: break apart args here, sync events should flush the queue.
  enqueue(particle, handle, args) {
    if (!this._queues.has(particle)) {
      this._queues.set(particle, new Map());
    }
    let byHandle = this._queues.get(particle);
    if (!byHandle.has(handle)) {
      byHandle.set(handle, []);
    }
    let queue = byHandle.get(handle);
    queue.push(args);
    this._schedule();
  }

  get busy() {
    return this._queues.size > 0;
  }

  _updateIdle() {
    if (this._idleResolver && !this.busy) {
      this._idleResolver();
      this._idle = null;
      this._idleResolver = null;
    }
  }

  get idle() {
    if (!this.busy) {
      return Promise.resolve();
    }
    if (this._idle) {
      return this._idle;
    }
    this._idle = new Promise(resolver => {
      this._idleResolver = resolver;
    });
    return this._idle;
  }

  _schedule() {
    if (this._scheduled) {
      return;
    }
    this._scheduled = true;
    setTimeout(() => {
      this._scheduled = false;
      this._dispatch();
    }, 0);
  }

  _dispatch() {
    // TODO: should we process just one particle per task?
    while (this._queues.size > 0) {
      let particle = [...this._queues.keys()][0];
      let byHandle = this._queues.get(particle);
      this._queues.delete(particle);
      for (let [handle, queue] of byHandle.entries()) {
        for (let args of queue) {
          try {
            handle._notify(...args);
          } catch (e) {
            console.error('Error dispatching to particle', e);
            handle._proxy.raiseSystemException(e, 'StorageProxyScheduler::_dispatch', particle.id);
          }
        }
      }
    }

    this._updateIdle();
  }
}
