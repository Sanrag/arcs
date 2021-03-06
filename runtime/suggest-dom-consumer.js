/**
 * @license
 * Copyright (c) 2018 Google Inc. All rights reserved.
 * This code may only be used under the BSD style license found at
 * http://polymer.github.io/LICENSE.txt
 * Code distributed by Google as part of this project is also
 * subject to an additional IP rights grant found at
 * http://polymer.github.io/PATENTS.txt
 */
'use strict';

import {assert} from '../platform/assert-web.js';
import {SlotDomConsumer} from './slot-dom-consumer.js';

export class SuggestDomConsumer extends SlotDomConsumer {
  constructor(containerKind, suggestion, suggestionContent, eventHandler) {
    super(/* consumeConn= */null, containerKind);
    this._suggestion = suggestion;
    this._suggestionContent = suggestionContent;
    this._eventHandler = eventHandler;
  }

  get suggestion() { return this._suggestion; }

  get templatePrefix() { return 'suggest'; }

  formatContent(content) {
    return {
      template: `<suggestion-element key="{{hash}}" on-click="">${content.template}</suggestion-element>`,
      templateName: 'suggestion',
      model: Object.assign({hash: this.suggestion.hash}, content.model)
    };
  }

  onContainerUpdate(container, originalContainer) {
    super.onContainerUpdate(container, originalContainer);

    if (container) {
      this.setContent(this._suggestionContent, this._eventHandler);
    }
  }

  static render(container, plan, content) {
    let consumer = new SlotDomConsumer();
    let suggestionContainer = Object.assign(document.createElement('suggestion-element'), {plan});
    // TODO(sjmiles): LIFO is weird, iterate top-down elsewhere?
    container.insertBefore(suggestionContainer, container.firstElementChild);
    let rendering = {container: suggestionContainer, model: content.model};
    consumer._renderingBySubId.set(undefined, rendering);
    consumer._eventHandler = (() => {});
    consumer._stampTemplate(rendering, consumer.createTemplateElement(content.template));
    consumer._onUpdate(rendering);
    return consumer;
  }
}
