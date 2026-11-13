# ML Engineering Roadmap

Getting models into production and keeping them right: pipelines and experiment tracking, data and features, serving, monitoring, and the platforms that run it all. Builds on the Machine Learning roadmap.

## 1. From notebook to pipeline — CORE

Courses: Made With ML (made-with-ml); MLOps Zoomcamp (mlops-zoomcamp)

### Engineering an ML codebase

- [ ] Structuring an ML codebase: configuration and reproducibility
- [ ] Data versioning
- [ ] Testing ML code: data, model and behaviour tests
- [ ] Training pipelines as code
    - _Designing Machine Learning Systems — Chip Huyen_

### Experiment tracking

- [ ] Experiment tracking with MLflow
- [ ] Hyperparameter search
- [ ] A model registry and model versions
- [ ] Comparing runs honestly: seeds, variance and baselines
    - _MLflow documentation — MLflow project_

### Practice

- [ ] Practice: Problem set, turn a notebook into a tracked, tested training pipeline that reproduces its numbers

**Capstone**

- [ ] Project: An ML project end to end, with tracked experiments and honest evaluation (project: ml-project)

## 2. Data and features — CORE

Courses: Machine Learning Systems Design (ml-systems-design)

### Features

- [ ] Feature engineering at scale
- [ ] Point-in-time correct joins
- [ ] Feature stores: offline and online
- [ ] Training-serving skew
- [ ] Labelling and weak supervision
    - _Feast documentation — Feast project_

### Data for models

- [ ] Data validation for ML
- [ ] Class imbalance in production data
- [ ] Leakage in pipelines
    - _Rules of Machine Learning — Martin Zinkevich_

### Practice

- [ ] Practice: Case study, a fraud model that looked great offline: find the leak

**Capstone**

- [ ] Project: A feature store with point-in-time joins, served the same offline and online

## 3. Serving — CORE

Courses: Full Stack Deep Learning labs (fsdl-labs); Machine Learning Engineering Open Book (ml-engineering)

### Serving models

- [ ] Batch and online prediction
- [ ] Serving APIs and latency budgets
- [ ] Model formats: ONNX and TorchScript
- [ ] Quantisation and distillation for inference
- [ ] Batching and GPU utilisation
- [ ] Serving LLMs: the KV cache and continuous batching
    - _Machine Learning Engineering Open Book — Stas Bekman_

### Releasing models

- [ ] Shadow deployments, canaries and A/B tests
- [ ] Rollbacks and model versions in production

### Practice

- [ ] Practice: Problem set, serve a model behind an API within a 50 ms p99 budget and load-test it

**Capstone**

- [ ] Project: Model serving with versions, rollbacks and a latency budget

## 4. Monitoring and the feedback loop — CORE

Courses: MLOps Zoomcamp (mlops-zoomcamp)

### Watching models

- [ ] Data drift and concept drift
- [ ] Monitoring with delayed labels
- [ ] Production metrics and alerting
- [ ] Explaining and debugging predictions
- [ ] Retraining triggers and continual learning
    - _Evidently documentation — Evidently AI_

### Practice

- [ ] Practice: Case study, catch a shifted input before accuracy drops and decide whether to retrain

**Capstone**

- [ ] Project: An ML system with a feature store, serving and monitoring (project: ml-platform)

## 5. ML platforms and scale — SUPPORTING

### Platforms

- [ ] Orchestrating training: Kubeflow, Airflow and Ray
- [ ] Distributed training: data and model parallelism
- [ ] GPU cost and capacity planning
- [ ] Responsible ML: fairness checks and model cards
    - _Reliable Machine Learning — Cathy Chen, Niall Richard Murphy, Kranti Parisa, D. Sculley and Todd Underwood_
    - _Hidden Technical Debt in Machine Learning Systems — D. Sculley et al._
