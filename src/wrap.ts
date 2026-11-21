import { MAX_LAYERS, newLayer, WRAP_COLOURS, WRAP_KINDS, WRAP_PLACES, type WrapLayer } from './looks'

// The wrap painter's controls in the Looks tab: one card per layer with its
// shape, where it goes, its colour, and sliders for size, position and
// turn; a text box for text layers; and Add layer. Sliders preview as they
// move and save when let go; everything else saves at once.

const slider = (key: string, label: string, low: string, high: string, min: number, max: number, step: number, value: number, open: boolean) =>
  `<label class="tune"><span class="tune-name">${label}</span><span class="tune-ends"><i>${low}</i><input type="range" data-key="${key}" min="${min}" max="${max}" step="${step}" value="${value}" ${open ? '' : 'disabled'} aria-label="${label}" /><i>${high}</i></span></label>`

export function drawWrap(box: HTMLElement, wrap: WrapLayer[], open: boolean, preview: (wrap: WrapLayer[]) => void, save: (wrap: WrapLayer[]) => void) {
  const layers = wrap.map((l) => ({ ...l }))
  const off = open ? '' : 'disabled'
  box.innerHTML = `<span class="label">Wrap: up to ${MAX_LAYERS} layers of stripes, shapes and text, free to paint${open ? '' : ' once you own the car'}</span>${layers
    .map((l, i) => {
      const top = l.where === 'bonnet' || l.where === 'roof'
      return `<div class="wrap-layer" data-i="${i}">
        <div class="wrap-head"><b>Layer ${i + 1}</b>
          <select data-key="kind" ${off} aria-label="Shape">${WRAP_KINDS.map((k) => `<option value="${k.id}" ${k.id === l.kind ? 'selected' : ''}>${k.name}</option>`).join('')}</select>
          <select data-key="where" ${off} aria-label="Where">${WRAP_PLACES.map((k) => `<option value="${k.id}" ${k.id === l.where ? 'selected' : ''}>${k.name}</option>`).join('')}</select>
          <button class="ghost wrap-remove" ${off} aria-label="Remove layer ${i + 1}">Remove</button></div>
        <div class="look-row swatches wrap-colours">${WRAP_COLOURS.map((c) => `<button data-colour="${c}" class="${c === l.color ? 'on' : ''}" ${off} aria-label="Colour ${c}"><i style="background:${c}"></i></button>`).join('')}</div>
        ${l.kind === 'text' ? `<input class="wrap-text" data-key="text" maxlength="12" value="${l.text}" ${off} aria-label="Text" />` : ''}
        ${slider('size', 'Size', 'Small', 'Large', 0.2, 1.2, 0.05, l.size, open)}
        ${slider('along', 'Along the car', 'Front', 'Back', -1, 1, 0.05, l.along, open)}
        ${slider('up', top ? 'Across' : 'Height', top ? 'Right' : 'Low', top ? 'Left' : 'High', 0, 1, 0.05, l.up, open)}
        ${slider('angle', 'Turn', '−45°', '45°', -45, 45, 5, l.angle, open)}
      </div>`
    })
    .join('')}<button class="ghost wrap-add" ${open && layers.length < MAX_LAYERS ? '' : 'disabled'}>Add layer</button>`

  // Sliders and the text box redraw at most once a frame while they move.
  let pending = 0
  const soon = () => {
    if (pending) return
    pending = requestAnimationFrame(() => {
      pending = 0
      preview(layers)
    })
  }
  box.querySelectorAll<HTMLElement>('.wrap-layer').forEach((card) => {
    const layer = layers[Number(card.dataset.i)]
    card.querySelectorAll<HTMLInputElement>('input[type="range"]').forEach((input) => {
      const key = input.dataset.key as 'size' | 'along' | 'up' | 'angle'
      input.addEventListener('input', () => {
        layer[key] = Number(input.value)
        soon()
      })
      input.addEventListener('change', () => save(layers))
    })
    card.querySelector<HTMLInputElement>('.wrap-text')?.addEventListener('input', (e) => {
      layer.text = (e.target as HTMLInputElement).value
      soon()
    })
    card.querySelector<HTMLInputElement>('.wrap-text')?.addEventListener('change', () => save(layers))
    card.querySelectorAll<HTMLSelectElement>('select').forEach((select) =>
      select.addEventListener('change', () => {
        ;(layer as unknown as Record<string, string>)[select.dataset.key as string] = select.value
        save(layers)
      }),
    )
    card.querySelectorAll<HTMLButtonElement>('button[data-colour]').forEach((b) =>
      b.addEventListener('click', () => {
        layer.color = b.dataset.colour as string
        save(layers)
      }),
    )
    card.querySelector('.wrap-remove')?.addEventListener('click', () => save(layers.filter((l) => l !== layer)))
  })
  box.querySelector('.wrap-add')?.addEventListener('click', () => save([...layers, newLayer()]))
}
