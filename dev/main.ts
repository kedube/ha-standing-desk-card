import '../src/standing-desk-card';
import type { StandingDeskCardConfig } from '../src/types';
import { MockDesk } from './mock-desk';

// Stand-in for Home Assistant's ha-card.
customElements.define(
  'ha-card',
  class extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' }).innerHTML = `<style>
        :host {
          display: block;
          background: var(--card-background-color);
          border-radius: 12px;
          border: 1px solid var(--divider-color);
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
          color: var(--primary-text-color);
        }
      </style><slot></slot>`;
    }
  },
);

type CardElement = HTMLElement & { setConfig(config: StandingDeskCardConfig): void; hass: unknown };

const desk = new MockDesk();
const cards = [...document.querySelectorAll<HTMLElement>('[data-card]')].map((slot) => {
  const card = document.createElement('standing-desk-card') as CardElement;
  slot.appendChild(card);
  return card;
});

const params = new URLSearchParams(location.search);
const form = document.querySelector<HTMLFormElement>('#controls')!;
for (const [key, value] of params) {
  const field = form.elements.namedItem(key) as HTMLInputElement | HTMLSelectElement | null;
  if (!field) continue;
  if (field instanceof HTMLInputElement && field.type === 'checkbox') field.checked = value === 'true';
  else field.value = value;
}

function readConfig(): StandingDeskCardConfig {
  const value = (name: string) => (form.elements.namedItem(name) as HTMLInputElement).value;
  const checked = (name: string) => (form.elements.namedItem(name) as HTMLInputElement).checked;
  const config: StandingDeskCardConfig = {
    type: 'custom:standing-desk-card',
    presets: Number(value('presets')),
    unit: value('unit') as StandingDeskCardConfig['unit'],
    desktop_color: value('desktop_color'),
    frame_color: value('frame_color'),
    keypad_color: value('keypad_color') as StandingDeskCardConfig['keypad_color'],
    keypad_side: value('keypad_side') as StandingDeskCardConfig['keypad_side'],
    desktop_width: Number(value('desktop_width')),
    show_idle: checked('show_idle'),
    show_scale: checked('show_scale'),
  };
  if (value('name')) config.name = value('name');
  return config;
}

function apply(): void {
  const config = readConfig();
  cards.forEach((card) => card.setConfig(config));
  const dark = (form.elements.namedItem('theme') as HTMLSelectElement).value === 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  desk.setDarkMode(dark);
  desk.setAvailable(!(form.elements.namedItem('offline') as HTMLInputElement).checked);
}

form.addEventListener('input', apply);
apply();
desk.subscribe((hass) => cards.forEach((card) => (card.hass = hass)));
desk.start();

if (params.has('height')) desk.jumpTo(Number(params.get('height')));

// Hooks for scripted screenshots and manual poking from the console.
Object.assign(window, { desk, cards });
