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

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::*;
    use crate::oeis::{Entry, load_oeisdata};
    use crate::terms;

    fn fixture() -> Vec<Entry> {
        load_oeisdata(Path::new(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/oeisdata"
        )))
        .unwrap()
    }

    fn entry(entries: &[Entry], number: u32) -> &Entry {
        entries.iter().find(|e| e.number == number).unwrap()
    }

    fn column(name: &str) -> usize {
        columns().iter().position(|c| c.name == name).unwrap()
    }

    fn row_of(values: &[i64]) -> Vec<f32> {
        let t: Vec<Term> = values
            .iter()
            .map(|v| terms::parse(&v.to_string()).unwrap())
            .collect();
        compute(&t, 1)
    }

    #[test]
    fn every_fixture_row_is_finite_and_matches_the_column_list() {
        let entries = fixture();
        assert_eq!(entries.len(), 12);
        for e in &entries {
            let row = compute(&e.terms, e.offset);
            assert_eq!(row.len(), columns().len(), "A{:06}", e.number);
            assert!(row.iter().all(|v| v.is_finite()), "A{:06}", e.number);
        }
    }

    #[test]
    fn fit_recovers_an_exact_line() {
        let xs: Vec<f64> = (0..10).map(f64::from).collect();
        let ys: Vec<f64> = xs.iter().map(|x| 3.0 * x + 1.0).collect();
        let (slope, resid) = fit(&xs, &ys);
        assert!((slope - 3.0).abs() < 1e-12 && resid < 1e-12);
        assert_eq!(fit(&xs[..2], &ys[..2]), (0.0, 0.0));
    }

    #[test]
    fn growth_fits_match_the_closed_forms() {
        let entries = fixture();
        let squares = compute(&entry(&entries, 290).terms, 0);
        assert!((squares[column("g_poly_slope")] - 2.0).abs() < 0.05);
        assert!(squares[column("g_exp_slope")] < 0.05);
        let powers = compute(&entry(&entries, 79).terms, 0);
        assert!((powers[column("g_exp_slope")] as f64 - 2f64.log10()).abs() < 0.01);
        let factorials = compute(&entry(&entries, 142).terms, 0);
        let fact = factorials[column("g_fact_resid")];
        assert!(fact < factorials[column("g_poly_resid")]);
        assert!(fact < factorials[column("g_exp_resid")]);
    }

    #[test]
    fn period_of_an_alternating_sequence_is_two() {
        assert_eq!(period(&[1, -1, 1, -1, 1, -1, 1, -1], 0, 24), Some(2));
        assert_eq!(period(&[1, 2, 3, 4, 5, 6, 7, 8], 0, 24), None);
        assert_eq!(period(&[9, 1, 2, 1, 2, 1, 2, 1], 1, 24), Some(2));
    }

    #[test]
    fn parity_entropy_is_one_when_balanced_and_zero_when_all_even() {
        let alternating = row_of(&[1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2]);
        assert!((alternating[column("a_entropy_mod2")] - 1.0).abs() < 1e-6);
        assert_eq!(alternating[column("a_period_mod2")], 0.5);
        let even = row_of(&[2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24]);
        assert_eq!(even[column("a_entropy_mod2")], 0.0);
        assert_eq!(even[column("a_frac_even")], 1.0);
    }

    #[test]
    fn negative_terms_take_their_residue_in_the_ring() {
        // Every term is 2 mod 3, which only holds if -1 and -4 reduce to 2 and not to 1.
        let row = row_of(&[-1, 2, 5, -4, 8, -7, 11, -10, 14, -13, 17, -16]);
        assert_eq!(row[column("a_entropy_mod3")], 0.0);
        assert_eq!(row[column("a_top_share_mod3")], 1.0);
        assert!((row[column("g_frac_neg")] - 0.5).abs() < 1e-6);
    }

    #[test]
    fn gcd_log_of_multiples_of_six() {
        let row = row_of(&[6, 12, 18, 24, 30, 36, 42, 48, 54, 60, 66, 72]);
        assert!((row[column("a_gcd_log")] as f64 - 6f64.log10()).abs() < 1e-6);
    }
}
