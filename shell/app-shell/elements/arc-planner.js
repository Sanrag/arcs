/*
@license
Copyright (c) 2016 The Polymer Project Authors. All rights reserved.
This code may only be used under the BSD style license found at http://polymer.github.io/LICENSE.txt
The complete set of authors may be found at http://polymer.github.io/AUTHORS.txt
The complete set of contributors may be found at http://polymer.github.io/CONTRIBUTORS.txt
Code distributed by Google as part of the polymer project is also
subject to an additional IP rights grant found at http://polymer.github.io/PATENTS.txt
*/

import Xen from '../../components/xen/xen.js';
import Arcs from '../lib/arcs.js';

const log = Xen.logFactory('ArcPlanner', '#104a91');
const error = Xen.logFactory('ArcPlanner', '#104a91', 'error');

// proposed:
// metaplans -> map of plans, generations
// metaplan -> map of plans, generations, plan
// suggestions -> filtered array of (simple-)plans
// suggestion -> (simple-)plan

class ArcPlanner extends Xen.Debug(Xen.Base, log) {
  static get observedAttributes() {
    return ['config', 'arc', 'suggestion', 'search'];
  }
  _getInitialState() {
    return {
      pendingPlans: [],
      invalid: 0
    };
  }
  _willReceiveProps(props, state, oldProps) {
    const changed = name => props[name] !== oldProps[name];
    const {arc, suggestion, search} = props;
    if (suggestion && changed('suggestion')) {
      state.pendingPlans.push(suggestion.plan);
    }
    if (arc) {
      let {planificator} = state;
      if (changed('arc')) {
        state.pendingPlans = [];
        if (planificator) {
          planificator.dispose();
          planificator = null;
        }
      }
      if (!planificator) {
        planificator = this._createPlanificator(arc);
        planificator.setSearch(search);
      } else if (changed('search')) {
        planificator.setSearch(search);
      }
      this._setState({planificator});
    }
  }
  _update({arc, suggestions, search, planificator}, {pendingPlans}) {
    if (arc && pendingPlans.length) {
      this._instantiatePlan(arc, pendingPlans.shift());
    }
  }
  _createPlanificator(arc) {
    const planificator = new Arcs.Planificator(arc);
    planificator.registerPlansChangedCallback(current => this._plansChanged(current, planificator.getLastActivatedPlan()));
    planificator.registerSuggestChangedCallback(suggestions => this._suggestionsChanged(suggestions));
    return planificator;
  }
  _plansChanged(metaplans, metaplan) {
    this._fire('metaplans', metaplans);
    this._fire('metaplan', metaplan);
  }
  _suggestionsChanged(suggestions) {
    this._fire('suggestions', suggestions);
  }
  async _instantiatePlan(arc, plan) {
    log('instantiating plan', plan);
    try {
      await arc.instantiate(plan);
    } catch (x) {
      error('plan instantiation failed', x);
    }
    // search term is used up
    this._fire('search', '');
    // need new suggestions
    this._fire('suggestions', null);
  }
}
customElements.define('arc-planner', ArcPlanner);
