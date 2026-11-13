---
video_url: https://www.youtube.com/watch?v=0000000000a
next_url: 02-ml-vs-rules.md
---
# What machine learning is

In this lesson we look at machine learning through one example: suggesting a price for a used car on a website where people sell them.

<a href="https://www.youtube.com/watch?v=0000000000a"><img src="images/thumbnail-1-1.jpg" alt="Watch the video for 1.1"></a>

[Slides](https://www.slideshare.net/example/ml-intro) · [Notebook](notebook.ipynb)

## The problem

A seller uploads a photo, writes a title and reaches the price field. Too high and nobody buys; too low and they lose money. We can suggest a price from the cars already on the site.

![The price field in the form for a car ad](images/01-price-field.jpg)

## Features and target

- Features: everything we know about a car (its age, make, mileage).
- Target: what we want to predict (its price).

The model learns a function $g$ with $g(X) \approx y$:

$$
\hat{y} = g(X)
$$

```python
import pandas as pd

df = pd.read_csv('cars.csv')
X = df[['year', 'mileage']]
y = df['price']
```

![Features and the target go into training; a model comes out](images/01-training.png)

## Making predictions

We put a new car's features into the model and it gives back a price. It won't be exact for one car, but it is right on average for cars like it.

To join the two tables, use `pd.merge`. If you sign up for a free Kaggle account you can also run the notebook there: [Kaggle](https://www.kaggle.com/code/example/car-prices).

## Notes

Machine learning extracts patterns from data: **features** describe an object and the **target** is what we predict for objects we haven't seen.

| Term | Meaning |
| --- | --- |
| Feature | Something we know about the object |
| Target | What we want to predict |
