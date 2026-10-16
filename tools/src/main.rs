mod features;
mod oeis;
mod out;
mod terms;

use std::path::PathBuf;
use std::process::ExitCode;
use std::time::Instant;

use rayon::prelude::*;

fn usage() -> ExitCode {
    eprintln!(
        "usage: atlas features <stripped.gz> <names.gz> <out-dir> [--oeisdata <dir>] [--min-terms N]"
    );
    ExitCode::from(2)
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.len() < 4 || args[0] != "features" {
        return usage();
    }
    let stripped = PathBuf::from(&args[1]);
    let names = PathBuf::from(&args[2]);
    let out_dir = PathBuf::from(&args[3]);
    let mut oeisdata: Option<PathBuf> = None;
    let mut min_terms = 10usize;
    let mut i = 4;
    while i < args.len() {
        match args[i].as_str() {
            "--oeisdata" if i + 1 < args.len() => {
                oeisdata = Some(PathBuf::from(&args[i + 1]));
                i += 2;
            }
            "--min-terms" if i + 1 < args.len() => {
                min_terms = args[i + 1].parse().unwrap_or(min_terms);
                i += 2;
            }
            _ => return usage(),
        }
    }

    let t0 = Instant::now();
    let mut entries = match oeis::load_dumps(&stripped, &names) {
        Ok(e) => e,
        Err(e) => {
            eprintln!("reading dumps: {e}");
            return ExitCode::FAILURE;
        }
    };
    eprintln!("dumps: {} sequences in {:.1?}", entries.len(), t0.elapsed());

    if let Some(dir) = &oeisdata {
        let t = Instant::now();
        let n = oeis::merge_oeisdata(dir, &mut entries);
        eprintln!("oeisdata: {n} entries merged in {:.1?}", t.elapsed());
    }

    entries.retain(|e| e.terms.len() >= min_terms);
    eprintln!("kept {} with at least {min_terms} terms", entries.len());

    let t = Instant::now();
    let rows: Vec<Vec<f32>> = entries
        .par_iter()
        .map(|e| features::compute(&e.terms, e.offset))
        .collect();
    eprintln!(
        "features: {} columns in {:.1?}",
        features::columns().len(),
        t.elapsed()
    );

    if let Err(e) = out::write(&out_dir, &entries, &rows) {
        eprintln!("writing output: {e}");
        return ExitCode::FAILURE;
    }
    eprintln!("done in {:.1?}", t0.elapsed());
    ExitCode::SUCCESS
}
