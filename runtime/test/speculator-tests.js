/**
 * @license
 * Copyright (c) 2017 Google Inc. All rights reserved.
 * This code may only be used under the BSD style license found at
 * http://polymer.github.io/LICENSE.txt
 * Code distributed by Google as part of this project is also
 * subject to an additional IP rights grant found at
 * http://polymer.github.io/PATENTS.txt
 */

import {Speculator} from '../speculator.js';
import {Arc} from '../arc.js';
import {assert} from './chai-web.js';
import {Loader} from '../loader.js';
import {Manifest} from '../manifest.js';

describe('speculator', function() {
  it('can speculatively produce a relevance', async () => {
    let loader = new Loader();
    let arc = new Arc({id: 'test'});
    let manifest = await Manifest.load('./runtime/test/artifacts/test.manifest', loader);
    let recipe = manifest.recipes[0];
    assert(recipe.normalize());
    let speculator = new Speculator();
    let relevance = await speculator.speculate(arc, recipe);
    assert.equal(relevance.calcRelevanceScore(), 1);
  });
});
