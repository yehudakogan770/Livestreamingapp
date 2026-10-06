import { describe, expect, it } from 'vitest';
import { NO_DECK, deckOffer, deckSummary, versionText, type DeckStatus } from './streamDeck';

const deck = (s: Partial<DeckStatus>): DeckStatus => ({ ...NO_DECK, bundled: '1.0.0.0', ...s });

describe('the Stream Deck offer', () => {
  it('says nothing to people without a Stream Deck', () => {
    expect(deckOffer(deck({ found: false, offer: false }))).toBeNull();
    // Even if the computer said "offer" without finding one.
    expect(deckOffer(deck({ found: false, offer: true }))).toBeNull();
  });

  it('offers to add the buttons when Stream Deck is found without them', () => {
    expect(deckOffer(deck({ found: true, offer: true }))).toEqual({ text: 'Stream Deck found. Add Lumora’s buttons?', add: 'Add' });
  });

  it('offers an update when Lumora carries newer buttons', () => {
    expect(deckOffer(deck({ found: true, offer: true, installed: '1.0.0.0', bundled: '1.1.0.0', update: true }))).toEqual({
      text: 'New Stream Deck buttons for Lumora are ready (1.1). Update them?',
      add: 'Update',
    });
  });

  it('asks only once per version (answered: not offered), and never with nothing to add', () => {
    expect(deckOffer(deck({ found: true, offer: false }))).toBeNull();
    expect(deckOffer(deck({ found: true, offer: true, bundled: null }))).toBeNull();
    expect(deckOffer(deck({ found: true, offer: true, installed: '1.0.0.0', update: false }))).toBeNull();
  });
});

describe('Settings → Stream Deck', () => {
  it('says what is there and what can be done', () => {
    expect(deckSummary(deck({ found: false }))).toEqual({ text: 'The Stream Deck app isn’t on this computer.', action: 'Install anyway' });
    expect(deckSummary(deck({ found: true })).action).toBe('Add the buttons');
    expect(deckSummary(deck({ found: true, installed: '1.0.0.0', bundled: '1.2.0.0', update: true }))).toEqual({
      text: 'Lumora’s buttons 1.0 are in Stream Deck; 1.2 is ready.',
      action: 'Update the buttons',
    });
    expect(deckSummary(deck({ found: true, installed: '1.0.0.0' }))).toEqual({
      text: 'Lumora’s buttons 1.0 are in Stream Deck and up to date.',
      action: 'Add them again',
    });
    expect(deckSummary(deck({ found: true, bundled: null })).action).toBeNull();
  });

  it('shows versions briefly', () => {
    expect(versionText('1.0.0.0')).toBe('1.0');
    expect(versionText('1.2.3.0')).toBe('1.2.3');
    expect(versionText('2.0.0.4')).toBe('2.0.0.4');
  });
});
