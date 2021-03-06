/**
 * @license
 * Copyright (c) 2017 Google Inc. All rights reserved.
 * This code may only be used under the BSD style license found at
 * http://polymer.github.io/LICENSE.txt
 * Code distributed by Google as part of this project is also
 * subject to an additional IP rights grant found at
 * http://polymer.github.io/PATENTS.txt
 */

import {Arc} from '../arc.js';
import {assert} from './chai-web.js';
import {SlotComposer} from '../slot-composer.js';
import * as util from '../testing/test-util.js';
import {handleFor} from '../handle.js';
import {Manifest} from '../manifest.js';
import {Loader} from '../loader.js';
import {TestHelper} from '../testing/test-helper.js';
import {StubLoader} from '../testing/stub-loader.js';

let loader = new Loader();

async function setup() {
  let slotComposer = createSlotComposer();
  let arc = new Arc({slotComposer, loader, id: 'test'});
  let manifest = await Manifest.parse(`
    import 'runtime/test/artifacts/test-particles.manifest'
    recipe TestRecipe
      use as handle0
      use as handle1
      TestParticle
        foo <- handle0
        bar -> handle1
  `, {loader, fileName: process.cwd() + '/input.manifest'});
  return {
    arc,
    recipe: manifest.recipes[0],
    Foo: manifest.findSchemaByName('Foo').entityClass(),
    Bar: manifest.findSchemaByName('Bar').entityClass(),
  };
}
function createSlotComposer() { return new SlotComposer({rootContainer: {'root': 'test'}, affordance: 'mock'}); }

describe('Arc', function() {
  it('idle can safely be called multiple times', async () => {
    let slotComposer = createSlotComposer();
    const arc = new Arc({slotComposer, loader, id: 'test'});
    const f = async () => { await arc.idle; };
    await Promise.all([f(), f()]);
  });

  it('applies existing stores to a particle', async () => {
    let {arc, recipe, Foo, Bar} = await setup();
    let fooStore = await arc.createStore(Foo.type, undefined, 'test:1');
    let barStore = await arc.createStore(Bar.type, undefined, 'test:2');
    await handleFor(fooStore).set(new Foo({value: 'a Foo'}));
    recipe.handles[0].mapToStorage(fooStore);
    recipe.handles[1].mapToStorage(barStore);
    assert(recipe.normalize());
    await arc.instantiate(recipe);
    await util.assertSingletonWillChangeTo(arc, barStore, 'value', 'a Foo1');
  });

  it('applies new stores to a particle', async () => {
    let {arc, recipe, Foo, Bar} = await setup();
    let fooStore = await arc.createStore(Foo.type, undefined, 'test:1');
    let barStore = await arc.createStore(Bar.type, undefined, 'test:2');
    recipe.handles[0].mapToStorage(fooStore);
    recipe.handles[1].mapToStorage(barStore);
    recipe.normalize();
    await arc.instantiate(recipe);

    handleFor(fooStore).set(new Foo({value: 'a Foo'}));
    await util.assertSingletonWillChangeTo(arc, barStore, 'value', 'a Foo1');
  });

  it('deserializing a serialized empty arc produces an empty arc', async () => {
    let slotComposer = createSlotComposer();
    let arc = new Arc({slotComposer, loader, id: 'test'});
    let serialization = await arc.serialize();
    let newArc = await Arc.deserialize({serialization, loader, slotComposer});
    assert.equal(newArc._storesById.size, 0);
    assert.equal(newArc.activeRecipe.toString(), arc.activeRecipe.toString());
    assert.equal(newArc.id.toStringWithoutSessionForTesting(), 'test');
  });

  it('deserializing a simple serialized arc produces that arc', async () => {
    let {arc, recipe, Foo, Bar} = await setup();
    let fooStore = await arc.createStore(Foo.type, undefined, 'test:1');
    handleFor(fooStore).set(new Foo({value: 'a Foo'}));
    let barStore = await arc.createStore(Bar.type, undefined, 'test:2', ['tag1', 'tag2']);
    recipe.handles[0].mapToStorage(fooStore);
    recipe.handles[1].mapToStorage(barStore);
    recipe.normalize();
    await arc.instantiate(recipe);
    await util.assertSingletonWillChangeTo(arc, barStore, 'value', 'a Foo1');
    assert.equal(fooStore._version, 1);
    assert.equal(barStore._version, 1);

    let serialization = await arc.serialize();
    arc.stop();

    let slotComposer = createSlotComposer();
    let newArc = await Arc.deserialize({serialization, loader, slotComposer});
    fooStore = newArc.findStoreById(fooStore.id);
    barStore = newArc.findStoreById(barStore.id);
    assert.equal(fooStore._version, 1);
    assert.equal(barStore._version, 1);
    assert.lengthOf(newArc.findStoresByType(Bar.type, {tags: ['tag1']}), 1);
  });

  it('deserializing a serialized arc with a Transformation produces that arc', async () => {
    let manifest = await Manifest.parse(`
      import 'artifacts/Common/Multiplexer.manifest'
      import 'runtime/test/artifacts/test-particles.manifest'

      recipe
        slot 'rootslotid-slotid' as slot0
        use as handle0
        Multiplexer
          hostedParticle = ConsumerParticle
          consume annotation as slot0
          list <- handle0

    `, {loader, fileName: './manifest.manifest'});

    let recipe = manifest.recipes[0];

    let slotComposer = new SlotComposer({affordance: 'mock', rootContainer: {'slotid': 'dummy-container'}});

    let slotComposer_createHostedSlot = slotComposer.createHostedSlot;

    let slotsCreated = 0;

    slotComposer.createHostedSlot = (a, b, c, d) => {
      slotsCreated++;
      return slotComposer_createHostedSlot.apply(slotComposer, [a, b, c, d]);
    };

    let arc = new Arc({id: 'test', context: manifest, slotComposer});

    let barType = manifest.findTypeByName('Bar');
    let store = await arc.createStore(barType.collectionOf(), undefined, 'test:1');
    recipe.handles[0].mapToStorage(store);

    assert(recipe.normalize());
    assert(recipe.isResolved());

    await arc.instantiate(recipe);
    await arc.idle;

    let serialization = await arc.serialize();
    arc.stop();

    let newArc = await Arc.deserialize({serialization, loader, slotComposer, fileName: './manifest.manifest'});
    await newArc.idle;
    store = newArc._storesById.get(store.id);
    await store.store({id: 'a', rawData: {value: 'one'}}, ['somekey']);

    await newArc.idle;
    assert.equal(slotsCreated, 1);
  });
  it('copies store tags', async () => {
    let helper = await TestHelper.createAndPlan({
      manifestString: `
      schema Thing
        Text name
      particle P in 'p.js'
        inout Thing thing
      recipe
        copy 'mything' as thingHandle
        P
          thing = thingHandle
      resource ThingResource
        start
        [
          {"name": "mything"}
        ]
      store ThingStore of Thing 'mything' #best in ThingResource
      `,
      loader: new StubLoader({
        'p.js': `defineParticle(({Particle}) => class P extends Particle {
          async setHandles(handles) {
          }
        });`
      }),
      expectedNumPlans: 1
    });

    assert.isEmpty(helper.arc._storesById);
    assert.isEmpty(helper.arc._storeTags);

    await helper.acceptSuggestion({particles: ['P']});

    assert.equal(1, helper.arc._storesById.size);
    assert.equal(1, helper.arc._storeTags.size);
    assert.deepEqual(['best'], [...helper.arc._storeTags.get([...helper.arc._storesById.values()][0])]);
  });
});
