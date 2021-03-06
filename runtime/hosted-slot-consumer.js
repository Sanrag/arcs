/**
 * @license
 * Copyright (c) 2018 Google Inc. All rights reserved.
 * This code may only be used under the BSD style license found at
 * http://polymer.github.io/LICENSE.txt
 * Code distributed by Google as part of this project is also
 * subject to an additional IP rights grant found at
 * http://polymer.github.io/PATENTS.txt
 */

import {assert} from '../platform/assert-web.js';
import {SlotConsumer} from './slot-consumer.js';
import {HostedSlotContext} from './hosted-slot-context.js';

export class HostedSlotConsumer extends SlotConsumer {
  constructor(transformationSlotConsumer, hostedParticleName, hostedSlotName, hostedSlotId, storeId, arc) {
    super();
    this._transformationSlotConsumer = transformationSlotConsumer;
    this._hostedParticleName = hostedParticleName;
    this._hostedSlotName = hostedSlotName, 
    this._hostedSlotId = hostedSlotId;
    // TODO: should this be a list?
    this._storeId = storeId;
    this._arc = arc;
  }

  get transformationSlotConsumer() { return this._transformationSlotConsumer; }
  get hostedParticleName() { return this._hostedParticleName; }
  get hostedSlotName() { return this._hostedSlotName; }
  get hostedSlotId() { return this._hostedSlotId; }
  get storeId() { return this._storeId; }
  get arc() { return this._arc; }

  get consumeConn() { return this._consumeConn; }
  set consumeConn(consumeConn) {
    assert(this.hostedSlotId == consumeConn.targetSlot.id,
      `Expected target slot ${this.hostedSlotId}, but got ${consumeConn.targetSlot.id}`);
    assert(this.hostedParticleName == consumeConn.particle.name,
      `Expected particle ${this.hostedParticleName} for slot ${this.hostedSlotId}, but got ${consumeConn.particle.name}`);
    assert(this.hostedSlotName == consumeConn.name,
      `Expected slot ${this.hostedSlotName} for slot ${this.hostedSlotId}, but got ${consumeConn.name}`);
    this._consumeConn = consumeConn;

    if (this.transformationSlotConsumer.slotContext.container) {
      this.startRender();
    }
  }

  setContent(content) {
    this.renderCallback && this.renderCallback(
        this.transformationSlotConsumer.consumeConn.particle,
        this.transformationSlotConsumer.consumeConn.name,
        this.hostedSlotId,
        this.transformationSlotConsumer.formatHostedContent(this, content));
  }

  constructRenderRequest() {
    return this.transformationSlotConsumer.constructRenderRequest(this);
  }

  getInnerContainer(name) {
    if (this.storeId) {
      let subId = this.arc.findStoreById(this.storeId)._stored.id;
      return this.transformationSlotConsumer.getInnerContainer(name)[subId];
    }
  }

  createProvidedContexts() {
    assert(this.consumeConn, `Cannot create provided context without consume connection for hosted slot ${this.hostedSlotId}`);
    return this.consumeConn.slotSpec.providedSlots.map(providedSpec => {
      return new HostedSlotContext(this.arc.generateID(), providedSpec, this);
    });
  }

  updateProvidedContexts() {
    // The hosted context provided by hosted slots is updated as part of the transformation.
  }
}
