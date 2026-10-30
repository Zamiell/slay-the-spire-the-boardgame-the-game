const handCard = (page, card) => typeof card === 'string'
  ? page.locator(`.hand .card[title=${JSON.stringify(card)}]:visible`) : card

const pointFor = async (page, target) => {
  if (!target) return page.evaluate(() => ({ x: innerWidth * 0.45, y: innerHeight * 0.25 }))
  const box = await target.boundingBox()
  if (!box) throw new Error('Card play target is not visible')
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

export async function pickUpCard(page, card) {
  await handCard(page, card).click()
  await page.locator('.card-interaction:is([data-stage="dragging"], [data-stage="aiming"])').waitFor()
}

export async function confirmCardPlay(page, target) {
  const point = await pointFor(page, target)
  await page.mouse.click(point.x, point.y)
}

export async function dragCardTo(page, card, target) {
  const source = handCard(page, card)
  await source.scrollIntoViewIfNeeded()
  const box = await source.boundingBox()
  if (!box) throw new Error('Card to drag is not visible')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 4)
  await page.mouse.down()
  const point = await pointFor(page, target)
  await page.mouse.move(point.x, point.y, { steps: 5 })
  await page.mouse.up()
}
