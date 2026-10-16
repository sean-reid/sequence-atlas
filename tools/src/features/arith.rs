use crate::terms::{SMALL_LCM, Term};

use super::period;

pub const MODULI: [u32; 10] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 16];

pub fn names() -> Vec<&'static str> {
    let mut v: Vec<&'static str> = Vec::new();
    for m in MODULI {
        v.push(Box::leak(format!("a_entropy_mod{m}").into_boxed_str()));
        v.push(Box::leak(format!("a_top_share_mod{m}").into_boxed_str()));
        v.push(Box::leak(format!("a_period_mod{m}").into_boxed_str()));
    }
    v.extend([
        "a_frac_prime",
        "a_frac_distinct",
        "a_frac_square",
        "a_frac_pow2",
        "a_gcd_log",
        "a_frac_even",
        "a_parity_run",
        "a_frac_adjacent_equal",
        "a_frac_coprime_adjacent",
        "a_multiplicative",
        "a_digit_sum_mean",
    ]);
    v
}

pub fn push(terms: &[Term], row: &mut Vec<f32>) {
    let n = terms.len();
    let nf = n as f64;
    for m in MODULI {
        debug_assert_eq!(SMALL_LCM % m as u64, 0);
        let residues: Vec<u32> = terms
            .iter()
            .map(|t| {
                let r = t.small % m;
                if t.neg && r != 0 { m - r } else { r }
            })
            .collect();
        let mut counts = vec![0usize; m as usize];
        for &r in &residues {
            counts[r as usize] += 1;
        }
        let entropy: f64 = counts
            .iter()
            .filter(|&&c| c > 0)
            .map(|&c| {
                let p = c as f64 / nf;
                -p * p.ln()
            })
            .sum::<f64>()
            / (m as f64).ln();
        let top = *counts.iter().max().unwrap_or(&0) as f64 / nf;
        let per = period(&residues, 0, 24).map_or(0.0, |p| 1.0 / p as f64);
        row.push(entropy as f32);
        row.push(top as f32);
        row.push(per as f32);
    }

    let exact: Vec<u64> = terms.iter().filter_map(|t| t.exact).collect();
    let frac_prime = if exact.is_empty() {
        0.0
    } else {
        exact.iter().filter(|&&v| is_prime(v)).count() as f64 / exact.len() as f64
    };
    let frac_square = if exact.is_empty() {
        0.0
    } else {
        exact.iter().filter(|&&v| is_square(v)).count() as f64 / exact.len() as f64
    };
    let frac_pow2 = if exact.is_empty() {
        0.0
    } else {
        exact.iter().filter(|&&v| v > 0 && v & (v - 1) == 0).count() as f64 / exact.len() as f64
    };

    let mut seen: Vec<(bool, u64, f64)> = terms.iter().map(|t| (t.neg, t.modp, t.log10)).collect();
    seen.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    seen.dedup();
    let frac_distinct = seen.len() as f64 / nf;

    let gcd_log = {
        let g = terms
            .iter()
            .filter_map(|t| t.exact)
            .filter(|&v| v > 0)
            .fold(0u64, gcd);
        let any_big = terms.iter().any(|t| !t.zero && t.exact.is_none());
        if g == 0 || any_big {
            0.0
        } else {
            (g as f64).log10()
        }
    };

    let even = |t: &Term| t.small.is_multiple_of(2);
    let frac_even = terms.iter().filter(|t| even(t)).count() as f64 / nf;
    let mut best_run = 0usize;
    let mut run = 0usize;
    let mut last = None;
    for t in terms {
        let e = even(t);
        if last == Some(e) {
            run += 1
        } else {
            run = 1
        }
        best_run = best_run.max(run);
        last = Some(e);
    }
    let pairs = (n - 1).max(1) as f64;
    let adjacent_equal = terms
        .windows(2)
        .filter(|w| w[0].modp == w[1].modp && w[0].neg == w[1].neg)
        .count() as f64
        / pairs;
    let coprime_adjacent = terms
        .windows(2)
        .filter(|w| match (w[0].exact, w[1].exact) {
            (Some(a), Some(b)) => gcd(a, b) == 1,
            _ => false,
        })
        .count() as f64
        / pairs;

    let multiplicative = multiplicativity(terms);
    let digit_sum_mean = terms
        .iter()
        .map(|t| (t.log10.max(0.0) + 1.0) * 4.5)
        .sum::<f64>()
        / nf
        / 10.0;

    for v in [
        frac_prime,
        frac_distinct,
        frac_square,
        frac_pow2,
        gcd_log,
        frac_even,
        best_run as f64 / nf,
        adjacent_equal,
        coprime_adjacent,
        multiplicative,
        digit_sum_mean,
    ] {
        row.push(v as f32);
    }
}

/// Share of coprime index pairs (m, k) with a(mk) = a(m) a(k), taking the first
/// term as a(1). Zero when fewer than five pairs are testable.
fn multiplicativity(terms: &[Term]) -> f64 {
    let n = terms.len();
    let mut tested = 0;
    let mut held = 0;
    for m in 2..n {
        for k in (m + 1)..n {
            if m * k > n || gcd(m as u64, k as u64) != 1 {
                continue;
            }
            tested += 1;
            let lhs = terms[m * k - 1].modp;
            let rhs = crate::terms::mulmod(terms[m - 1].modp, terms[k - 1].modp);
            if lhs == rhs {
                held += 1;
            }
        }
    }
    if tested < 5 {
        0.0
    } else {
        held as f64 / tested as f64
    }
}

pub fn gcd(mut a: u64, mut b: u64) -> u64 {
    while b != 0 {
        (a, b) = (b, a % b);
    }
    a
}

fn is_square(v: u64) -> bool {
    let r = (v as f64).sqrt() as u64;
    (r.saturating_sub(1)..=r + 1).any(|s| s * s == v)
}

fn mulmod_n(a: u64, b: u64, m: u64) -> u64 {
    ((a as u128 * b as u128) % m as u128) as u64
}

fn powmod_n(mut a: u64, mut e: u64, m: u64) -> u64 {
    let mut r = 1u64;
    a %= m;
    while e > 0 {
        if e & 1 == 1 {
            r = mulmod_n(r, a, m);
        }
        a = mulmod_n(a, a, m);
        e >>= 1;
    }
    r
}

/// Deterministic Miller-Rabin for u64.
pub fn is_prime(n: u64) -> bool {
    if n < 2 {
        return false;
    }
    for p in [2u64, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37] {
        if n.is_multiple_of(p) {
            return n == p;
        }
    }
    let mut d = n - 1;
    let mut s = 0;
    while d.is_multiple_of(2) {
        d /= 2;
        s += 1;
    }
    'witness: for a in [2u64, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37] {
        let mut x = powmod_n(a, d, n);
        if x == 1 || x == n - 1 {
            continue;
        }
        for _ in 1..s {
            x = mulmod_n(x, x, n);
            if x == n - 1 {
                continue 'witness;
            }
        }
        return false;
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::terms;

    #[test]
    fn primality_and_squares() {
        assert!(is_prime(2) && is_prime(97) && is_prime(1_000_000_007));
        assert!(!is_prime(1) && !is_prime(561) && !is_prime(1_000_000_007 * 3));
        assert!(is_square(0) && is_square(144) && !is_square(145));
    }

    #[test]
    fn sigma_is_multiplicative_and_primes_are_not() {
        let sigma = [
            1, 3, 4, 7, 6, 12, 8, 15, 13, 18, 12, 28, 14, 24, 24, 31, 18, 39, 20, 42,
        ];
        let t: Vec<Term> = sigma
            .iter()
            .map(|v| terms::parse(&v.to_string()).unwrap())
            .collect();
        assert!((multiplicativity(&t) - 1.0).abs() < 1e-9);
        let primes = [
            2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71,
        ];
        let t: Vec<Term> = primes
            .iter()
            .map(|v| terms::parse(&v.to_string()).unwrap())
            .collect();
        assert!(multiplicativity(&t) < 0.2);
    }
}
