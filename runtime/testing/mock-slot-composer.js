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

import {assert} from '../test/chai-web.js';
import {SlotComposer} from '../slot-composer.js';
import {SlotDomConsumer} from '../slot-dom-consumer.js';

let logging = false;
let log = (!logging || global.logging === false) ? () => {} : console.log.bind(console, '---------- MockSlotComposer::');

/** @class MockSlotComposer
 * Helper class to test with slot composer.
 * Usage example:
 *   mockSlotComposer
 *       .newExpectations()
 *           .expectRenderSlot('MyParticle1', 'mySlot1', {contentTypes: ['template']});
 *           .expectRenderSlot('MyParticle1', 'mySlot1', {contentTypes: ['model'], times: 2})
 *           .expectRenderSlot('MyParticle2', 'mySlot2', {verify: (content) => !!content.myParam})
 *           .expectRenderSlot('MyOptionalParticle', 'myOptionalSlot', {contentTypes: ['template', 'model'], isOptional: true})
 *   mockSlotComposer.sendEvent('MyParticle1', 'mySlot1', '_onMyEvent', {key: 'value'});
 *   await mockSlotComposer.expectationsCompleted();
 */
export class MockSlotComposer extends SlotComposer {
  /**
   * |options| may contain:
   * - strict: whether unexpected render slot requests cause an assert or a warning log (default: true)
   */
  constructor(options) {
    options = options || {};
    super({rootContainer: options.rootContainer || {'root': 'root-context'}, affordance: 'mock'});
    this.expectQueue = [];
    this.onExpectationsComplete = () => undefined;
    this.strict = options.strict != undefined ? options.strict : true;
    this.logging = options.logging;
    this.debugMessages = [];

    // Clear all cached templates
    SlotDomConsumer.dispose();
  }

   // Overriding this method to investigate AppVeyor failures.
   // TODO: get rid of it once the problem is fixed.
  _addSlotConsumer(slot) {
    super._addSlotConsumer(slot);
    let startCallback = slot.startRenderCallback;
    slot.startRenderCallback = ({particle, slotName, contentTypes}) => {
      this._addDebugMessages(`  StartRender: ${slot.consumeConn.getQualifiedName()}`);
      startCallback({particle, slotName, contentTypes});
    };
  }

  /** @method newExpectations()
   * Reinitializes expectations queue.
   */
  newExpectations(name) {
    assert(this.expectQueue.every(e => e.isOptional));
    this.expectQueue = [];

    if (!this.strict) {
      this.ignoreUnexpectedRender();
    }
    this.debugMessages.push({name: name || `debug${Object.keys(this.debugMessages).length}`, messages: []});
    return this;
  }

  /** @method ignoreUnexpectedRender
   * Allows ignoring unexpected render slot requests.
   */
  ignoreUnexpectedRender() {
    this.expectQueue.push({type: 'render', ignoreUnexpected: true, isOptional: true,
                           toString: () => `render: ignoreUnexpected optional`});
    return this;
  }

  /** @method expectContentItemsNumber(num, content)
   * Returns true, if the number of items in content's model is equal to the given number.
   */
  expectContentItemsNumber(num, content) {
    assert(content.model, `Content doesn't have model`);
    assert(content.model.items, `Content model doesn't have items (${num} expected}`);
    assert(content.model.items.length <= num, `Too many items (${content.model.items.length}), while only ${num} were expected.`);
    return content.model.items.length == num;
  }

  /** @method expectRenderSlot(particleName, slotName, options)
   * Adds a rendering expectation for the given particle and slot names, where options may contain:
   * times: number of time the rendering request will occur
   * contentTypes: the types appearing in the rendering content
   * isOptional: whether this expectation is optional (default: false)
   * hostedParticle: for transformation particles, the name of the hosted particle
   * verify: an additional optional handler that determines whether the incoming render request satisfies the expectation
   */
  expectRenderSlot(particleName, slotName, options) {
    let times = options.times || 1;
    for (let i = 0; i < times; ++i) {
      this._addRenderExpectation({
        particleName,
        slotName,
        contentTypes: options.contentTypes,
        isOptional: options.isOptional,
        hostedParticle: options.hostedParticle,
        verifyComplete: options.verify,
        ignoreUnexpected: options.ignoreUnexpected
      });
    }
    return this;
  }

  /** @method expectationsCompleted()
   * Returns promise to completion of all expectations.
   */
  expectationsCompleted() {
    if (this.expectQueue.length == 0 || this.expectQueue.every(e => e.isOptional)) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => this.onExpectationsComplete = resolve);
  }

  assertExpectationsCompleted() {
    if (this.expectQueue.length == 0 || this.expectQueue.every(e => e.isOptional)) {
      return true;
    }
    assert(false, `${this.debugMessagesToString()}\nremaining expectations:\n ${this.expectQueue.map(expect => `  ${expect.toString()}`).join('\n')}`);
  }

  /** @method sendEvent(particleName, slotName, event, data)
   * Sends an event to the given particle and slot.
   */
  sendEvent(particleName, slotName, event, data) {
    let particles = this.consumers.filter(s => s.consumeConn.particle.name == particleName).map(s => s.consumeConn.particle);
    assert(1 == particles.length, `Multiple particles with name ${particleName} - cannot send event.`);
    this.pec.sendEvent(particles[0], slotName, {handler: event, data});
  }

  _addRenderExpectation(expectation) {
    let current = this.expectQueue.find(e => {
      return e.particleName == expectation.particleName
          && e.slotName == expectation.slotName
          && e.hostedParticle == expectation.hostedParticle
          && e.isOptional == expectation.isOptional;
    });
    if (!current) {
      current = {type: 'render', particleName: expectation.particleName, slotName: expectation.slotName, hostedParticle: expectation.hostedParticle, isOptional: expectation.isOptional, ignoreUnexpected: expectation.ignoreUnexpected,
                 toString: () => `render:${expectation.isOptional ? '  optional' : ' '} ${expectation.particleName} ${expectation.slotName} ${expectation.hostedParticle} ${current.contentTypes}`};
      this.expectQueue.push(current);
    }
    if (expectation.verifyComplete) {
      assert(!current.verifyComplete);
      current.verifyComplete = expectation.verifyComplete;
    }
    current.contentTypes = (current.contentTypes || []).concat(expectation.contentTypes);
    return this;
  }

  _canIgnore(particleName, slotName, content) {
    // TODO: add support for ignoring specific particles and/or slots.
    return this.expectQueue.find(e => e.type == 'render' && e.ignoreUnexpected);
  }

  _getHostedParticleNames(particle) {
    return Object.values(particle.connections)
        .filter(conn => conn.type.isInterface)
        .map(conn => this.arc.findStoreById(conn.handle.id)._stored.name);
  }

  _verifyRenderContent(particle, slotName, content) {
    let index = this.expectQueue.findIndex(e => {
      return e.type == 'render'
          && e.particleName == particle.name
          && e.slotName == slotName
          && (!e.hostedParticle ||
             ((names) => names.length == 1 && names[0] == e.hostedParticle)(this._getHostedParticleNames(particle)));
    });
    if (index < 0) {
      return false;
    }
    let expectation = this.expectQueue[index];

    let found = false;
    let complete = false;
    if (expectation.verifyComplete) {
      found = true;
      complete = expectation.verifyComplete(content);
    } else if (expectation.contentTypes) {
      Object.keys(content).forEach(contentType => {
        let contentIndex = expectation.contentTypes.indexOf(contentType);
        found |= contentIndex >= 0;
        if (contentIndex >= 0) {
          expectation.contentTypes.splice(contentIndex, 1);
        }
      });
      complete = expectation.contentTypes.length == 0;
    } else {
      assert(false, `Invalid expectation: ${JSON.stringify(expectation)}`);
    }

    if (complete) {
      this.expectQueue.splice(index, 1);
    }
    return found;
  }

  async renderSlot(particle, slotName, content) {
    this._addDebugMessages(`    renderSlot ${particle.name} ${((names) => names.length > 0 ? `(${names.join(',')}) ` : '')(this._getHostedParticleNames(particle))}: ${slotName} - ${Object.keys(content).join(', ')}`);
    assert.isAbove(this.expectQueue.length, 0,
      `Got a renderSlot from ${particle.name}:${slotName} (content types: ${Object.keys(content).join(', ')}), but not expecting anything further.`);

    // renderSlot must happen before _verifyRenderContent, because the latter removes this call from expectations,
    // and potentially making mock-slot-composer idle before the renderSlot has actualy complete.
    // TODO: split _verifyRenderContent to separate method for checking and then resolving expectations.
    await super.renderSlot(particle, slotName, content);

    let found = this._verifyRenderContent(particle, slotName, content);
    if (!found) {
      let canIgnore = this._canIgnore(particle.name, slotName, content);
      if (canIgnore) {
        console.log(`Skipping unexpected render slot request: ${particle.name}:${slotName} (content types: ${Object.keys(content).join(', ')})`);
      }
      assert(canIgnore, `Unexpected render slot ${slotName} for particle ${particle.name} (content types: ${Object.keys(content).join(',')})`);
    }

    this._expectationsMet();

    let slotConsumer = this.getSlotConsumer(particle, slotName);
    if (slotConsumer) {
      slotConsumer.updateProvidedContexts();
    } else {
      // Slots of particles hosted in transformation particles.
    }

    this.detailedLogDebug();
  }

  _expectationsMet() {
    if (this.expectQueue.length == 0 || this.expectQueue.every(e => e.isOptional)) {
      this.onExpectationsComplete();
    }
  }

  detailedLogDebug() {
    let expectationsByParticle = {};
    this.expectQueue.forEach(e => {
      if (!expectationsByParticle[e.particleName]) {
        expectationsByParticle[e.particleName] = {};
      }
      e.contentTypes && e.contentTypes.forEach(contentType => {
        let key = `${e.isOptional ? 'opt_' : ''}${contentType}`;
        if (!expectationsByParticle[e.particleName][key]) {
          expectationsByParticle[e.particleName][key] = 0;
        }
        expectationsByParticle[e.particleName][key]++;
      });
    });
    this._addDebugMessages(`${this.expectQueue.length} expectations : {${Object.keys(expectationsByParticle).map(p => {
      return `${p}: (${Object.keys(expectationsByParticle[p]).map(key => `${key}=${expectationsByParticle[p][key]}`).join('; ')})`;
    }).join(', ')}}`);
    return this;
  }

  _addDebugMessages(message) {
    assert(this.debugMessages.length > 0);
    this.debugMessages[this.debugMessages.length - 1].messages.push(message);
    if (this.logging) {
      console.log(message);
    }
  }
  debugMessagesToString() {
    let result = [];
    result.push('--------------------------------------------');
    this.debugMessages.forEach(debug => {
      result.push(`${debug.name} : `);
      debug.messages.forEach(message => result.push(message));
      result.push('----------------------');
    });
    return result.join('\n');
  }
}
