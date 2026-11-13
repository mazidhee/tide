# Machine Learning Roadmap

From linear models to deep networks, taught with the maths and the code together, with finance data as a running example.

## 1. Foundations — CORE

### The learning problem

- [ ] Supervised, unsupervised and reinforcement learning
- [ ] Loss functions and empirical risk
- [ ] Train, validation and test splits
- [ ] Bias, variance and overfitting
    - _An Introduction to Statistical Learning — James, Witten, Hastie, Tibshirani and Taylor_

### Linear models

- [ ] Linear regression by least squares
- [ ] Gradient descent
- [ ] Logistic regression and cross-entropy
- [ ] Regularisation: ridge and lasso
    - _An Introduction to Statistical Learning — James, Witten, Hastie, Tibshirani and Taylor_

### Practice

- [ ] Practice: Problem set, fit linear and logistic regressions from scratch in NumPy and check them against scikit-learn

## 2. Classical methods — CORE

### Trees and ensembles

- [ ] Decision trees
- [ ] Random forests and bagging
- [ ] Gradient boosting
    - _The Elements of Statistical Learning — Hastie, Tibshirani and Friedman_

### Evaluation

- [ ] Cross-validation, and time-series cross-validation
- [ ] Precision, recall, ROC and calibration
- [ ] Leakage, especially in financial data
    - _Advances in Financial Machine Learning — Marcos López de Prado_

### Unsupervised learning

- [ ] k-means and clustering
- [ ] Principal component analysis
    - _An Introduction to Statistical Learning — James, Witten, Hastie, Tibshirani and Taylor_

### Practice

- [ ] Practice: Problem set, build a card-fraud classifier with honest time-based validation

## 3. Deep learning — CORE

### Neural networks

- [ ] Perceptrons and multilayer networks
- [ ] Backpropagation
- [ ] Optimisers: SGD, momentum, Adam
- [ ] Initialisation, normalisation and dropout
    - _Dive into Deep Learning — Zhang, Lipton, Li and Smola_

### Architectures

- [ ] Convolutional networks
- [ ] Recurrent networks and sequence models
- [ ] Attention and transformers
    - _Dive into Deep Learning — Zhang, Lipton, Li and Smola_

### Practice

- [ ] Practice: Problem set, train a small network on the lab's data and explain its learning curves

## 4. ML in finance — SUPPORTING

### Applications

- [ ] Credit scoring and fairness
- [ ] Fraud and anomaly detection in payments
- [ ] Return prediction and why it is hard
    - _Advances in Financial Machine Learning — Marcos López de Prado_

**Capstone Projects**

- [ ] Project: A fraud-detection model for card payments, from features to a calibrated, monitored model, with a written evaluation
