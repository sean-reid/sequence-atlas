//! One parsed term: sign, decimal digits, and the derived forms the features use.

/// The Mersenne prime 2^61 - 1. Every exact test runs modulo this field.
pub const P: u64 = (1u64 << 61) - 1;

/// lcm(1..=16); a term reduced mod this gives its residue for every small modulus.
pub const SMALL_LCM: u64 = 720_720;

#[derive(Clone, Debug)]
pub struct Term {
    pub neg: bool,
    pub zero: bool,
    /// log10 of the absolute value; 0 for a zero term.
    pub log10: f64,
    /// Signed value as f64, infinite past the f64 range.
    pub approx: f64,
    /// Signed value in the field mod P.
    pub modp: u64,
    /// Absolute value mod SMALL_LCM.
    pub small: u32,
    /// Absolute value when it fits in a u64.
    pub exact: Option<u64>,
}

pub fn mulmod(a: u64, b: u64) -> u64 {
    ((a as u128 * b as u128) % P as u128) as u64
}

pub fn addmod(a: u64, b: u64) -> u64 {
    let s = a + b;
    if s >= P { s - P } else { s }
}

pub fn submod(a: u64, b: u64) -> u64 {
    if a >= b { a - b } else { a + P - b }
}

pub fn powmod(mut a: u64, mut e: u64) -> u64 {
    let mut r = 1;
    a %= P;
    while e > 0 {
        if e & 1 == 1 {
            r = mulmod(r, a);
        }
        a = mulmod(a, a);
        e >>= 1;
    }
    r
}

pub fn invmod(a: u64) -> u64 {
    powmod(a, P - 2)
}

pub fn parse(text: &str) -> Option<Term> {
    let (neg, body) = match text.strip_prefix('-') {
        Some(rest) => (true, rest),
        None => (false, text),
    };
    if body.is_empty() || !body.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let body = body.trim_start_matches('0');
    if body.is_empty() {
        return Some(Term {
            neg: false,
            zero: true,
            log10: 0.0,
            approx: 0.0,
            modp: 0,
            small: 0,
            exact: Some(0),
        });
    }
    let mut modp: u64 = 0;
    let mut small: u64 = 0;
    for b in body.bytes() {
        let d = (b - b'0') as u64;
        modp = addmod(mulmod(modp, 10), d);
        small = (small * 10 + d) % SMALL_LCM;
    }
    if neg && modp != 0 {
        modp = P - modp;
    }
    let digits = body.len() as u32;
    let lead: f64 = body[..body.len().min(17)].parse().unwrap_or(1.0);
    let log10 = (digits.saturating_sub(17.min(digits)) as f64) + lead.log10();
    let magnitude: f64 = body.parse().unwrap_or(f64::INFINITY);
    let exact = if digits <= 19 {
        body.parse::<u64>().ok()
    } else {
        None
    };
    Some(Term {
        neg,
        zero: false,
        log10,
        approx: if neg { -magnitude } else { magnitude },
        modp,
        small: small as u32,
        exact,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_signs_zero_and_big_values() {
        let t = parse("-120").unwrap();
        assert!(t.neg && t.exact == Some(120) && t.modp == P - 120);
        assert!((t.log10 - 120f64.log10()).abs() < 1e-12);
        let z = parse("0").unwrap();
        assert!(z.zero && z.modp == 0);
        let big = parse(&"9".repeat(30)).unwrap();
        assert!(big.exact.is_none());
        assert!((big.log10 - 30.0).abs() < 1e-9);
        assert_eq!(
            big.small as u64,
            999_999_999_999_999_999_999_999_999_999u128.rem_euclid(SMALL_LCM as u128) as u64
        );
        assert!(parse("1a").is_none());
    }
}
