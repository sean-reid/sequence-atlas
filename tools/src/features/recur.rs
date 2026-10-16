use crate::terms::{Term, addmod, invmod, mulmod, submod};

use super::period;

/// Orders above this are not reported; a recurrence needs twice its order in terms to mean anything.
pub const MAX_ORDER: usize = 12;
pub const MAX_DEGREE: usize = 10;

pub const NAMES: [&str; 10] = [
    "r_order",
    "r_found",
    "r_diff_degree",
    "r_poly",
    "r_diff_ratio",
    "r_diff2_ratio",
    "r_period",
    "r_periodic",
    "r_eventually_constant",
    "r_log_terms_per_order",
];

pub fn push(terms: &[Term], _offset: i32, row: &mut Vec<f32>) {
    let n = terms.len();
    let values: Vec<u64> = terms.iter().map(|t| t.modp).collect();

    let order = berlekamp_massey(&values);
    let found = order.is_some_and(|k| k <= MAX_ORDER && 2 * k + 2 <= n);
    let order_feature = if found {
        order.unwrap() as f64
    } else {
        MAX_ORDER as f64 + 1.0
    };

    let degree = difference_degree(&values);
    let poly = degree.is_some();
    let degree_feature = degree.map_or(MAX_DEGREE as f64 + 1.0, |d| d as f64);

    let log_max = terms.iter().map(|t| t.log10).fold(0.0, f64::max);
    let diffs: Vec<f64> = terms
        .windows(2)
        .map(|w| w[1].approx - w[0].approx)
        .collect();
    let diff_log_max = diffs
        .iter()
        .map(|d| d.abs())
        .fold(0.0, f64::max)
        .max(1.0)
        .log10();
    let diff2: Vec<f64> = diffs.windows(2).map(|w| w[1] - w[0]).collect();
    let diff2_log_max = diff2
        .iter()
        .map(|d| d.abs())
        .fold(0.0, f64::max)
        .max(1.0)
        .log10();
    let diff_ratio = if diff_log_max.is_finite() {
        diff_log_max - log_max
    } else {
        0.0
    };
    let diff2_ratio = if diff2_log_max.is_finite() {
        diff2_log_max - log_max
    } else {
        0.0
    };

    let per = period(&values, 0, 24);
    let tail = n / 2;
    let eventually_constant =
        values.len() > tail + 2 && values[tail..].windows(2).all(|w| w[0] == w[1]);

    for v in [
        order_feature,
        found as u8 as f64,
        degree_feature,
        poly as u8 as f64,
        diff_ratio,
        diff2_ratio,
        per.map_or(0.0, |p| 1.0 / p as f64),
        per.is_some() as u8 as f64,
        eventually_constant as u8 as f64,
        if found {
            (n as f64 / order.unwrap().max(1) as f64).log10()
        } else {
            0.0
        },
    ] {
        row.push(v as f32);
    }
}

/// Order of the shortest linear recurrence with constant coefficients that
/// generates the whole sequence, over the field mod P. None when the shortest
/// one is longer than half the sequence, which any sequence trivially has.
pub fn berlekamp_massey(s: &[u64]) -> Option<usize> {
    let n = s.len();
    let mut c = vec![0u64; n + 1];
    let mut b = vec![0u64; n + 1];
    c[0] = 1;
    b[0] = 1;
    let mut l = 0usize;
    let mut m = 1usize;
    let mut bb = 1u64;
    for i in 0..n {
        let mut d = s[i];
        for j in 1..=l {
            d = addmod(d, mulmod(c[j], s[i - j]));
        }
        if d == 0 {
            m += 1;
            continue;
        }
        let t = c.clone();
        let coef = mulmod(d, invmod(bb));
        for j in m..=n {
            c[j] = submod(c[j], mulmod(coef, b[j - m]));
        }
        if 2 * l <= i {
            l = i + 1 - l;
            b = t;
            bb = d;
            m = 1;
        } else {
            m += 1;
        }
    }
    if l == 0 && s.iter().all(|&v| v == 0) {
        return Some(0);
    }
    if 2 * l < n { Some(l) } else { None }
}

/// Smallest d with all d-th forward differences zero, when at least two of them exist.
pub fn difference_degree(values: &[u64]) -> Option<usize> {
    let mut cur = values.to_vec();
    for d in 0..=MAX_DEGREE {
        if cur.len() < 3 {
            return None;
        }
        if cur.iter().all(|&v| v == 0) {
            return Some(d);
        }
        cur = cur.windows(2).map(|w| submod(w[1], w[0])).collect();
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::terms;

    fn modp(v: &[i64]) -> Vec<u64> {
        v.iter()
            .map(|x| terms::parse(&x.to_string()).unwrap().modp)
            .collect()
    }

    #[test]
    fn fibonacci_has_order_two_and_squares_degree_three() {
        let fib = modp(&[0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610]);
        assert_eq!(berlekamp_massey(&fib), Some(2));
        let squares = modp(&[0, 1, 4, 9, 16, 25, 36, 49, 64, 81, 100, 121, 144]);
        assert_eq!(berlekamp_massey(&squares), Some(3));
        assert_eq!(difference_degree(&squares), Some(3));
        assert_eq!(difference_degree(&fib), None);
    }

    #[test]
    fn primes_have_no_short_recurrence() {
        let primes = modp(&[
            2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79,
        ]);
        assert_eq!(berlekamp_massey(&primes), None);
        assert_eq!(difference_degree(&primes), None);
    }

    #[test]
    fn signed_recurrences_work_in_the_field() {
        let alt = modp(&[1, -1, 1, -1, 1, -1, 1, -1, 1, -1]);
        assert_eq!(berlekamp_massey(&alt), Some(1));
        assert_eq!(period(&alt, 0, 24), Some(2));
    }
}
