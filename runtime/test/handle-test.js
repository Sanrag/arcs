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

import {Arc} from '../arc.js';
import {assert} from './chai-web.js';
import {SlotComposer} from '../slot-composer.js';
import {handleFor} from '../handle.js';
import {Shape} from '../shape.js';
import {Type} from '../type.js';
import {Manifest} from '../manifest.js';
import {Loader} from '../loader.js';
import {Schema} from '../schema.js';
import {StorageProviderFactory} from '../storage/storage-provider-factory.js';

let loader = new Loader();

const createSlotComposer = () => new SlotComposer({rootContainer: 'test', affordance: 'mock'});
const Bar = new Schema({names: ['Bar'], fields: {id: 'Number', value: 'Text'}}).entityClass();

describe('Handle', function() {

  it('clear singleton store', async () => {
    let slotComposer = createSlotComposer();
    let arc = new Arc({slotComposer, id: 'test'});
    let barStore = await arc.createStore(Bar.type);
    barStore.set(new Bar({value: 'a Bar'}));
    barStore.clear();
    assert.isNull(await barStore.get());
  });

  it('ignores duplicate stores of the same entity value (variable)', async () => {
    let slotComposer = createSlotComposer();
    let arc = new Arc({slotComposer, id: 'test'});
    let store = await arc.createStore(Bar.type);
    let version = 0;
    store.on('change', () => version++, {});
    assert.equal(version, 0);
    let bar1 = {id: 'an id', value: 'a Bar'};
    await store.set(bar1);
    assert.equal(version, 1);
    await store.set(bar1);
    assert.equal(version, 1);
    await store.set({value: 'a Bar'});
    assert.equal(version, 2);
  });

  it('ignores duplicate stores of the same entity value (collection)', async () => {
    let slotComposer = createSlotComposer();
    let arc = new Arc({slotComposer, id: 'test'});
    let barStore = await arc.createStore(Bar.type.collectionOf());
    let version = 0;
    barStore.on('change', ({add: [{effective}]}) => {if (effective) version++;}, {});
    assert.equal(barStore._version, 0);
    let bar1 = {id: 'an id', value: 'a Bar'};
    await barStore.store(bar1, ['key1']);
    assert.equal(version, 1);
    await barStore.store(bar1, ['key2']);
    assert.equal(version, 1);
    await barStore.store({value: 'a Bar'}, ['key3']);
    assert.equal(version, 2);
    await barStore.store(bar1, ['key4']);
    assert.equal(version, 2);
  });

  it('dedupes common user-provided ids', async () => {
    let slotComposer = createSlotComposer();
    let arc = new Arc({slotComposer, id: 'test'});

    let manifest = await Manifest.load('./runtime/test/artifacts/test-particles.manifest', loader);
    let Foo = manifest.schemas.Foo.entityClass();
    let fooHandle = handleFor(await arc.createStore(Foo.type.collectionOf()));
    fooHandle.entityClass = Foo;

    await fooHandle.store(new Foo({value: 'a Foo'}, 'first'));
    await fooHandle.store(new Foo({value: 'another Foo'}, 'second'));
    await fooHandle.store(new Foo({value: 'a Foo, again'}, 'first'));
    assert.lengthOf((await fooHandle.toList()), 2);
  });

  it('allows updates with same user-provided ids but different value (collection)', async () => {
    let slotComposer = createSlotComposer();
    let arc = new Arc({slotComposer, id: 'test'});

    let manifest = await Manifest.load('./runtime/test/artifacts/test-particles.manifest', loader);
    let Foo = manifest.schemas.Foo.entityClass();
    let fooHandle = handleFor(await arc.createStore(Foo.type.collectionOf()));
    fooHandle.entityClass = Foo;

    await fooHandle.store(new Foo({value: '1'}, 'id1'));
    await fooHandle.store(new Foo({value: '2'}, 'id1'));
    let stored = (await fooHandle.toList())[0];
    assert.equal(stored.value, '2');
  });

  it('allows updates with same user-provided ids but different value (variable)', async () => {
    let slotComposer = createSlotComposer();
    let arc = new Arc({slotComposer, id: 'test'});

    let manifest = await Manifest.load('./runtime/test/artifacts/test-particles.manifest', loader);
    let Foo = manifest.schemas.Foo.entityClass();
    let fooHandle = handleFor(await arc.createStore(Foo.type));
    fooHandle.entityClass = Foo;

    await fooHandle.set(new Foo({value: '1'}, 'id1'));
    await fooHandle.set(new Foo({value: '2'}, 'id1'));
    let stored = await fooHandle.get();
    assert.equal(stored.value, '2');
  });

  it('remove entry from store', async () => {
    let slotComposer = createSlotComposer();
    let arc = new Arc({slotComposer, id: 'test'});
    let barStore = await arc.createStore(Bar.type.collectionOf());
    let bar = new Bar({id: 0, value: 'a Bar'});
    barStore.store(bar, ['key1']);
    barStore.remove(bar.id);
    assert.isEmpty((await barStore.toList()));
  });

  it('can store a particle in a shape store', async () => {
    let slotComposer = createSlotComposer();
    let arc = new Arc({slotComposer, id: 'test'});
    let manifest = await Manifest.load('./runtime/test/artifacts/test-particles.manifest', loader);

    let shape = new Shape('Test', [{type: Type.newEntity(manifest.schemas.Foo)},
                           {type: Type.newEntity(manifest.schemas.Bar)}], []);
    assert(shape.particleMatches(manifest.particles[0]));

    let shapeStore = await arc.createStore(Type.newInterface(shape));
    shapeStore.set(manifest.particles[0]);
    assert.equal(await shapeStore.get(), manifest.particles[0]);
  });

  it('createHandle only allows valid tags & types in stores', async () => {
    let slotComposer = createSlotComposer();
    let arc = new Arc({slotComposer, id: 'test'});
    let manifest = await Manifest.load('./runtime/test/artifacts/test-particles.manifest', loader);

    let assert_throws_async = async (f, message) => {
      try {
        await f();
        assert.throws(() => undefined, message);
      } catch (e) {
        assert.throws(() => {throw e;}, message);
      }
    };

    await assert_throws_async(async () => await arc.createStore('not a type'), /isn't a Type/);

    await arc.createStore(Bar.type, 'name', 'id1', '#sufficient');
    await arc.createStore(Bar.type, 'name', 'id2', ['#valid']);
    await arc.createStore(Bar.type, 'name', 'id3', ['#valid', '#good']);
    ['#sufficient', '#valid', '#good'].forEach(tag =>
      assert([...arc._storeTags.values()].find(tags => tags.has(tag)),
        `tags ${arc._tags} should have included ${tag}`));
  });
  it('uses default storage keys', async () => {
    let manifest = await Manifest.parse(`
    schema Bar
      Text value
    `);
    let arc = new Arc({id: 'test', storageKey: 'firebase://test-firebase-45a3e.firebaseio.com/AIzaSyBLqThan3QCOICj0JZ-nEwk27H4gmnADP8/'});
    let resolver;
    let promise = new Promise((resolve, reject) => {resolver = resolve;});
    arc._storageProviderFactory = new class extends StorageProviderFactory {
      construct(id, type, keyFragment) {
        resolver(keyFragment);
        return {
          type,
          on() {},
        };
      }
    }(arc.id);
    await arc.createStore(manifest.schemas.Bar.type, 'foo', 'test1');
    let result = await promise;
    assert.equal(result, 'firebase://test-firebase-45a3e.firebaseio.com/AIzaSyBLqThan3QCOICj0JZ-nEwk27H4gmnADP8/handles/test1');
  });
});
