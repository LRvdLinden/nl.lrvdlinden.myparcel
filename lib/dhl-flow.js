'use strict';

/** Register DHL condition/action run listeners (and parcel autocompletes) in one place. */
function registerDhlFlowCards(homey, { conditions = {}, actions = {}, autocomplete = {} } = {}) {
  const register = (kind, id, fn) => {
    let card;
    try {
      card = kind === 'condition' ? homey.flow.getConditionCard(id) : homey.flow.getActionCard(id);
    } catch (error) {
      homey.error?.(`[DHL] Flow card ${id} missing:`, error.message);
      return;
    }
    card.registerRunListener(async args => {
      if (!args.device) throw new Error('No device selected.');
      return fn(args);
    });
    const arg = autocomplete[id];
    if (arg) card.registerArgumentAutocompleteListener(arg, async (query, args) => (args.device ? args.device.autocompleteParcels(query) : []));
  };
  for (const [id, fn] of Object.entries(conditions)) register('condition', id, fn);
  for (const [id, fn] of Object.entries(actions)) register('action', id, fn);
}

module.exports = { registerDhlFlowCards };
