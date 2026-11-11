/**
 * What the tutor is told about live simulations (```sim blocks, drawn by
 * src/renderer/src/lib/sims). Kept short: it sits in the system prompt of every turn.
 */
export const SIM_GUIDE = `- For how machine learning works, show it running: a fenced code block with the language sim holding one JSON object. The app turns it into a live simulation the student can play, step and change; every number in it is computed. Kinds:
  - neural-net, a small network learning by backpropagation: {"kind":"neural-net","layers":[2,4,4,1],"data":"xor","activation":"tanh","rate":0.3}. data: xor, circle, two-moons, spiral, linear. activation: tanh, relu, sigmoid. Up to 3 hidden layers of up to 8 neurons. Add "mode":"forward" or "mode":"backward" to walk one sample through layer by layer, with each value or gradient. Spiral needs relu and [2,8,8,8,1].
  - attention, self-attention on a sentence: {"kind":"attention","tokens":["the","cat","sat"],"heads":2}. Up to 12 tokens, 1 to 4 heads, optional "temperature" and "causal":true. Its weights are seeded random numbers: use it for the mechanism, and never say the pattern means anything.
  - gradient-descent, a point going down a loss surface: {"kind":"gradient-descent","surface":"ravine","optimiser":"momentum","rate":0.05,"momentum":0.9}. surface: bowl, ravine, saddle, two-minima. optimiser: sgd, momentum, adam.
  - softmax, logits to probabilities: {"kind":"softmax","logits":[2,1,0.1],"labels":["cat","dog","bird"],"temperature":1}.
  Any kind takes "title" and an optional "tour" that points at parts as you explain: up to 12 steps like {"at":"loss","say":"one or two plain sentences","do":{"run":200}}. "do" is optional: {"run":n} advances n steps, {"pause":true}, {"sample":n}. Parts to point at: neural-net input, layer:1, neuron:1:2 (layer, neuron), edge:0:1:2 (from layer, from neuron, to neuron), output, surface, loss; attention token:3, row:3, scores, weights, mix; gradient-descent point, gradient, path, minimum; softmax logit:2, probabilities, temperature. Counting starts at 1; layer 0 is the input.
  One simulation per answer, valid JSON, and a sentence on what to watch or try. The student can select a part and ask about it; the question names the part and its current values, so answer about exactly that.`

/** The one line a lesson's teaching step needs; the full guide is already in the system prompt */
export const SIM_LESSON_LINE = 'For how a network learns, attention, gradient descent or softmax, use a live simulation (a sim block) rather than a diagram, with a short tour pointing at what to look at, then ask them to change one thing and predict what happens.'
