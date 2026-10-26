import { LitElement, css, html, nothing } from 'lit';
import { fromFormData, toFormData } from './editor-data';
import type { FormData } from './editor-data';
import { DESKTOP_PRESETS, FRAME_PRESETS } from './scene/materials';
import type { HomeAssistant, StandingDeskCardConfig } from './types';

const options = (entries: [string, string][]) => entries.map(([value, label]) => ({ value, label }));
const select = (entries: [string, string][]) => ({ select: { mode: 'dropdown', options: options(entries) } });
const inches = (min: number, max: number, step: number) => ({
  number: { min, max, step, mode: 'box', unit_of_measurement: 'in' },
});

function schema(data: FormData) {
  const desktopStyles: [string, string][] = [
    ...Object.entries(DESKTOP_PRESETS).map(([key, preset]): [string, string] => [key, preset.label]),
    ['custom', 'Custom color'],
  ];
  const frameStyles: [string, string][] = [
    ...Object.entries(FRAME_PRESETS).map(([key, preset]): [string, string] => [key, preset.label]),
    ['custom', 'Custom color'],
  ];
  return [
    { name: 'device', selector: { device: { filter: { integration: 'esphome' } } } },
    {
      type: 'grid',
      name: '',
      schema: [
        { name: 'name', selector: { text: {} } },
        { name: 'presets', selector: select([['2', '2'], ['3', '3'], ['4', '4']]) },
        { name: 'unit', selector: select([['auto', 'Automatic'], ['in', 'Inches'], ['cm', 'Centimeters']]) },
      ],
    },
    {
      type: 'expandable',
      name: '',
      flatten: true,
      title: 'Desktop',
      icon: 'mdi:desk',
      schema: [
        { name: 'desktop_style', selector: select(desktopStyles) },
        ...(data.desktop_style === 'custom'
          ? [
              {
                type: 'grid',
                name: '',
                schema: [
                  { name: 'desktop_rgb', selector: { color_rgb: {} } },
                  {
                    name: 'desktop_finish',
                    selector: select([['laminate', 'Matte laminate'], ['wood', 'Wood grain'], ['bamboo', 'Bamboo']]),
                  },
                ],
              },
            ]
          : []),
        {
          type: 'grid',
          name: '',
          schema: [
            { name: 'desktop_width', selector: inches(24, 100, 1) },
            { name: 'desktop_depth', selector: inches(18, 42, 1) },
            { name: 'desktop_thickness', selector: inches(0.5, 2.5, 0.05) },
          ],
        },
      ],
    },
    {
      type: 'expandable',
      name: '',
      flatten: true,
      title: 'Frame and keypad',
      icon: 'mdi:palette-outline',
      schema: [
        { name: 'frame_style', selector: select(frameStyles) },
        ...(data.frame_style === 'custom'
          ? [
              {
                type: 'grid',
                name: '',
                schema: [
                  { name: 'frame_rgb', selector: { color_rgb: {} } },
                  { name: 'frame_finish', selector: select([['powder', 'Powder coat'], ['metallic', 'Metallic']]) },
                ],
              },
            ]
          : []),
        {
          type: 'grid',
          name: '',
          schema: [
            { name: 'keypad_color', selector: select([['black', 'Black'], ['white', 'White'], ['gray', 'Gray']]) },
            { name: 'keypad_side', selector: select([['right', 'Right'], ['left', 'Left']]) },
          ],
        },
      ],
    },
    {
      type: 'expandable',
      name: '',
      flatten: true,
      title: 'Controls',
      icon: 'mdi:gesture-tap-button',
      schema: [
        { name: 'show_scale', selector: { boolean: {} } },
        { name: 'allow_preset_save', selector: { boolean: {} } },
        { name: 'show_idle', selector: { boolean: {} } },
        {
          name: 'hold_repeat_ms',
          selector: { number: { min: 150, max: 600, step: 50, mode: 'slider', unit_of_measurement: 'ms' } },
        },
      ],
    },
  ];
}

const LABELS: Record<string, string> = {
  device: 'DeskUp Pro controller',
  name: 'Title',
  presets: 'Memory presets',
  unit: 'Units',
  desktop_style: 'Desktop finish',
  desktop_rgb: 'Desktop color',
  desktop_finish: 'Surface',
  desktop_width: 'Width',
  desktop_depth: 'Depth',
  desktop_thickness: 'Thickness',
  frame_style: 'Frame color',
  frame_rgb: 'Custom frame color',
  frame_finish: 'Finish',
  keypad_color: 'Keypad',
  keypad_side: 'Keypad side',
  show_scale: 'Show the height scale (drag it to pick a height)',
  allow_preset_save: 'Allow saving presets with M',
  show_idle: "Show the controller's idle time",
  hold_repeat_ms: 'Nudge interval while ▲/▼ is held',
};

const HELPERS: Record<string, string> = {
  device: 'Leave empty to use the first DeskUp Pro found.',
  presets: 'How many memory buttons your desk controller supports.',
};

/** Makes sure ha-form is loaded; HA only loads it once some built-in editor needs it. */
async function loadHaForm(): Promise<void> {
  if (customElements.get('ha-form')) return;
  const loader = (window as unknown as { loadCardHelpers?: () => Promise<{ createCardElement(config: object): unknown }> })
    .loadCardHelpers;
  const helpers = await loader?.();
  const card = helpers?.createCardElement({ type: 'entities', entities: [] }) as
    | { constructor: { getConfigElement?: () => Promise<unknown> } }
    | undefined;
  await card?.constructor.getConfigElement?.();
}

export class StandingDeskCardEditor extends LitElement {
  static override properties = {
    hass: { attribute: false },
    _config: { state: true },
  };

  declare hass?: HomeAssistant;
  declare _config?: StandingDeskCardConfig;

  setConfig(config: StandingDeskCardConfig): void {
    this._config = config;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (!customElements.get('ha-form')) {
      void loadHaForm();
      void customElements.whenDefined('ha-form').then(() => this.requestUpdate());
    }
  }

  protected override render() {
    if (!this.hass || !this._config) return nothing;
    const data = toFormData(this._config);
    return html`<ha-form
      .hass=${this.hass}
      .data=${data}
      .schema=${schema(data)}
      .computeLabel=${(item: { name: string }) => LABELS[item.name] ?? item.name}
      .computeHelper=${(item: { name: string }) => HELPERS[item.name]}
      @value-changed=${this.onValueChanged}
    ></ha-form>`;
  }

  private onValueChanged(ev: CustomEvent<{ value: FormData }>): void {
    ev.stopPropagation();
    if (!this._config) return;
    const config = fromFormData(this._config, ev.detail.value);
    this._config = config;
    this.dispatchEvent(new CustomEvent('config-changed', { detail: { config }, bubbles: true, composed: true }));
  }

  static override styles = css`
    :host {
      display: block;
    }
  `;
}
