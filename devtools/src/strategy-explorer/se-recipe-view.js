/*
Copyright (c) 2017 Google Inc. All rights reserved.
This code may only be used under the BSD style license found at
http://polymer.github.io/LICENSE.txt
Code distributed by Google as part of this project is also
subject to an additional IP rights grant found at
http://polymer.github.io/PATENTS.txt
*/

import '../../deps/@polymer/polymer/polymer-legacy.js';
import '../arcs-shared.js';
import {Polymer} from '../../deps/@polymer/polymer/lib/legacy/polymer-fn.js';
import {html} from '../../deps/@polymer/polymer/lib/utils/html-tag.js';

Polymer({
  _template: html`
    <style include="shared-styles">
      :host {
        display: block;
      }

      .recipe-box {
        border: 1px solid var(--mid-gray);
        background-color: white;
        white-space: pre-wrap;
        font-family: consolas, 'Source Code Pro', monospace;
        font-size: 10px;
        padding: 5px;
      }

      .added {
        color: green;
      }

      .removed {
        color: red;
        text-decoration: line-through;
      }

      .unresolved {
        color: fuchsia;
      }

      .description {
        white-space: normal;
      }
    </style>
    <template is="dom-if" if="{{shownRecipe}}">
      <div class="recipe-box">{{strategyString}}<!--
     --><div hidden\$="[[isDescriptionEmpty(shownRecipe.description)]]" class="description">
          <span inner-h-t-m-l="{{shownRecipe.description}}"></span>
          <hr>
        </div>
        <span inner-h-t-m-l="{{shownRecipe.result}}"></span>
        <span class="hash" inner-h-t-m-l="{{shownRecipe.hash}}"></span><!--
   --></div>
    </template>
`,

  is: 'se-recipe-view',

  properties: {
    recipe: {observer: 'recipeChanged'},
    strategyString: String,
    shownRecipe: {
      type: Object,
      observer: 'shownRecipeChanged'
    },
  },

  isDescriptionEmpty(description) {
    return !description;
  },

  recipeChanged: function(recipe) {
    if (!this.pinned) {
      this.shownRecipe = (({result, strategy, id, parent, score, description, hash}) => ({result, strategy, id, parent, score, description, hash}))(this.recipe);
    } else {
      if (recipe.id == this.shownRecipe.id) {
        this.set('shownRecipe.result', this.pinnedResult);
        this.set('shownRecipe.hash', this.pinnedHash);
        this.strategyString = '';
        return;
      }
      let left = recipe.result.replace(/</g, '&lt;');
      let right = this.pinnedResult.replace(/</g, '&lt;');
      let diff = this.over.strategyMap.has(this.to)
          ? JsDiff.diffWords(right, left)
          : JsDiff.diffWords(left, right);
      diff = diff.map(entry => {
        if (entry.added)
          return `<span class='added'>${entry.value}</span>`;
        if (entry.removed)
          return `<span class='removed'>${entry.value}</span>`;
        return entry.value;
      });
      this.set('shownRecipe.result', diff.join(''));
      let strategies = this.to.strategyMap.get(this.over) || this.over.strategyMap.get(this.to);
      if (strategies)
        this.strategyString = 'Strategies: [' + strategies.join(']\n[') + ']\n';
      else
        this.strategyString = '';
      this.set('shownRecipe.hash', `<span class='added'>${this.pinnedHash}</span> <span class='removed'>${this.recipe.hash}</span>`);
    }
  },

  shownRecipeChanged: function(shownRecipe) {
    let parts = shownRecipe.result.split(/(?=(?:\/\/ unresolved |[\n\r]+))/g);
    parts = parts.map(entry => {
      if (entry.startsWith('// unresolved ')) {
        return `<span class='unresolved'>${entry}</span>`;
      }
      return entry;
    });
    this.set('shownRecipe.result', parts.join(''));
  },

  pin: function() {
    this.pinned = true;
    this.pinnedResult = this.recipe.result;
    this.pinnedHash = this.recipe.hash;
    this.to = this.over;
  },

  resetToPinned: function() {
    if (this.pinned) {
      this.over = this.to;
      this.recipe = this.over.recipe;
      this.shownRecipeChanged(this.shownRecipe);
    }
  },

  unpin: function() {
    this.pinned = false;
    this.shownRecipe = (({result, strategy, id, parent, score, description, hash}) => ({result, strategy, id, parent, score, description, hash}))(this.recipe);
    this.strategyString = '';
    this.to = undefined;
  }
});
