fn main() {
    let dir = std::env::var("SESSION_ENGINE_DIR").unwrap_or_else(|_| {
        eprintln!("SESSION_ENGINE_DIR is not set");
        std::process::exit(1);
    });
    let engine = std::path::PathBuf::from(&dir).join("session-mail-engine.exe");
    let mut command = std::process::Command::new(&engine);
    command.envs(std::env::vars());
    match command.status() {
        Ok(status) => std::process::exit(status.code().unwrap_or(1)),
        Err(err) => {
            eprintln!("Couldn't start {}: {err}", engine.display());
            std::process::exit(1);
        }
    }
}
