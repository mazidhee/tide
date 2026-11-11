/** Harness samples for "plot": [key for ?only=, heading, the sim block's JSON] */
export const samples: [string, string, string][] = [
  ['plot', 'plot: default', '{"kind":"plot"}'],
  [
    'plot-tour',
    'plot: a tour of a parabola and its tangent',
    JSON.stringify({
      kind: 'plot',
      title: 'The slope of a parabola',
      functions: ['a x^2 + b x + c', '2 a x + b'],
      params: { a: { value: 0.5, min: -2, max: 2, step: 0.1 }, b: 0, c: -2 },
      x: [-6, 6],
      y: [-6, 8],
      point: 1,
      tour: [
        { at: 'function:1', say: 'The first curve is a x² + b x + c. With a = 0.5 it opens upwards and its lowest point is at x = 0.' },
        { at: 'tangent', say: 'The straight line touches the curve at the point. At x = 2 its slope is 2, which is 2 a x + b.', do: { x: 2 } },
        { at: 'function:2', say: 'The second curve is that slope written as a function of x. Put the point on it: its height at x = 2 is the slope you just read.', do: { function: 2 } },
        { at: 'param:a', say: 'Make a negative and the parabola turns over; the slope line now falls instead of rising.', do: { set: { a: -0.5 }, function: 1, x: -2 } },
        { at: 'axes', say: 'Widen the window to see more of both.', do: { window: [-12, 12] } }
      ]
    })
  ],
  [
    'plot-edge',
    'plot: poles, a jump, a domain edge and an unreadable line',
    '{"kind":"plot","title":"Where curves break","functions":["tan(x)","abs(x)/x","sqrt(x - 2)","2 foo(x"],"x":[-6,6],"point":1}'
  ]
]
