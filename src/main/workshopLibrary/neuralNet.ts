import type { WorkshopProject } from '@shared/workshop'

const ENGINE_STARTER = String.raw`"""A scalar automatic-differentiation engine. Built over the first three stages; see STAGE-1.md."""


class Value:
    def __init__(self, data):
        # Stage 1: besides the number and its gradient, a Value needs to remember
        # which Values it was made from (children) and by which operation (op).
        self.data = data
        self.grad = 0.0

    def __add__(self, other):
        raise NotImplementedError("stage 1: Value + Value")

    def __mul__(self, other):
        raise NotImplementedError("stage 1: Value * Value")

    def backward(self):
        # Stage 2: fill in .grad on every Value this one was computed from.
        raise NotImplementedError("stage 2: backward()")

    # Stage 3 adds: negation, subtraction, ** with a number, division, tanh() and relu().

    def tanh(self):
        raise NotImplementedError("stage 3: tanh()")

    def relu(self):
        raise NotImplementedError("stage 3: relu()")
`

const NN_STARTER = String.raw`"""Neurons, layers and a multi-layer perceptron on top of engine.Value. Stages 4 to 6."""
import random

from engine import Value


class Neuron:
    def __init__(self, n_in, rng, activation=True):
        # rng is a random.Random; the brief says exactly which numbers to draw from it.
        raise NotImplementedError("stage 4: Neuron")

    def __call__(self, xs):
        raise NotImplementedError("stage 4: Neuron forward pass")

    def parameters(self):
        raise NotImplementedError("stage 4: Neuron.parameters()")


class Layer:
    def __init__(self, n_in, n_out, rng, activation=True):
        raise NotImplementedError("stage 4: Layer")

    def __call__(self, xs):
        raise NotImplementedError("stage 4: Layer forward pass")

    def parameters(self):
        raise NotImplementedError("stage 4: Layer.parameters()")


class MLP:
    def __init__(self, n_in, sizes, seed=0):
        raise NotImplementedError("stage 4: MLP")

    def __call__(self, xs):
        raise NotImplementedError("stage 4: MLP forward pass")

    def parameters(self):
        raise NotImplementedError("stage 4: MLP.parameters()")

    def zero_grad(self):
        raise NotImplementedError("stage 5: zero_grad()")


def mse(predictions, targets):
    raise NotImplementedError("stage 5: mse")


def sgd_step(model, lr):
    raise NotImplementedError("stage 5: sgd_step")


def train_step(model, xs, ys, lr):
    raise NotImplementedError("stage 5: train_step")


def fit(model, xs, ys, lr, steps):
    raise NotImplementedError("stage 6: fit")
`

const ENGINE_SOLUTION = String.raw`"""A scalar automatic-differentiation engine: every Value remembers how it was made."""
import math


class Value:
    def __init__(self, data, children=(), op=""):
        self.data = data
        self.grad = 0.0
        self.children = tuple(children)
        self.op = op
        self._backward = None

    def __repr__(self):
        return "Value(data=%r, grad=%r)" % (self.data, self.grad)

    # ----- the operations: each returns a new Value that knows its operands -----

    def __add__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        out = Value(self.data + other.data, (self, other), "+")

        def backward():
            self.grad += out.grad
            other.grad += out.grad

        out._backward = backward
        return out

    def __mul__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        out = Value(self.data * other.data, (self, other), "*")

        def backward():
            self.grad += other.data * out.grad
            other.grad += self.data * out.grad

        out._backward = backward
        return out

    def __pow__(self, k):
        if isinstance(k, bool) or not isinstance(k, (int, float)):
            raise TypeError("the exponent must be an int or a float, not %s" % type(k).__name__)
        out = Value(self.data ** k, (self,), "**")

        def backward():
            self.grad += k * self.data ** (k - 1) * out.grad

        out._backward = backward
        return out

    def tanh(self):
        t = math.tanh(self.data)
        out = Value(t, (self,), "tanh")

        def backward():
            self.grad += (1.0 - t * t) * out.grad

        out._backward = backward
        return out

    def relu(self):
        out = Value(self.data if self.data > 0 else 0.0, (self,), "relu")

        def backward():
            if self.data > 0:
                self.grad += out.grad

        out._backward = backward
        return out

    # ----- everything else is built from the operations above -----

    def __neg__(self):
        return self * -1

    def __sub__(self, other):
        return self + (-other)

    def __truediv__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        return self * other ** -1

    def __radd__(self, other):
        return self + other

    def __rmul__(self, other):
        return self * other

    def __rsub__(self, other):
        return Value(other) - self

    def __rtruediv__(self, other):
        return Value(other) / self

    # ----- reverse-mode differentiation -----

    def backward(self):
        """Set .grad on every Value this one depends on to d(self)/d(that value)."""
        # Topological order without recursion, so a graph thousands of operations deep is fine:
        # a node is appended only after everything it was made from.
        order = []
        seen = {id(self)}
        stack = [(self, iter(self.children))]
        while stack:
            node, rest = stack[-1]
            for child in rest:
                if id(child) not in seen:
                    seen.add(id(child))
                    stack.append((child, iter(child.children)))
                    break
            else:
                order.append(node)
                stack.pop()
        self.grad = 1.0
        for node in reversed(order):
            if node._backward is not None:
                node._backward()
`

const NN_SOLUTION = String.raw`"""Neurons, layers and a multi-layer perceptron on top of engine.Value, trained by gradient descent."""
import random

from engine import Value


class Neuron:
    def __init__(self, n_in, rng, activation=True):
        self.w = [Value(rng.uniform(-1, 1)) for _ in range(n_in)]
        self.b = Value(0.0)
        self.activation = activation

    def __call__(self, xs):
        total = self.b
        for w, x in zip(self.w, xs):
            total = total + w * x
        return total.tanh() if self.activation else total

    def parameters(self):
        return self.w + [self.b]


class Layer:
    def __init__(self, n_in, n_out, rng, activation=True):
        self.neurons = [Neuron(n_in, rng, activation) for _ in range(n_out)]

    def __call__(self, xs):
        return [neuron(xs) for neuron in self.neurons]

    def parameters(self):
        return [p for neuron in self.neurons for p in neuron.parameters()]


class MLP:
    def __init__(self, n_in, sizes, seed=0):
        rng = random.Random(seed)
        widths = [n_in] + list(sizes)
        last = len(sizes) - 1
        self.layers = [Layer(widths[i], widths[i + 1], rng, activation=i < last) for i in range(len(sizes))]

    def __call__(self, xs):
        for layer in self.layers:
            xs = layer(xs)
        return xs[0] if len(xs) == 1 else xs

    def parameters(self):
        return [p for layer in self.layers for p in layer.parameters()]

    def zero_grad(self):
        for p in self.parameters():
            p.grad = 0.0


def mse(predictions, targets):
    if len(predictions) != len(targets) or not predictions:
        raise ValueError("mse needs as many targets as predictions, and at least one")
    total = Value(0.0)
    for p, t in zip(predictions, targets):
        total = total + (p - t) ** 2
    return total / len(predictions)


def sgd_step(model, lr):
    for p in model.parameters():
        p.data -= lr * p.grad


def train_step(model, xs, ys, lr):
    model.zero_grad()
    loss = mse([model(x) for x in xs], ys)
    loss.backward()
    sgd_step(model, lr)
    return loss.data


def fit(model, xs, ys, lr, steps):
    return [train_step(model, xs, ys, lr) for _ in range(steps)]
`

const ENGINE_SETUP = String.raw`import math
import engine
from engine import Value
`

const GRAD_SETUP = String.raw`def _numgrad(f, xs, h=1e-6):
    out = []
    for i in range(len(xs)):
        up = list(xs); up[i] += h
        down = list(xs); down[i] -= h
        out.append((f(*[Value(v) for v in up]).data - f(*[Value(v) for v in down]).data) / (2 * h))
    return out

def _check(f, xs, what):
    vals = [Value(v) for v in xs]
    out = f(*vals)
    assert isinstance(out, Value), "%s should give a Value, got %s" % (what, type(out).__name__)
    out.backward()
    want = _numgrad(f, xs)
    for i in range(len(xs)):
        assert abs(vals[i].grad - want[i]) < 1e-4 * max(1.0, abs(want[i])), "%s at %r: the gradient for input %d should be about %.6f (finite differences), got %r" % (what, xs, i, want[i], vals[i].grad)
`

const NN_SETUP = String.raw`import random
import nn
from nn import Neuron, Layer, MLP

XOR_X = [[0.0, 0.0], [0.0, 1.0], [1.0, 0.0], [1.0, 1.0]]
XOR_Y = [0.0, 1.0, 1.0, 0.0]

def _datas(model):
    return [p.data for p in model.parameters()]

def _loss(model, xs, ys):
    return nn.mse([model(x) for x in xs], ys)
`

export const neuralNet: WorkshopProject = {
  id: 'neural-net',
  title: 'A tiny neural network from scratch',
  outcome: 'A scalar automatic-differentiation engine and a multi-layer perceptron built on it, in pure Python: every number remembers how it was computed, backward() fills in every gradient by the chain rule, and gradient descent on those gradients teaches a 17-parameter network XOR.',
  area: 'ml',
  prerequisites: ['Derivatives and the chain rule', 'Python classes and operator overloading', 'Graph traversal'],
  languages: ['python'],
  stages: [
    {
      id: 'value',
      title: 'Numbers that remember',
      goal: 'Make a Value whose + and * return new Values that record what they were made from.',
      brief: `In \`engine.py\`, finish the class \`Value\`. It wraps one number, and every operation on Values builds a new Value that remembers its operands. That record is the computation graph the next stage walks.

- \`Value(data)\` has \`.data\` (the number), \`.grad\` (starts at \`0.0\`), \`.children\` (an empty tuple) and \`.op\` (the empty string). How you pass children and op when an operation makes a Value is up to you; \`Value(data)\` on its own must keep working.
- \`a + b\` and \`a * b\` return a **new** \`Value\` holding the sum or product. Its \`.children\` is the tuple \`(a, b)\`: the very same objects, in that order (so \`a + a\` has children \`(a, a)\`). Its \`.op\` is \`"+"\` or \`"*"\`. The operands are not changed.
- A plain \`int\` or \`float\` may stand on either side: \`a + 2\`, \`2 + a\`, \`a * 3\`, \`3 * a\`. The number is wrapped in a \`Value\` and recorded as a child like any other.`,
      read: { concept: 'Computation graphs', source: 'Andrej Karpathy, “The spelled-out intro to neural networks and backpropagation: building micrograd” (video lecture), and the micrograd repository (micrograd/engine.py)' },
      files: [{ path: 'engine.py', content: ENGINE_STARTER }],
      setup: ENGINE_SETUP,
      tests: [
        {
          name: 'a new Value holds its number and has no history',
          code: String.raw`v = Value(3.0)
assert v.data == 3.0, "Value(3.0).data should be 3.0, got %r" % (v.data,)
assert v.grad == 0.0, "a new Value's grad should be 0.0, got %r" % (v.grad,)
assert hasattr(v, "children"), "a Value has no attribute called children"
assert v.children == (), "a Value made from a number has no children: expected (), got %r" % (v.children,)
assert getattr(v, "op", None) == "", "a Value made from a number should have op '', got %r" % (getattr(v, "op", None),)`
        },
        {
          name: 'adding gives a new Value holding the sum',
          code: String.raw`a, b = Value(2.0), Value(3.0)
c = a + b
assert isinstance(c, Value), "Value + Value should be a Value, got %s" % type(c).__name__
assert c.data == 5.0, "Value(2.0) + Value(3.0) should hold 5.0, got %r" % (c.data,)
assert c is not a and c is not b, "a + b returned one of its operands instead of a new Value"
assert (a.data, b.data) == (2.0, 3.0), "adding changed its operands: they now hold %r and %r" % (a.data, b.data)`
        },
        {
          name: 'multiplying gives a new Value holding the product',
          code: String.raw`a, b = Value(2.0), Value(-3.0)
c = a * b
assert isinstance(c, Value), "Value * Value should be a Value, got %s" % type(c).__name__
assert c.data == -6.0, "Value(2.0) * Value(-3.0) should hold -6.0, got %r" % (c.data,)
assert (a.data, b.data) == (2.0, -3.0), "multiplying changed its operands: they now hold %r and %r" % (a.data, b.data)`
        },
        {
          name: 'a result remembers its operands in order, and the operation',
          code: String.raw`a, b = Value(2.0), Value(3.0)
for c, op in [(a + b, "+"), (a * b, "*")]:
    assert isinstance(c.children, tuple), "children of a %s b should be a tuple, got %s" % (op, type(c.children).__name__)
    assert len(c.children) == 2, "a %s b should have 2 children, got %d" % (op, len(c.children))
    assert c.children[0] is a and c.children[1] is b, "the children of a %s b should be the objects a and b themselves, in that order; got %r" % (op, c.children)
    assert c.op == op, "the op of a %s b should be %r, got %r" % (op, op, c.op)`
        },
        {
          name: 'a plain number works on either side',
          code: String.raw`a = Value(4.0)
for what, make, want in [("a + 2", lambda: a + 2, 6.0), ("2 + a", lambda: 2 + a, 6.0), ("a * 3", lambda: a * 3, 12.0), ("3 * a", lambda: 3 * a, 12.0), ("a + 0.5", lambda: a + 0.5, 4.5)]:
    try:
        c = make()
    except TypeError as e:
        assert False, "%s with a = Value(4.0) raised TypeError: %s" % (what, e)
    assert isinstance(c, Value), "%s should be a Value, got %s" % (what, type(c).__name__)
    assert c.data == want, "%s with a = Value(4.0) should hold %r, got %r" % (what, want, c.data)
c = a + 2
assert len(c.children) == 2 and all(isinstance(k, Value) for k in c.children), "in a + 2 the number should be wrapped in a Value and recorded as a child; children are %r" % (c.children,)
assert c.children[0] is a and c.children[1].data == 2, "the children of a + 2 should be a and a Value holding 2, got %r" % (c.children,)`
        },
        {
          name: 'an expression builds a graph of Values',
          code: String.raw`a, b, c = Value(2.0), Value(-3.0), Value(10.0)
d = a * b + c
assert d.data == 4.0, "2 * -3 + 10 should hold 4.0, got %r" % (d.data,)
assert d.op == "+", "the last operation of a * b + c is the addition: expected op '+', got %r" % (d.op,)
prod = d.children[0]
assert d.children[1] is c, "the second child of (a * b) + c should be c itself, got %r" % (d.children[1],)
assert prod.op == "*" and prod.data == -6.0, "the first child of (a * b) + c should be the product (op '*', data -6.0); got op %r, data %r" % (prod.op, prod.data)
assert prod.children[0] is a and prod.children[1] is b, "the product inside a * b + c should have children (a, b), got %r" % (prod.children,)`
        },
        {
          name: 'a value used twice is recorded twice',
          code: String.raw`a = Value(3.0)
s, p = a + a, a * a
assert s.data == 6.0 and p.data == 9.0, "with a = 3.0, a + a should hold 6.0 and a * a 9.0; got %r and %r" % (s.data, p.data)
assert len(s.children) == 2 and s.children[0] is a and s.children[1] is a, "a + a should have children (a, a), got %r" % (s.children,)
assert len(p.children) == 2 and p.children[0] is a and p.children[1] is a, "a * a should have children (a, a), got %r" % (p.children,)`
        }
      ],
      hints: [
        'Python turns a + b into a method call on a. Look up which method, and which one it tries next when the left side is a plain number.',
        'Each operation should make its result through the same constructor a leaf uses, handing it the operands and a label as well. If the other operand is not a Value, wrap it first so both cases follow one path.',
        'Give __init__ two extra optional arguments, the children (default: empty tuple) and the op (default: empty string), and store them. In __add__ and __mul__: wrap the other operand if it is not a Value, compute the number, and return a new Value with (self, other) as children and the label. Define __radd__ and __rmul__ so that a number on the left works; both operations are commutative, so they can hand over to the methods you already have.'
      ],
      teaches: ['Computation graphs', 'Operator overloading'],
      recall: 'Why does a Value keep references to the Values it was made from, when the number it holds is already computed?'
    },
    {
      id: 'backward',
      title: 'Backpropagation',
      goal: 'Fill in the gradient of one Value with respect to every Value it depends on, by the chain rule.',
      brief: `Still in \`engine.py\`. Add \`Value.backward()\`.

After \`out.backward()\`, every Value \`v\` in the graph that \`out\` was computed from (including \`out\` itself, intermediate results and the leaves) has \`v.grad\` equal to the derivative of \`out\` with respect to \`v\`.

- \`out.grad\` itself becomes \`1.0\` (also when \`out\` is a leaf).
- Assume every \`.grad\` in the graph is \`0.0\` when \`backward()\` is called.
- A Value that reaches \`out\` along several paths gets the **sum** of the contributions of all of them: for \`a + a\` the gradient of \`a\` is 2, for \`a * a\` it is \`2 * a.data\`.
- It must work on a graph thousands of operations deep, such as a running total of 3,000 additions, without hitting Python's recursion limit.`,
      read: { concept: 'Backpropagation (reverse-mode automatic differentiation)', source: 'Andrej Karpathy, “The spelled-out intro to neural networks and backpropagation: building micrograd” (video lecture); Baydin et al., “Automatic Differentiation in Machine Learning: a Survey” (2018), section 3.2 on reverse mode' },
      files: [],
      tests: [
        {
          name: 'the output has gradient 1 and a sum passes it to both operands',
          code: String.raw`a, b = Value(2.0), Value(5.0)
c = a + b
c.backward()
assert c.grad == 1.0, "after c.backward(), c.grad should be 1.0, got %r" % (c.grad,)
assert (a.grad, b.grad) == (1.0, 1.0), "for c = a + b both gradients should be 1.0, got a.grad = %r and b.grad = %r" % (a.grad, b.grad)
leaf = Value(7.0)
leaf.backward()
assert leaf.grad == 1.0, "backward() on a leaf should set its own grad to 1.0, got %r" % (leaf.grad,)`
        },
        {
          name: 'a product gives each operand the other one’s value',
          code: String.raw`a, b = Value(2.0), Value(-3.0)
c = a * b
c.backward()
assert a.grad == -3.0, "for c = a * b with b = -3.0, a.grad should be -3.0, got %r" % (a.grad,)
assert b.grad == 2.0, "for c = a * b with a = 2.0, b.grad should be 2.0, got %r" % (b.grad,)`
        },
        {
          name: 'the chain rule carries through two levels',
          code: String.raw`a, b, c = Value(2.0), Value(-3.0), Value(10.0)
d = (a * b + c) * c
d.backward()
# d = a*b*c + c*c
assert a.grad == -30.0, "for d = (a*b + c) * c at a=2, b=-3, c=10, a.grad should be b*c = -30.0, got %r" % (a.grad,)
assert b.grad == 20.0, "for d = (a*b + c) * c at a=2, b=-3, c=10, b.grad should be a*c = 20.0, got %r" % (b.grad,)
assert c.grad == 14.0, "for d = (a*b + c) * c at a=2, b=-3, c=10, c.grad should be a*b + 2c = 14.0, got %r" % (c.grad,)`
        },
        {
          name: 'a value used twice in one operation gets both contributions',
          code: String.raw`a = Value(3.0)
s = a + a
s.backward()
assert a.grad == 2.0, "for s = a + a, a.grad should be 2.0, got %r" % (a.grad,)
b = Value(3.0)
p = b * b
p.backward()
assert b.grad == 6.0, "for p = b * b with b = 3.0, b.grad should be 6.0, got %r" % (b.grad,)`
        },
        {
          name: 'in a diamond-shaped graph each value is handled once, after everything that uses it',
          code: String.raw`a = Value(3.0)
b = a * 2
c = b + 1
d = b * 3
e = c * d
e.backward()
# e = (2a + 1) * 6a = 12a^2 + 6a
assert c.grad == 18.0 and d.grad == 7.0, "for e = c * d with c = 7 and d = 18, c.grad should be 18.0 and d.grad 7.0; got %r and %r" % (c.grad, d.grad)
assert b.grad == 39.0, "b feeds both c and d, so b.grad should be 18 + 3*7 = 39.0, got %r" % (b.grad,)
assert a.grad == 78.0, "e = 12a^2 + 6a, so at a = 3 a.grad should be 78.0, got %r" % (a.grad,)`
        },
        {
          name: 'gradients from every path are added together',
          code: String.raw`a = Value(3.0)
f = a * a * a + a
f.backward()
assert a.grad == 28.0, "f = a^3 + a, so at a = 3 a.grad should be 28.0, got %r" % (a.grad,)
x, y = Value(2.0), Value(5.0)
s = x * y
g = s + s * s + x
g.backward()
# g = xy + (xy)^2 + x
assert s.grad == 21.0, "g = s + s*s + x with s = 10: s.grad should be 1 + 2*10 = 21.0, got %r" % (s.grad,)
assert x.grad == 106.0, "g = xy + (xy)^2 + x at x=2, y=5: x.grad should be 5 + 100 + 1 = 106.0, got %r" % (x.grad,)
assert y.grad == 42.0, "g = xy + (xy)^2 + x at x=2, y=5: y.grad should be 2 + 40 = 42.0, got %r" % (y.grad,)`
        },
        {
          name: 'a chain of 3,000 additions does not run out of stack',
          code: String.raw`x = Value(1.5)
total = Value(0.0)
for _ in range(3000):
    total = total + x
try:
    total.backward()
except RecursionError:
    assert False, "backward() on a running total of 3,000 additions raised RecursionError; it should finish"
assert x.grad == 3000.0, "x was added 3,000 times, so x.grad should be 3000.0, got %r" % (x.grad,)`
        }
      ],
      hints: [
        'Each operation knows a local fact: how its result changes when one operand changes. The open question is the order in which the Values of the graph may be processed.',
        'A Value’s gradient is complete only when every Value that used it has already passed its share down. Process the graph so that each Value comes after all of its users (a topological order, reversed), handle each Value exactly once, and always add to an operand’s grad rather than assign to it.',
        'When an operation creates its result, also store on the result a small function that adds to each operand’s grad: the result’s grad times the local derivative (1 for each side of a sum; the other operand’s value for a product). In backward(): list every Value reachable through children so that each appears after its children, visiting each only once, using an explicit stack rather than recursion so depth is not a problem. Set this Value’s grad to 1.0, then go through the list from the end to the start calling each stored function.'
      ],
      teaches: ['Backpropagation', 'The chain rule', 'Topological ordering'],
      recall: 'Why must gradients be added to an operand’s grad rather than assigned, and why must a Value be processed only after everything that uses it?'
    },
    {
      id: 'operations',
      title: 'Enough operations for a neuron',
      goal: 'Add negation, subtraction, powers, division, tanh and relu, each with a correct gradient.',
      brief: `Still in \`engine.py\`. Each of these returns a new \`Value\` and takes part in \`backward()\` like \`+\` and \`*\` do. The tests compare your gradients with numerical ones, \`(f(x + h) - f(x - h)) / 2h\`.

- \`-a\`
- \`a - b\`, and with a number on either side: \`a - 2\`, \`2 - a\`
- \`a ** k\` where \`k\` is an \`int\` or a \`float\` (not a Value): \`a ** 2\`, \`a ** -1\`, \`a ** 0.5\`. A \`Value\` as the exponent raises \`TypeError\`.
- \`a / b\`, and with a number on either side: \`a / 2\`, \`1 / a\`
- \`a.tanh()\`: the hyperbolic tangent (\`math.tanh\`)
- \`a.relu()\`: \`a.data\` when it is positive, otherwise \`0.0\`; the gradient is passed on only when \`a.data\` is positive

Some of these can be written in terms of operations you already have, in which case their gradients come for free. What \`.op\` and \`.children\` hold for the new operations is not checked.`,
      read: { concept: 'Derivatives of elementary functions', source: 'Andrej Karpathy, the micrograd repository (micrograd/engine.py and its README)' },
      files: [],
      setup: GRAD_SETUP,
      tests: [
        {
          name: 'negation and subtraction give the right numbers',
          code: String.raw`a, b = Value(5.0), Value(3.0)
for what, make, want in [("-a", lambda: -a, -5.0), ("a - b", lambda: a - b, 2.0), ("b - a", lambda: b - a, -2.0), ("a - 2", lambda: a - 2, 3.0), ("2 - a", lambda: 2 - a, -3.0)]:
    try:
        got = make()
    except TypeError as e:
        assert False, "%s with a = Value(5.0), b = Value(3.0) raised TypeError: %s" % (what, e)
    assert isinstance(got, Value), "%s should be a Value, got %s" % (what, type(got).__name__)
    assert got.data == want, "%s with a = 5.0, b = 3.0 should hold %r, got %r" % (what, want, got.data)`
        },
        {
          name: 'negation and subtraction have the right gradients',
          code: String.raw`_check(lambda a: -a, [2.5], "-a")
_check(lambda a, b: a - b, [2.5, -1.0], "a - b")
_check(lambda a: 2 - a, [2.5], "2 - a")
_check(lambda a, b: (a - b) * (b - a) - a, [1.5, 4.0], "(a - b) * (b - a) - a")`
        },
        {
          name: 'powers with a number as the exponent',
          code: String.raw`a = Value(4.0)
for k, want in [(2, 16.0), (3, 64.0), (-1, 0.25), (0.5, 2.0)]:
    got = a ** k
    assert isinstance(got, Value), "a ** %r should be a Value, got %s" % (k, type(got).__name__)
    assert abs(got.data - want) < 1e-12, "Value(4.0) ** %r should hold %r, got %r" % (k, want, got.data)
_check(lambda a: a ** 2, [3.0], "a ** 2")
_check(lambda a: a ** 3, [-1.5], "a ** 3")
_check(lambda a: a ** -1, [4.0], "a ** -1")
_check(lambda a: a ** 0.5, [4.0], "a ** 0.5")`
        },
        {
          name: 'a Value as the exponent is refused',
          code: String.raw`a = Value(2.0)
try:
    ok = (a ** 3).data
except TypeError as e:
    assert False, "Value(2.0) ** 3 raised TypeError: %s" % e
assert ok == 8.0, "Value(2.0) ** 3 should hold 8.0, got %r" % (ok,)
try:
    got = a ** Value(3.0)
except TypeError:
    got = None
except Exception as e:
    assert False, "a ** Value(3.0) should raise TypeError, it raised %s" % type(e).__name__
assert got is None, "a ** Value(3.0) should raise TypeError, it returned %r" % (got,)`
        },
        {
          name: 'division, with a Value or a number on either side',
          code: String.raw`a, b = Value(6.0), Value(4.0)
for what, make, want in [("a / b", lambda: a / b, 1.5), ("a / 2", lambda: a / 2, 3.0), ("3 / a", lambda: 3 / a, 0.5)]:
    try:
        got = make()
    except TypeError as e:
        assert False, "%s with a = Value(6.0), b = Value(4.0) raised TypeError: %s" % (what, e)
    assert isinstance(got, Value), "%s should be a Value, got %s" % (what, type(got).__name__)
    assert abs(got.data - want) < 1e-12, "%s with a = 6.0, b = 4.0 should hold %r, got %r" % (what, want, got.data)
_check(lambda a, b: a / b, [6.0, 4.0], "a / b")
_check(lambda a: 3 / a, [-2.0], "3 / a")
_check(lambda a, b: a / (a + b), [1.5, 2.5], "a / (a + b)")`
        },
        {
          name: 'tanh squashes and has the right slope',
          code: String.raw`for x in [-2.0, -0.3, 0.0, 0.7, 3.0]:
    got = Value(x).tanh()
    assert isinstance(got, Value), "tanh() should give a Value, got %s" % type(got).__name__
    assert abs(got.data - math.tanh(x)) < 1e-12, "Value(%r).tanh() should hold %r, got %r" % (x, math.tanh(x), got.data)
    _check(lambda a: a.tanh(), [x], "a.tanh()")
z = Value(0.0)
z.tanh().backward()
assert abs(z.grad - 1.0) < 1e-12, "the slope of tanh at 0 is 1: expected grad 1.0, got %r" % (z.grad,)`
        },
        {
          name: 'relu passes positive values and their gradient, and blocks the rest',
          code: String.raw`for x, want, slope in [(3.0, 3.0, 1.0), (0.5, 0.5, 1.0), (-2.0, 0.0, 0.0), (0.0, 0.0, 0.0)]:
    a = Value(x)
    out = a.relu()
    assert isinstance(out, Value), "relu() should give a Value, got %s" % type(out).__name__
    assert out.data == want, "Value(%r).relu() should hold %r, got %r" % (x, want, out.data)
    (out * 4).backward()
    assert a.grad == 4.0 * slope, "for relu(a) * 4 at a = %r, a.grad should be %r, got %r" % (x, 4.0 * slope, a.grad)`
        },
        {
          name: 'a larger expression matches finite differences',
          code: String.raw`f = lambda a, b, c: ((a * b - c / a) ** 2 + (b - 1).tanh()) / (c + 3) + (a * c).relu() - a
for point in [[2.0, -1.5, 0.5], [0.7, 0.4, -1.2], [-1.3, 2.2, 1.9]]:
    _check(f, point, "((a*b - c/a)**2 + tanh(b - 1)) / (c + 3) + relu(a*c) - a")`
        }
      ],
      hints: [
        'Before writing six new gradient rules, ask which of these operations are already expressible with +, * and one new primitive.',
        'Subtraction is adding a negation, negation is multiplying by -1, and division is multiplying by a power of -1. That leaves three operations that need a local derivative of their own: the power, tanh and relu. A number on the left side goes through the reflected methods (__rsub__, __rtruediv__).',
        'Write __pow__ as a primitive: check the exponent is an int or float (TypeError otherwise), compute data ** k, and give the result a backward function adding k * data ** (k - 1) times the result’s grad. tanh: compute t = math.tanh(data); the local derivative is 1 - t squared. relu: the local derivative is 1 when data is positive and 0 otherwise. Then define __neg__, __sub__, __truediv__ through the existing operations, and __rsub__ and __rtruediv__ by wrapping the number and using the forward method.'
      ],
      teaches: ['Derivatives of elementary functions', 'Gradient checking with finite differences', 'Activation functions'],
      recall: 'How does comparing a gradient with (f(x + h) - f(x - h)) / 2h tell you whether your backward rule for an operation is right, and why is it not used for training itself?'
    },
    {
      id: 'mlp',
      title: 'Neurons, layers, a network',
      goal: 'Build Neuron, Layer and MLP from Values, initialised from a seed so that every run is the same.',
      brief: `A new file, \`nn.py\`, which imports \`Value\` from \`engine.py\`. Inputs (\`xs\`) are lists of numbers or Values.

**\`Neuron(n_in, rng, activation=True)\`**. \`rng\` is a \`random.Random\`. The neuron has \`n_in\` weights, each a \`Value(rng.uniform(-1, 1))\`, drawn in order, and a bias \`Value(0.0)\` (nothing is drawn for the bias).
- \`neuron(xs)\` returns one Value: the sum of weight × input plus the bias, passed through \`tanh\` when \`activation\` is true and left as it is otherwise.
- \`neuron.parameters()\` returns the list of its weights, in order, followed by its bias.

**\`Layer(n_in, n_out, rng, activation=True)\`** is \`n_out\` neurons of \`n_in\` inputs each, created one after another from the same \`rng\`.
- \`layer(xs)\` returns a list of \`n_out\` Values (a list even when \`n_out\` is 1).
- \`layer.parameters()\` is every neuron's parameters, neuron by neuron.

**\`MLP(n_in, sizes, seed=0)\`** makes one \`rng = random.Random(seed)\` and builds its layers from it in order: \`MLP(2, [4, 1])\` is a layer of 4 neurons with 2 inputs each, then a layer of 1 neuron with 4 inputs. Every layer uses tanh except the last, which is linear (\`activation=False\`).
- \`mlp(xs)\` feeds \`xs\` through the layers. It returns a single Value when the last layer has one neuron, otherwise the list of outputs.
- \`mlp.parameters()\` is every layer's parameters, layer by layer. \`MLP(2, [4, 1])\` has 17.

\`parameters()\` always returns the same Value objects the network computes with: changing one's \`.data\` changes the network, and after \`backward()\` on an output they hold the gradients.`,
      read: { concept: 'Multi-layer perceptrons', source: 'Andrej Karpathy, the micrograd repository (micrograd/nn.py); Goodfellow, Bengio and Courville, “Deep Learning”, ch. 6: “Deep Feedforward Networks”' },
      files: [{ path: 'nn.py', content: NN_STARTER }],
      setup: NN_SETUP,
      tests: [
        {
          name: 'a neuron draws its weights from the generator in order and starts its bias at zero',
          code: String.raw`n = Neuron(3, random.Random(7))
ref = random.Random(7)
want = [ref.uniform(-1, 1) for _ in range(3)] + [0.0]
ps = n.parameters()
assert isinstance(ps, list) and all(isinstance(p, Value) for p in ps), "parameters() should be a list of Values, got %r" % (ps,)
assert len(ps) == 4, "a neuron with 3 inputs has 3 weights and a bias: expected 4 parameters, got %d" % len(ps)
got = [p.data for p in ps]
assert got == want, "Neuron(3, random.Random(7)) should have weights then bias %r, got %r" % (want, got)`
        },
        {
          name: 'a neuron computes tanh of the weighted sum plus the bias',
          code: String.raw`n = Neuron(2, random.Random(1))
w0, w1, b = n.parameters()
w0.data, w1.data, b.data = 0.5, -1.0, 0.25
out = n([2.0, 3.0])
assert isinstance(out, Value), "neuron(xs) should be a Value, got %s" % type(out).__name__
want = math.tanh(0.5 * 2.0 - 1.0 * 3.0 + 0.25)
assert abs(out.data - want) < 1e-12, "weights 0.5 and -1.0, bias 0.25, inputs [2.0, 3.0]: expected tanh(-1.75) = %r, got %r" % (want, out.data)
lin = Neuron(2, random.Random(1), activation=False)
w0, w1, b = lin.parameters()
w0.data, w1.data, b.data = 0.5, -1.0, 0.25
got = lin([2.0, 3.0]).data
assert abs(got - (-1.75)) < 1e-12, "with activation=False the same neuron should give the plain sum -1.75, got %r" % (got,)`
        },
        {
          name: 'a layer gives one output per neuron and draws neuron by neuron',
          code: String.raw`layer = Layer(2, 3, random.Random(3))
ref = random.Random(3)
want = []
for _ in range(3):
    want += [ref.uniform(-1, 1), ref.uniform(-1, 1), 0.0]
got = [p.data for p in layer.parameters()]
assert len(got) == 9, "a layer of 3 neurons with 2 inputs has 9 parameters, got %d" % len(got)
assert got == want, "Layer(2, 3, random.Random(3)) should have parameters %r, got %r" % (want, got)
out = layer([1.0, -2.0])
assert isinstance(out, list) and len(out) == 3 and all(isinstance(o, Value) for o in out), "layer(xs) should be a list of 3 Values, got %r" % (out,)
for i in range(3):
    expect = math.tanh(want[3 * i] * 1.0 + want[3 * i + 1] * -2.0)
    assert abs(out[i].data - expect) < 1e-12, "output %d of the layer should be %r, got %r" % (i, expect, out[i].data)
one = Layer(2, 1, random.Random(3))([1.0, -2.0])
assert isinstance(one, list) and len(one) == 1, "a layer with one neuron still returns a list of one Value, got %r" % (one,)`
        },
        {
          name: 'an MLP has the right number of parameters, in layer order',
          code: String.raw`for n_in, sizes, count in [(2, [4, 1], 17), (3, [4, 4, 1], 41), (1, [1], 2), (2, [3, 2], 17)]:
    got = len(MLP(n_in, sizes).parameters())
    assert got == count, "MLP(%d, %r) should have %d parameters, got %d" % (n_in, sizes, count, got)
ref = random.Random(5)
u = [ref.uniform(-1, 1) for _ in range(6)]
want = [u[0], u[1], 0.0, u[2], u[3], 0.0, u[4], u[5], 0.0]
got = _datas(MLP(2, [2, 1], seed=5))
assert got == want, "MLP(2, [2, 1], seed=5) should have parameters %r, got %r" % (want, got)`
        },
        {
          name: 'the same seed gives the same network, another seed a different one',
          code: String.raw`a, b, c = _datas(MLP(2, [4, 1], seed=11)), _datas(MLP(2, [4, 1], seed=11)), _datas(MLP(2, [4, 1], seed=12))
assert a == b, "two networks made with seed=11 should have identical parameters; they differ: %r and %r" % (a[:3], b[:3])
assert a != c, "seed=11 and seed=12 gave the same parameters (%r...); the seed is not being used" % (a[:3],)
d, e = _datas(MLP(2, [4, 1])), _datas(MLP(2, [4, 1], seed=0))
assert d == e, "the default seed is 0: MLP(2, [4, 1]) starts %r but MLP(2, [4, 1], seed=0) starts %r" % (d[:3], e[:3])
import random as _r
_r.seed(123); f = _datas(MLP(2, [4, 1], seed=11))
assert f == a, "the network should depend only on its seed, not on the global random state; got %r, expected %r" % (f[:3], a[:3])`
        },
        {
          name: 'the forward pass matches the arithmetic done by hand',
          code: String.raw`m = MLP(2, [3, 1], seed=4)
ps = m.parameters()
for i, p in enumerate(ps):
    p.data = ((i * 37) % 11 - 5) / 7.0
P = [p.data for p in ps]
x = [0.6, -1.1]
h = [math.tanh(P[3 * i] * x[0] + P[3 * i + 1] * x[1] + P[3 * i + 2]) for i in range(3)]
want = P[9] * h[0] + P[10] * h[1] + P[11] * h[2] + P[12]
out = m(x)
assert isinstance(out, Value), "an MLP whose last layer has one neuron returns a single Value, got %s" % type(out).__name__
assert abs(out.data - want) < 1e-9, "MLP(2, [3, 1]) with known parameters on [0.6, -1.1]: expected %r, got %r" % (want, out.data)`
        },
        {
          name: 'the last layer is linear, and several outputs come back as a list',
          code: String.raw`m = MLP(2, [2, 2], seed=1)
for p in m.parameters():
    p.data = 2.0
out = m([1.0, 1.0])
assert isinstance(out, list) and len(out) == 2 and all(isinstance(o, Value) for o in out), "MLP(2, [2, 2]) should return a list of 2 Values, got %r" % (out,)
h = math.tanh(6.0)
want = 2.0 * h + 2.0 * h + 2.0
assert abs(out[0].data - want) < 1e-9 and abs(out[1].data - want) < 1e-9, "with every parameter 2.0 and input [1, 1], each output should be 4*tanh(6) + 2 = %r (no tanh on the last layer); got %r" % (want, [o.data for o in out])`
        },
        {
          name: 'backward on the output reaches every parameter',
          code: String.raw`m = MLP(2, [3, 1], seed=2)
for p in m.parameters():
    if p.data == 0.0:
        p.data = 0.3
x = [0.5, -1.0]
ps = m.parameters()
again = m.parameters()
assert len(ps) == len(again) and all(a is b for a, b in zip(ps, again)), "parameters() should return the same Value objects every time it is called"
m(x).backward()
got = [p.grad for p in ps]
h = 1e-6
for i, p in enumerate(ps):
    keep = p.data
    p.data = keep + h; up = m(x).data
    p.data = keep - h; down = m(x).data
    p.data = keep
    want = (up - down) / (2 * h)
    assert abs(got[i] - want) < 1e-5, "after backward on the output, parameter %d should have grad about %.6f (finite differences), got %r" % (i, want, got[i])`
        }
      ],
      hints: [
        'Everything here is composition: a neuron is a few Value operations, a layer is a list of neurons, a network is a list of layers. The care is in the order the random numbers are drawn.',
        'One random.Random must be shared by the whole network and passed down, so that the draws happen in exactly the stated order: layer by layer, neuron by neuron, weight by weight, nothing for a bias. parameters() must hand out the stored Values themselves, never fresh copies.',
        'Neuron: store a list of Values drawn from rng.uniform(-1, 1) and a bias Value(0.0); on a call, start from the bias, add weight * input for each pair, and apply tanh if activation is on. Layer: a list of neurons built in a loop from the same rng; a call returns the list of each neuron’s output. MLP: make random.Random(seed), form the widths [n_in] + sizes, and build one Layer per consecutive pair, with activation off only for the last. A call threads xs through the layers and unwraps a one-element result. Each parameters() concatenates the level below.'
      ],
      teaches: ['Multi-layer perceptrons', 'Weight initialisation', 'Reproducibility with seeded random numbers'],
      recall: 'Why does the last layer of this network have no tanh, and what would the network be unable to output if it had one?'
    },
    {
      id: 'sgd',
      title: 'A loss and one step downhill',
      goal: 'Measure the error with a mean squared loss and take one step of gradient descent, with clean gradients each time.',
      brief: `In \`nn.py\`, add:

- \`mse(predictions, targets)\`: the mean of \`(prediction - target) ** 2\` over the pairs, as a \`Value\` (so it can be differentiated). \`predictions\` is a list of Values; \`targets\` is a list of numbers of the same length.
- \`MLP.zero_grad()\`: sets \`.grad\` of every parameter to \`0.0\`. It changes no \`.data\`.
- \`sgd_step(model, lr)\`: for every parameter, \`data\` becomes \`data - lr * grad\`. It does not touch the gradients.
- \`train_step(model, xs, ys, lr)\`: one full step of gradient descent on the whole dataset. \`xs\` is a list of inputs and \`ys\` the list of targets. It computes the loss \`mse\` of the model's predictions for every input, obtains the gradient of that loss with respect to every parameter, updates the parameters with \`sgd_step\`, and returns the loss as a plain \`float\`: the loss measured **before** the update.

The update in \`train_step\` must use the gradient of this step's loss only, whatever the parameters' \`.grad\` held when it was called.`,
      read: { concept: 'Gradient descent', source: 'Goodfellow, Bengio and Courville, “Deep Learning”, section 4.3: “Gradient-Based Optimization”' },
      files: [],
      tests: [
        {
          name: 'mse is the mean of the squared differences',
          code: String.raw`loss = nn.mse([Value(1.0), Value(3.0)], [0.0, 1.0])
assert isinstance(loss, Value), "mse should return a Value so that it can be differentiated, got %s" % type(loss).__name__
assert abs(loss.data - 2.5) < 1e-12, "predictions 1.0 and 3.0 against targets 0.0 and 1.0: expected (1 + 4) / 2 = 2.5, got %r" % (loss.data,)
zero = nn.mse([Value(0.5), Value(-2.0), Value(7.0)], [0.5, -2.0, 7.0])
assert abs(zero.data) < 1e-12, "predictions equal to their targets should give a loss of 0.0, got %r" % (zero.data,)
one = nn.mse([Value(2.0)], [5.0])
assert abs(one.data - 9.0) < 1e-12, "one prediction 2.0 against target 5.0 should give 9.0, got %r" % (one.data,)`
        },
        {
          name: 'the loss carries gradients back to the predictions',
          code: String.raw`a, b = Value(1.0), Value(3.0)
nn.mse([a, b], [0.0, 1.0]).backward()
assert abs(a.grad - 1.0) < 1e-12, "d/da of ((a - 0)^2 + (b - 1)^2) / 2 at a = 1 is 1.0, got %r" % (a.grad,)
assert abs(b.grad - 2.0) < 1e-12, "d/db of ((a - 0)^2 + (b - 1)^2) / 2 at b = 3 is 2.0, got %r" % (b.grad,)`
        },
        {
          name: 'zero_grad clears every gradient and changes no weight',
          code: String.raw`m = MLP(2, [3, 1], seed=6)
before = _datas(m)
m([0.5, -1.0]).backward()
assert any(p.grad != 0.0 for p in m.parameters()), "after backward on the output at least one parameter should have a gradient; all are 0.0"
m.zero_grad()
left = [p.grad for p in m.parameters() if p.grad != 0.0]
assert not left, "after zero_grad() every parameter's grad should be 0.0; %d are not, e.g. %r" % (len(left), left[:1])
assert _datas(m) == before, "zero_grad() must not change any parameter's data"`
        },
        {
          name: 'sgd_step moves each parameter against its gradient',
          code: String.raw`m = MLP(2, [2, 1], seed=6)
ps = m.parameters()
for i, p in enumerate(ps):
    p.grad = float(i + 1) * (-1) ** i
before = _datas(m)
grads = [p.grad for p in ps]
nn.sgd_step(m, 0.1)
for i, p in enumerate(ps):
    want = before[i] - 0.1 * grads[i]
    assert abs(p.data - want) < 1e-12, "parameter %d had data %r and grad %r: after sgd_step(model, 0.1) data should be %r, got %r" % (i, before[i], grads[i], want, p.data)
assert [p.grad for p in ps] == grads, "sgd_step should leave the gradients as they were"`
        },
        {
          name: 'train_step returns the loss before the update, and the loss then falls',
          code: String.raw`m = MLP(2, [4, 1], seed=1)
before = _loss(m, XOR_X, XOR_Y).data
start = _datas(m)
got = nn.train_step(m, XOR_X, XOR_Y, 0.05)
assert isinstance(got, float), "train_step should return the loss as a float, got %s" % type(got).__name__
assert abs(got - before) < 1e-12, "train_step should return the loss before the update (%r), got %r" % (before, got)
assert _datas(m) != start, "train_step did not change any parameter"
after = _loss(m, XOR_X, XOR_Y).data
assert after < before, "one small step should lower the loss: it was %r and is now %r" % (before, after)`
        },
        {
          name: 'one train_step is exactly: clear, forward, backward, update',
          code: String.raw`m, twin = MLP(2, [4, 1], seed=3), MLP(2, [4, 1], seed=3)
nn.train_step(m, XOR_X, XOR_Y, 0.1)
for p in twin.parameters():
    p.grad = 0.0
_loss(twin, XOR_X, XOR_Y).backward()
for p in twin.parameters():
    p.data -= 0.1 * p.grad
got, want = _datas(m), _datas(twin)
worst = max(range(len(want)), key=lambda i: abs(got[i] - want[i]))
assert abs(got[worst] - want[worst]) < 1e-12, "after one train_step with lr 0.1, parameter %d should be %r (old value minus 0.1 times the gradient of the loss), got %r" % (worst, want[worst], got[worst])`
        },
        {
          name: 'gradients left over from before do not leak into a step',
          code: String.raw`m, twin = MLP(2, [4, 1], seed=3), MLP(2, [4, 1], seed=3)
for p in m.parameters():
    p.grad = 100.0
nn.train_step(m, XOR_X, XOR_Y, 0.1)
nn.train_step(twin, XOR_X, XOR_Y, 0.1)
got, want = _datas(m), _datas(twin)
worst = max(range(len(want)), key=lambda i: abs(got[i] - want[i]))
assert abs(got[worst] - want[worst]) < 1e-12, "a model whose parameters held grad 100.0 before train_step ended up different from a clean one: parameter %d is %r, expected %r" % (worst, got[worst], want[worst])`
        },
        {
          name: 'the second step uses only the second step’s gradient',
          code: String.raw`m, twin = MLP(2, [4, 1], seed=8), MLP(2, [4, 1], seed=8)
nn.train_step(m, XOR_X, XOR_Y, 0.1)
second = nn.train_step(m, XOR_X, XOR_Y, 0.1)
for _ in range(2):
    for p in twin.parameters():
        p.grad = 0.0
    loss = _loss(twin, XOR_X, XOR_Y)
    loss.backward()
    for p in twin.parameters():
        p.data -= 0.1 * p.grad
assert abs(second - loss.data) < 1e-12, "the second train_step should return the loss after the first update, %r; got %r" % (loss.data, second)
got, want = _datas(m), _datas(twin)
worst = max(range(len(want)), key=lambda i: abs(got[i] - want[i]))
assert abs(got[worst] - want[worst]) < 1e-12, "after two train_steps parameter %d should be %r, got %r (were the first step's gradients still there during the second?)" % (worst, want[worst], got[worst])`
        }
      ],
      hints: [
        'backward() adds to .grad; it never resets it. Think about what a parameter’s grad holds at the start of the second step.',
        'The loss is one Value built from every prediction, so one backward() on it gives every parameter its gradient. Because backward accumulates, the gradients must be cleared before each backward, or each step would move by the sum of all gradients so far.',
        'mse: add up (prediction - target) ** 2 over the pairs as Values and divide by the count. zero_grad: loop over parameters() setting grad to 0.0. sgd_step: loop over parameters() subtracting lr times grad from data. train_step: clear the gradients, run the model on every input, form the loss, call backward on it, take the SGD step, and return the loss’s data.'
      ],
      teaches: ['Mean squared error', 'Stochastic gradient descent', 'Gradient accumulation'],
      recall: 'What goes wrong, step by step, if the gradients are not set to zero before each backward pass?'
    },
    {
      id: 'train',
      title: 'Teach it XOR',
      goal: 'Repeat the training step until a network that started from random weights computes XOR.',
      brief: `In \`nn.py\`, add \`fit(model, xs, ys, lr, steps)\`: it runs \`train_step\` \`steps\` times on the same data and returns the list of the \`steps\` losses, in order (so the first is the loss of the untrained model, and \`steps=0\` returns \`[]\` and changes nothing).

XOR cannot be computed by a single linear neuron; a hidden layer is needed. The tests train exactly this:

\`\`\`
xs = [[0, 0], [0, 1], [1, 0], [1, 1]]      ys = [0, 1, 1, 0]
model = MLP(2, [4, 1], seed=1)
losses = fit(model, xs, ys, lr=0.2, steps=300)
\`\`\`

and expect the last loss to be below \`0.01\` and every prediction to be within \`0.2\` of its target. With the initialisation of stage 4 this is reached with a wide margin, so if it is not, something earlier is subtly off. A single linear neuron, \`MLP(1, [1], seed=3)\`, must also fit the line \`y = 2x - 1\` in 200 steps at \`lr=0.1\`.`,
      read: { concept: 'Training a neural network', source: 'Goodfellow, Bengio and Courville, “Deep Learning”, section 6.1: “Example: Learning XOR”' },
      files: [],
      tests: [
        {
          name: 'fit returns one loss per step, starting with the untrained loss',
          code: String.raw`m, twin = MLP(2, [4, 1], seed=1), MLP(2, [4, 1], seed=1)
losses = nn.fit(m, XOR_X, XOR_Y, 0.2, 5)
assert isinstance(losses, list) and len(losses) == 5, "fit(..., steps=5) should return a list of 5 losses, got %r" % (losses,)
assert all(isinstance(l, float) for l in losses), "every loss should be a float, got %r" % ([type(l).__name__ for l in losses],)
first = _loss(twin, XOR_X, XOR_Y).data
assert abs(losses[0] - first) < 1e-12, "the first loss should be that of the untrained model, %r; got %r" % (first, losses[0])`
        },
        {
          name: 'no steps means no change',
          code: String.raw`m = MLP(2, [4, 1], seed=1)
before = _datas(m)
got = nn.fit(m, XOR_X, XOR_Y, 0.2, 0)
assert got == [], "fit(..., steps=0) should return [], got %r" % (got,)
assert _datas(m) == before, "fit(..., steps=0) should not change any parameter"`
        },
        {
          name: 'fit is the same as calling train_step that many times',
          code: String.raw`m, twin = MLP(2, [3, 1], seed=9), MLP(2, [3, 1], seed=9)
losses = nn.fit(m, XOR_X, XOR_Y, 0.1, 12)
want = [nn.train_step(twin, XOR_X, XOR_Y, 0.1) for _ in range(12)]
assert losses == want, "fit for 12 steps should give the same losses as 12 train_steps; first difference at step %d" % next((i for i in range(min(len(losses), 12)) if losses[i] != want[i]), min(len(losses), 12))
assert _datas(m) == _datas(twin), "fit for 12 steps should leave the same parameters as 12 train_steps"`
        },
        {
          name: 'the loss on XOR falls below 0.01 within 300 steps',
          code: String.raw`m = MLP(2, [4, 1], seed=1)
losses = nn.fit(m, XOR_X, XOR_Y, 0.2, 300)
assert losses[-1] < 0.01, "MLP(2, [4, 1], seed=1) trained on XOR at lr 0.2: the loss after 300 steps should be below 0.01, got %r (it started at %r)" % (losses[-1], losses[0])
assert losses[-1] < losses[0] / 50, "the loss should have fallen a long way from %r; it ended at %r" % (losses[0], losses[-1])`
        },
        {
          name: 'the trained network answers XOR',
          code: String.raw`m = MLP(2, [4, 1], seed=1)
nn.fit(m, XOR_X, XOR_Y, 0.2, 300)
for x, y in zip(XOR_X, XOR_Y):
    got = m(x).data
    assert abs(got - y) < 0.2, "after training, the network on %r should be within 0.2 of %r, got %r" % (x, y, got)`
        },
        {
          name: 'training twice from the same seed gives the same losses',
          code: String.raw`a = nn.fit(MLP(2, [4, 1], seed=2), XOR_X, XOR_Y, 0.2, 40)
b = nn.fit(MLP(2, [4, 1], seed=2), XOR_X, XOR_Y, 0.2, 40)
assert a == b, "two runs from seed=2 should give identical losses; they first differ at step %d" % next((i for i in range(40) if a[i] != b[i]), -1)`
        },
        {
          name: 'a single linear neuron fits a line',
          code: String.raw`xs = [[-1.0], [0.0], [1.0], [2.0]]
ys = [2 * x[0] - 1 for x in xs]
m = MLP(1, [1], seed=3)
losses = nn.fit(m, xs, ys, 0.1, 200)
w, b = _datas(m)
assert losses[-1] < 1e-6, "fitting y = 2x - 1 with one linear neuron for 200 steps at lr 0.1: the loss should be below 1e-6, got %r" % (losses[-1],)
assert abs(w - 2.0) < 0.01 and abs(b + 1.0) < 0.01, "the neuron should have learnt weight 2 and bias -1, got weight %r and bias %r" % (w, b)`
        }
      ],
      hints: [
        'The loop itself is short. If the loss does not fall, the cause is in an earlier stage: look at whether each step starts from clean gradients and whether the returned loss is the one before the update.',
        'fit is train_step in a loop, collecting what each call returns. Nothing else should happen between steps: the same model, the same data, no re-initialisation.',
        'Make an empty list; repeat steps times: call train_step(model, xs, ys, lr) and append the float it returns; return the list. Then train MLP(2, [4, 1], seed=1) on the four XOR rows yourself and print every 25th loss to watch it fall.'
      ],
      teaches: ['Training loops', 'Non-linear separability (XOR)'],
      recall: 'Why can a network with a tanh hidden layer learn XOR when a single linear neuron cannot?'
    }
  ],
  solution: [
    { path: 'engine.py', content: ENGINE_SOLUTION },
    { path: 'nn.py', content: NN_SOLUTION }
  ]
}
