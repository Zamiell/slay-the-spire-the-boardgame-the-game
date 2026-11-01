import assert from 'node:assert/strict'

/** Sample rendered frames, without seeking or finishing the hover animations. */
export async function checkRewardSweep(page, choices) {
  await page.mouse.move(5, 5)
  await choices.evaluateAll(async nodes => {
    document.activeElement?.blur()
    await document.fonts.ready
    await Promise.all(nodes[0].closest('.reward-screen').getAnimations({ subtree: true })
      .map(animation => animation.finished))
  })
  const resting = await choices.evaluateAll(nodes => nodes.map(node => {
    const box = node.getBoundingClientRect()
    return { width: box.width, x: box.x + box.width / 2, y: box.y + box.height / 2 }
  }))
  let previous = -1
  for (const selected of [...resting.keys(), -1]) {
    const recording = choices.evaluateAll(async (nodes, resting) => {
      const start = performance.now()
      const frames = []
      do {
        await new Promise(requestAnimationFrame)
        frames.push(nodes.map((node, index) => node.getBoundingClientRect().width / resting[index].width))
      } while (performance.now() - start < 600)
      const durations = nodes.map(node => {
        const style = getComputedStyle(node)
        const properties = style.transitionProperty.split(',').map(value => value.trim())
        const times = style.transitionDuration.split(',').map(value =>
          Number.parseFloat(value) * (value.trim().endsWith('ms') ? .001 : 1))
        return Math.max(0, ...properties.flatMap((property, index) =>
          ['all', 'transform', 'scale'].includes(property) ? [times[index % times.length]] : []))
      })
      return { frames, durations }
    }, resting)
    const point = resting[selected] ?? { x: 5, y: 5 }
    await page.mouse.move(point.x, point.y)
    const { frames, durations } = await recording
    for (const index of [selected, previous].filter(index => index >= 0)) {
      const intermediate = frames.map(frame => frame[index]).filter(scale => scale > 1.005 && scale < 1.245)
      assert(durations[index] >= .1, `reward ${index} must retain a non-instant transform transition`)
      // Slow software WebKit can paint fewer than three frames during an ease-out.
      assert(intermediate.length > 0,
        `reward ${index} must visibly animate ${index === selected ? 'in' : 'out'}: ${JSON.stringify(frames)}`)
    }
    assert(frames.at(-1).every((scale, index) => Math.abs(scale - (index === selected ? 1.25 : 1)) < .01),
      'only the hovered reward should stay enlarged after sweeping across the choices')
    previous = selected
  }
}
