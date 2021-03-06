const $_documentContainer = document.createElement('template');
$_documentContainer.setAttribute('style', 'display: none;');

$_documentContainer.innerHTML = `<dom-module id="se-shared-styles">
  <template>
    <style>
      #recipe-box {
        border: 1px solid black;
        box-sizing: border-box;
      }

      #recipe-box:not([valid]) {
        border: 1px solid fuchsia;
      }

      #recipe-box[active] {
        background-color: rgba(255, 255, 0, .2);
      }

      #recipe-box[selected] {
        border: 2px solid green;
        background: #afa;
      }

      #recipe-box[selectedAncestor] {
        border: 1px solid blue;
        background: #ccf;
      }

      #recipe-box[selectedParent] {
        border: 2px solid blue;
        background: #aaf;
      }

      #recipe-box[selectedDescendant] {
        border: 1px solid purple;
        background: #fcf;
      }

      #recipe-box[selectedChild] {
        border: 2px solid purple;
        background: #faf;
      }

      #recipe-box[terminal] {
        border-radius: 20px;
      }

      #recipe-box[irrelevant] {
        background: repeating-linear-gradient(45deg, white, white 5px, lightgrey 5px, lightgrey 10px);
      }

      #recipe-box:not([resolved]) {
        border-style: dashed;
      }

      #recipe-box[combined] {
        background-color: rgba(0, 0, 0, .2);
      }

      [diff='add'] {
        box-shadow: 0 0 2px 2px green;
      }

      [diff='remove'] {
        box-shadow: 0 0 2px 2px red;
      }
    </style>
  </template>

</dom-module>`;

document.head.appendChild($_documentContainer.content);
// Basic stats for the entire run.
export function summaryStats(results) {
  return results.map(r => r.record).reduce((acc, record) => {
    let result = {};
    for (let name of [
        'generatedDerivations',
        'duplicateDerivations',
        'duplicateSameParentDerivations',
        'invalidDerivations',
        'nullDerivations',
        'survivingDerivations',
        'resolvedDerivations',
    ]) {
      result[name] = (record[name] || 0) + (acc[name] || 0);
    }
    return result;
  }, {});
}

// Returning a one element array to get around inability to use
// function call followed by property access in the polymer template :(
export function summaryStatsForTemplate(results) {
  return [summaryStats(results)];
}

// Computes [{Header, [PerStrategyStats]}], where first element pertains
// to all generations summed up, following by one element per generation.
export function strategySummary(results) {
  let summaries = results.map(x => ({
    header: `Generation ${x.record.generation}`,
    strategies: perStrategyRecord(x)
  }));

  summaries = [{
    header: 'Strategy Summary',
    strategies: collapseStrategyMaps(summaries.map(summary => summary.strategies))
  }, ...summaries];

  for (let summary of summaries) {
    // Array for iterating over with a template.
    summary.strategies = Array.from(summary.strategies.values());
  }

  // Filter out empty generations, i.e. sometimes the last one.
  return summaries.filter(summary => summary.strategies.length > 0);
}

// Returns a Map(Strategy -> Stats)
function perStrategyRecord(generation) {
  let result = new Map();
  for (let [field, perStrategyField] of [
    ['generatedDerivations', 'generatedDerivationsByStrategy'],
    ['duplicateDerivations', 'duplicateDerivationsByStrategy'],
    ['duplicateSameParentDerivations', 'duplicateSameParentDerivationsByStrategy'],
    ['invalidDerivations', 'invalidDerivationsByStrategy'],
    ['nullDerivations', 'nullDerivationsByStrategy'],
    ['resolvedDerivations', 'resolvedDerivationsByStrategy'],
  ]) {
    for (let strategy of Object.getOwnPropertyNames(generation.record[perStrategyField])) {
      let value = generation.record[perStrategyField][strategy];
      if (value > 0) {
        let obj = {strategy};
        obj[field] = value;
        result.set(strategy, Object.assign(result.get(strategy) || {}, obj));
      }
    }
  }

  result.forEach(r => {
    r.survivingDerivations = r.generatedDerivations
        - (r.duplicateDerivations || 0)
        - (r.invalidDerivations || 0)
        - (r.nullDerivations || 0)
        - (r.duplicateSameParentDerivations || 0);
  });

  return result;
}

// Collapses a [Map(Strategy -> Stats)] into a single Map(Strategy -> Stats).
function collapseStrategyMaps(strategyMaps) {
  let result = new Map();
  for (let map of strategyMaps) {
    map.forEach((props, strategy) => {
      let prevProps = result.get(strategy) || {};
      let newProps = {strategy};
      for (let name of [
          'generatedDerivations',
          'duplicateDerivations',
          'duplicateSameParentDerivations',
          'invalidDerivations',
          'nullDerivations',
          'survivingDerivations',
          'resolvedDerivations',
      ]) {
        newProps[name] = (props[name] || 0) + (prevProps[name] || 0);
      }
      result.set(strategy, newProps);
    });
  }
  return result;
}
