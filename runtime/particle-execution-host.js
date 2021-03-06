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
import {PECOuterPort} from './api-channel.js';
import {Manifest} from './manifest.js';
import {RecipeResolver} from './recipe/recipe-resolver.js';
import {reportSystemException} from './arc-exceptions.js';

export class ParticleExecutionHost {
  constructor(port, slotComposer, arc) {
    this._particles = [];
    this._apiPort = new PECOuterPort(port, arc);
    this.close = () => {
      port.close();
      this._apiPort.close();
    };
    this._arc = arc;
    this._nextIdentifier = 0;
    this.slotComposer = slotComposer;

    this._apiPort.onRender = ({particle, slotName, content}) => {
      if (this.slotComposer) {
        this.slotComposer.renderSlot(particle, slotName, content);
      }
    };

    this._apiPort.onInitializeProxy = async ({handle, callback}) => {
      let target = {};
      handle.on('change', data => this._apiPort.SimpleCallback({callback, data}), target);
    };

    this._apiPort.onSynchronizeProxy = async ({handle, callback}) => {
      let data = await handle.toLiteral();
      this._apiPort.SimpleCallback({callback, data});
    };

    this._apiPort.onHandleGet = async ({handle, callback}) => {
      this._apiPort.SimpleCallback({callback, data: await handle.get()});
    };

    this._apiPort.onHandleToList = async ({handle, callback}) => {
      this._apiPort.SimpleCallback({callback, data: await handle.toList()});
    };

    this._apiPort.onHandleSet = ({handle, data, particleId, barrier}) => handle.set(data, particleId, barrier);
    this._apiPort.onHandleClear = ({handle, particleId, barrier}) => handle.clear(particleId, barrier);
    this._apiPort.onHandleStore = ({handle, data: {value, keys}, particleId}) => handle.store(value, keys, particleId);
    this._apiPort.onHandleRemove = ({handle, data: {id, keys}, particleId}) => handle.remove(id, keys, particleId);

    this._apiPort.onIdle = ({version, relevance}) => {
      if (version == this._idleVersion) {
        this._idlePromise = undefined;
        this._idleResolve(relevance);
      }
    };

    this._apiPort.onConstructInnerArc = ({callback, particle}) => {
      let arc = {particle};
      this._apiPort.ConstructArcCallback({callback, arc});
    };

    this._apiPort.onArcCreateHandle = async ({callback, arc, type, name}) => {
      let store = await this._arc.createStore(type, name);
      this._apiPort.CreateHandleCallback(store, {type, name, callback, id: store.id});
    };

    this._apiPort.onArcMapHandle = async ({callback, arc, handle}) => {
      assert(this._arc.findStoreById(handle.id), `Cannot map nonexistent handle ${handle.id}`);
      // TODO: create hosted handles map with specially generated ids instead of returning the real ones?
      this._apiPort.MapHandleCallback({}, {callback, id: handle.id});
    };

    this._apiPort.onArcCreateSlot = ({callback, arc, transformationParticle, transformationSlotName, hostedParticleName, hostedSlotName, handleId}) => {
      let hostedSlotId;
      if (this.slotComposer) {
        hostedSlotId = this.slotComposer.createHostedSlot(transformationParticle, transformationSlotName, hostedParticleName, hostedSlotName, handleId);
      }
      this._apiPort.CreateSlotCallback({}, {callback, hostedSlotId});
    };

    this._apiPort.onArcLoadRecipe = async ({arc, recipe, callback}) => {
      let manifest = await Manifest.parse(recipe, {loader: this._arc._loader, fileName: ''});
      let error = undefined;
      // TODO(wkorman): Consider reporting an error or at least warning if
      // there's more than one recipe since currently we silently ignore them.
      let recipe0 = manifest.recipes[0];
      if (recipe0) {
        const missingHandles = [];
        for (let handle of recipe0.handles) {
          const fromHandle = this._arc.findStoreById(handle.id) || manifest.findStoreById(handle.id);
          if (!fromHandle) {
            missingHandles.push(handle);
            continue;
          }
          handle.mapToStorage(fromHandle);
        }
        if (missingHandles.length > 0) {
          const resolvedRecipe = await new RecipeResolver(this._arc).resolve(recipe0);
          if (!resolvedRecipe) {
            error = `Recipe couldn't load due to missing handles [recipe=${recipe0}, missingHandles=${missingHandles.join('\n')}].`;
          } else {
            recipe0 = resolvedRecipe;
          }
        }
        if (!error) {
          let options = {errors: new Map()};
          // If we had missing handles but we made it here, then we ran recipe
          // resolution which will have already normalized the recipe.
          if ((missingHandles.length > 0) || recipe0.normalize(options)) {
            if (recipe0.isResolved()) {
              // TODO: pass tags through too, and reconcile with similar logic
              // in Arc.deserialize.
              manifest.stores.forEach(store => this._arc._registerStore(store, []));
              this._arc.instantiate(recipe0, arc);
            } else {
              error = `Recipe is not resolvable ${recipe0.toString({showUnresolved: true})}`;
            }
          } else {
            error = `Recipe ${recipe0} could not be normalized:\n${[...options.errors.values()].join('\n')}`;
          }
        }
      } else {
        error = 'No recipe defined';
      }
      this._apiPort.SimpleCallback({callback, data: error});
    };

    this._apiPort.onRaiseSystemException = async ({exception, methodName, particleId}) => {
     let particle = this._arc.particleHandleMaps.get(particleId).spec.name;
      reportSystemException(exception, methodName, particle);
    };
  }

  stop() {
    this._apiPort.Stop();
  }

  get idle() {
    if (this._idlePromise == undefined) {
      this._idlePromise = new Promise((resolve, reject) => {
        this._idleResolve = resolve;
      });
    }
    this._idleVersion = this._nextIdentifier;
    this._apiPort.AwaitIdle({version: this._nextIdentifier++});
    return this._idlePromise;
  }

  get messageCount() {
    return this._apiPort.messageCount;
  }

  sendEvent(particle, slotName, event) {
    this._apiPort.UIEvent({particle, slotName, event});
  }

  instantiate(particleSpec, id, spec, handles) {
    handles.forEach(handle => {
      this._apiPort.DefineHandle(handle, {type: handle.type.resolvedType(), name: handle.name});
    });

    // TODO: rename this concept to something like instantiatedParticle, handle or registration.
    this._apiPort.InstantiateParticle(particleSpec, {id, spec, handles});
    return particleSpec;
  }
  startRender({particle, slotName, contentTypes}) {
    this._apiPort.StartRender({particle, slotName, contentTypes});
  }
  stopRender({particle, slotName}) {
    this._apiPort.StopRender({particle, slotName});
  }
  innerArcRender(transformationParticle, transformationSlotName, hostedSlotId, content) {
    this._apiPort.InnerArcRender({transformationParticle, transformationSlotName, hostedSlotId, content});
  }
}
