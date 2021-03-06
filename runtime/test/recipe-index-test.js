/**
 * @license
 * Copyright (c) 2018 Google Inc. All rights reserved.
 * This code may only be used under the BSD style license found at
 * http://polymer.github.io/LICENSE.txt
 * Code distributed by Google as part of this project is also
 * subject to an additional IP rights grant found at
 * http://polymer.github.io/PATENTS.txt
 */

import {RecipeIndex} from '../recipe-index.js';
import {Manifest} from '../manifest.js';
import {Arc} from '../arc.js';
import {assert} from './chai-web.js';
import {MockSlotComposer} from '../testing/mock-slot-composer.js';

describe('RecipeIndex', function() {
  async function createIndex(manifestContent) {
    let manifest = (await Manifest.parse(manifestContent));
    for (let recipe of manifest.recipes) {
      assert(recipe.normalize());
    }
    let arc = new Arc({
      id: 'test-plan-arc',
      context: manifest,
      slotComposer: new MockSlotComposer()
    });
    await arc.recipeIndex.ready;
    return arc.recipeIndex;
  }

  async function extractIndexRecipeStrings(manifestContent) {
    return (await createIndex(manifestContent)).recipes.map(r => r.toString());
  }

  it('adds use handles', async () => {
    assert.sameMembers(await extractIndexRecipeStrings(`
      schema Person
      schema Lumberjack

      particle Transform
        in Person person
        out Lumberjack lumberjack

      recipe
        Transform
    `), [
`recipe
  use as handle0 // ~
  use as handle1 // ~
  Transform as particle0
    lumberjack -> handle0
    person <- handle1`
    ]);
  });

  it('matches free handles to connections', async () => {
    assert.sameMembers(await extractIndexRecipeStrings(`
      schema Person

      particle A
        inout Person person

      recipe
        create as person
        A
    `), [
`recipe
  create as handle0 // Person {}
  A as particle0
    person = handle0`
    ]);
  });

  it('resolves local slots, but not a root slot', async () => {
    assert.sameMembers(await extractIndexRecipeStrings(`
      particle A
        consume root
          provide detail
      particle B
        consume detail

      recipe
        A
        B
    `), [
`recipe
  A as particle0
    consume root
      provide detail as slot0
  B as particle1
    consume detail as slot0`
    ]);
  });

  it('resolves constraints', async () => {
    assert.sameMembers(await extractIndexRecipeStrings(`
      schema A
      schema B
      schema C

      particle Transform
        in A a
        out B b
      particle TransformAgain
        in B b
        out C c

      recipe
        Transform.b -> TransformAgain.b
    `), [
`recipe
  use as handle0 // ~
  create as handle1 // B {}
  use as handle2 // ~
  Transform as particle0
    a <- handle0
    b -> handle1
  TransformAgain as particle1
    b <- handle1
    c -> handle2`
    ]);
  });

  it('does not resolve verbs', async () => {
    assert.sameMembers(await extractIndexRecipeStrings(`
      particle A &verb

      recipe
        &verb
    `), [
`recipe
  &verb`
    ]);
  });

  it('exposes multiple recipes', async () => {
    assert.sameMembers(await extractIndexRecipeStrings(`
      particle A
      particle B

      recipe
        A
      recipe
        B
      recipe
        &verb
    `), [
`recipe
  A as particle0`,
`recipe
  B as particle0`,
`recipe
  &verb`
    ]);
  });

  it('finds matching handles by fate', async () => {
    let index = await createIndex(`
      schema Thing

      particle A
        in Thing thing
      recipe A
        map as thing
        A
          thing = thing

      particle B
        out Thing thing
      recipe B
        create as thing
        B
          thing = thing

      particle C
        in Thing thing
      recipe C
        use as thing
        C
          thing = thing
    `);

    let recipe = index.recipes.find(r => r.name === 'C');
    let handle = recipe.handles[0];

    assert.deepEqual(['A'], index.findHandleMatch(handle, ['map']).map(h => h.recipe.name));
    assert.deepEqual(['B'], index.findHandleMatch(handle, ['create']).map(h => h.recipe.name));
  });

  it('finds matching handle by type', async () => {
    let index = await createIndex(`
      schema Thing
      schema OtherThing

      particle ConsumerThing
        in Thing thing
      particle ProducerThing
        out Thing thing
      particle ProducerOtherThing
        out OtherThing thing

      recipe Selector
        use as thing
        ConsumerThing

      recipe
        create as thing
        ProducerThing

      recipe
        create as otherThing
        ProducerOtherThing
    `);

    let recipe = index.recipes.find(r => r.name === 'Selector');
    let handle = recipe.handles[0];

    assert.deepEqual(
        ['ProducerThing'],
        index.findHandleMatch(handle).map(h => h.recipe.particles[0].name));
  });

  it('finds matching handles by tags', async () => {
    let index = await createIndex(`
      schema Thing

      particle Consumer
        in Thing thing
      particle Producer
        out Thing thing

      recipe TakeMe1
        create #loved as thing
        Producer

      recipe TakeMe2
        create #loved #adored as thing
        Producer

      recipe TakeMe3
        create #appreciated as thing
        Producer

      recipe IgnoreMe
        create #hated as thing
        Producer

      recipe Selector
        use #loved #appreciated as thing
        Consumer
    `);

    let recipe = index.recipes.find(r => r.name === 'Selector');
    let handle = recipe.handles[0];

    assert.deepEqual(
        ['TakeMe1', 'TakeMe2', 'TakeMe3'],
        index.findHandleMatch(handle).map(h => h.recipe.name));
  });

  it('finds tagged handles if selecting handle is not tagged', async () => {
    let index = await createIndex(`
      schema Thing

      particle Consumer
        in Thing thing
      particle Producer
        out Thing thing

      recipe TakeMe1
        create #loved as thing
        Producer

      recipe TakeMe2
        create #hated as thing
        Producer

      recipe Selector
        use as thing
        Consumer
    `);

    let recipe = index.recipes.find(r => r.name === 'Selector');
    let handle = recipe.handles[0];

    assert.deepEqual(
        ['TakeMe1', 'TakeMe2'],
        index.findHandleMatch(handle).map(h => h.recipe.name));
  });

  it('matching use/create handle pairs require communication', async () => {
    let index = await createIndex(`
      schema Thing

      particle Consumer1
        in Thing thing
      particle Consumer2
        in Thing thing
      particle Producer
        out Thing thing
      particle ProducerConsumer
        inout Thing thing

      recipe Selector
        use as thing
        Consumer1

      recipe
        create as thing
        Consumer2

      recipe
        create as thing
        Producer

      recipe
        create as thing
        ProducerConsumer
    `);

    let recipe = index.recipes.find(r => r.name === 'Selector');
    let handle = recipe.handles[0];

    assert.deepEqual(
        ['Producer', 'ProducerConsumer'],
        index.findHandleMatch(handle).map(h => h.recipe.particles[0].name));
  });

  it('matching use/copy handle pairs do not require communication', async () => {
    let index = await createIndex(`
      schema Thing

      particle Consumer1
        in Thing thing
      particle Consumer2
        in Thing thing
      particle Producer
        out Thing thing
      particle ProducerConsumer
        inout Thing thing

      recipe Selector
        use as thing
        Consumer1

      recipe
        copy as thing
        Consumer2

      recipe
        copy as thing
        Producer

      recipe
        copy as thing
        ProducerConsumer
    `);

    let recipe = index.recipes.find(r => r.name === 'Selector');
    let handle = recipe.handles[0];

    assert.deepEqual(
        ['Consumer2', 'Producer', 'ProducerConsumer'],
        index.findHandleMatch(handle).map(h => h.recipe.particles[0].name));
  });
});
