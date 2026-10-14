import test from 'node:test';
import assert from 'node:assert/strict';
import { AggressiveBubblesPrimitive } from '../src/components/aggressive-bubbles-primitive.ts';

test('every Spot/Perpetual bubble has a centered S/P label, including minimum-radius bubbles', () => {
  const points = [
    { id: 'small-spot', market: 'spot', side: 'buy', value: 1, time: 10, nativePrice: 100 },
    { id: 'small-perp', market: 'perpetual', side: 'sell', value: 1, time: 20, nativePrice: 200 },
    { id: 'large-spot', market: 'spot', side: 'sell', value: 1000000, time: 30, nativePrice: 300 },
    { id: 'large-perp', market: 'perpetual', side: 'buy', value: 1000000, time: 40, nativePrice: 400 },
  ];
  const labels = [];
  const outlines = [];
  const circles = [];
  const context = {
    save() {}, restore() {}, beginPath() {}, fill() {}, stroke() {},
    arc(x, y, radius) { circles.push({ x, y, radius }); },
    strokeText(label, x, y) { outlines.push({ label, x, y }); },
    fillText(label, x, y) {
      labels.push({ label, x, y, align: this.textAlign, baseline: this.textBaseline, font: this.font });
    },
  };
  const primitive = new AggressiveBubblesPrimitive({
    series: { priceToCoordinate: price => price / 2 },
    timeScale: { timeToCoordinate: time => time * 2 },
    points, enabled: true,
  });
  primitive.paneViews()[0].renderer().draw({
    useMediaCoordinateSpace: draw => draw({ context }),
  });
  assert.equal(labels.length, points.length);
  assert.equal(outlines.length, points.length);
  assert.equal(circles.filter(circle => circle.radius === 5).length, 2);
  for (const point of points) {
    const label = labels.find(label => label.x === point.time * 2);
    assert.equal(label.label, point.market === 'spot' ? 'S' : 'P');
    assert.equal(label.y, point.nativePrice / 2);
    assert.equal(label.align, 'center');
    assert.equal(label.baseline, 'middle');
    assert.match(label.font, /^600 (8|11)px monospace$/);
  }
});

test('disabled bubbles do not render labels', () => {
  const primitive = new AggressiveBubblesPrimitive({ points: [{ value: 1 }], enabled: false });
  primitive.paneViews()[0].renderer().draw({
    useMediaCoordinateSpace() { assert.fail('disabled renderer must not draw'); },
  });
});
