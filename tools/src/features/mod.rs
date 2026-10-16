//! Numeric features of a sequence, grouped into the families the atlas lays out.

mod arith;
mod growth;
mod recur;

use crate::terms::Term;

/// Terms past this index add noise, not signal, and some sequences list hundreds.
pub const MAX_TERMS: usize = 80;

pub struct Column {
    pub family: &'static str,
    pub name: &'static str,
}

pub fn columns() -> Vec<Column> {
    let mut cols = Vec::new();
    for name in growth::NAMES {
        cols.push(Column {
            family: "growth",
            name,
        });
    }
    for name in arith::names() {
        cols.push(Column {
            family: "arith",
            name,
        });
    }
    for name in recur::NAMES {
        cols.push(Column {
            family: "recur",
            name,
        });
    }
    cols
}

pub fn compute(terms: &[Term], offset: i32) -> Vec<f32> {
    let terms = &terms[..terms.len().min(MAX_TERMS)];
    let mut row = Vec::with_capacity(96);
    growth::push(terms, offset, &mut row);
    arith::push(terms, &mut row);
    recur::push(terms, offset, &mut row);
    assert_eq!(
        row.len(),
        columns().len(),
        "feature names and values disagree"
    );
    row
}

/// Least squares slope and residual RMS of y against x.
pub(crate) fn fit(xs: &[f64], ys: &[f64]) -> (f64, f64) {
    let n = xs.len() as f64;
    if n < 3.0 {
        return (0.0, 0.0);
    }
    let mx = xs.iter().sum::<f64>() / n;
    let my = ys.iter().sum::<f64>() / n;
    let mut sxx = 0.0;
    let mut sxy = 0.0;
    for (x, y) in xs.iter().zip(ys) {
        sxx += (x - mx) * (x - mx);
        sxy += (x - mx) * (y - my);
    }
    if sxx < 1e-12 {
        return (0.0, 0.0);
    }
    let slope = sxy / sxx;
    let intercept = my - slope * mx;
    let rss: f64 = xs
        .iter()
        .zip(ys)
        .map(|(x, y)| (y - (slope * x + intercept)).powi(2))
        .sum();
    (slope, (rss / n).sqrt())
}

/// Smallest period p in 1..=max such that v[i] == v[i + p] for every i, with the
/// comparison starting at `from`. None when nothing repeats.
pub(crate) fn period<T: PartialEq>(v: &[T], from: usize, max: usize) -> Option<usize> {
    let n = v.len();
    if n <= from + 2 {
        return None;
    }
    let span = n - from;
    (1..=max.min(span / 2)).find(|&p| (from..n - p).all(|i| v[i] == v[i + p]))
}
