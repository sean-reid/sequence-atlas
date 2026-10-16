use crate::terms::Term;

use super::fit;

pub const NAMES: [&str; 20] = [
    "g_log_count",
    "g_log_last",
    "g_log_max",
    "g_poly_slope",
    "g_poly_resid",
    "g_exp_slope",
    "g_exp_resid",
    "g_fact_slope",
    "g_fact_resid",
    "g_ratio_last",
    "g_ratio_trend",
    "g_frac_neg",
    "g_frac_zero",
    "g_sign_changes",
    "g_frac_nondecreasing",
    "g_frac_increasing",
    "g_frac_one",
    "g_frac_small",
    "g_log_first",
    "g_curvature",
];

pub fn push(terms: &[Term], offset: i32, row: &mut Vec<f32>) {
    let n = terms.len();
    let nf = n as f64;
    // Index of each term as a positive real, so log n is defined from the first.
    let idx = |i: usize| ((i as i64 + offset as i64 - 1).max(0) + 1) as f64;

    let nonzero: Vec<(usize, f64)> = terms
        .iter()
        .enumerate()
        .filter(|(_, t)| !t.zero)
        .map(|(i, t)| (i, t.log10))
        .collect();
    let xs_poly: Vec<f64> = nonzero.iter().map(|(i, _)| idx(*i).log10()).collect();
    let xs_exp: Vec<f64> = nonzero.iter().map(|(i, _)| idx(*i)).collect();
    let xs_fact: Vec<f64> = nonzero
        .iter()
        .map(|(i, _)| {
            let k = idx(*i);
            k * k.log10() - k / std::f64::consts::LN_10
        })
        .collect();
    let ys: Vec<f64> = nonzero.iter().map(|(_, l)| *l).collect();
    let (poly_slope, poly_resid) = fit(&xs_poly, &ys);
    let (exp_slope, exp_resid) = fit(&xs_exp, &ys);
    let (fact_slope, fact_resid) = fit(&xs_fact, &ys);

    let ratios: Vec<(f64, f64)> = terms
        .windows(2)
        .enumerate()
        .filter(|(_, w)| !w[0].zero && !w[1].zero)
        .map(|(i, w)| (idx(i + 1), w[1].log10 - w[0].log10))
        .collect();
    let ratio_last = ratios.last().map_or(0.0, |r| r.1);
    let rx: Vec<f64> = ratios.iter().map(|r| r.0).collect();
    let ry: Vec<f64> = ratios.iter().map(|r| r.1).collect();
    let (ratio_trend, _) = fit(&rx, &ry);

    let frac = |pred: &dyn Fn(&Term) -> bool| terms.iter().filter(|t| pred(t)).count() as f64 / nf;
    let pairs = (n - 1).max(1) as f64;
    let sign = |t: &Term| {
        if t.zero {
            0i8
        } else if t.neg {
            -1
        } else {
            1
        }
    };
    let sign_changes = terms
        .windows(2)
        .filter(|w| sign(&w[0]) * sign(&w[1]) < 0)
        .count() as f64
        / pairs;
    let nondec = terms
        .windows(2)
        .filter(|w| w[1].approx >= w[0].approx)
        .count() as f64
        / pairs;
    let inc = terms
        .windows(2)
        .filter(|w| w[1].approx > w[0].approx)
        .count() as f64
        / pairs;

    let log_max = terms.iter().map(|t| t.log10).fold(0.0, f64::max);
    let log_first = terms.first().map_or(0.0, |t| t.log10);
    let log_last = terms.last().map_or(0.0, |t| t.log10);
    // Second difference of log magnitude between the first, middle, and last nonzero terms.
    let curvature = if ys.len() >= 3 {
        let m = ys.len() / 2;
        (ys[ys.len() - 1] - ys[m]) - (ys[m] - ys[0])
    } else {
        0.0
    };

    for v in [
        nf.log10(),
        log_last,
        log_max,
        poly_slope,
        poly_resid,
        exp_slope,
        exp_resid,
        fact_slope,
        fact_resid,
        ratio_last,
        ratio_trend,
        frac(&|t| t.neg),
        frac(&|t| t.zero),
        sign_changes,
        nondec,
        inc,
        frac(&|t| t.exact == Some(1)),
        frac(&|t| t.exact.is_some_and(|v| v <= 9)),
        log_first,
        curvature,
    ] {
        row.push(v as f32);
    }
}
