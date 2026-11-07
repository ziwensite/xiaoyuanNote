use app_lib::commands::copy_file_inner as copy_file;
use std::fs;

#[test]
fn copy_creates_parent_dirs() {
    let dir = tempfile::tempdir().unwrap();
    let src = dir.path().join("solomd-copy-src.png").to_string_lossy().to_string();
    let dst = dir
        .path()
        .join("solomd-copy-test")
        .join("_assets")
        .join("nested")
        .join("image.png")
        .to_string_lossy()
        .to_string();
    let bytes: Vec<u8> = vec![0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]; // PNG header
    fs::write(&src, &bytes).unwrap();

    copy_file(src, dst.clone()).unwrap();

    let copied = fs::read(&dst).unwrap();
    assert_eq!(copied, vec![0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
}

#[test]
fn copy_overwrites_existing() {
    let dir = tempfile::tempdir().unwrap();
    let src = dir.path().join("solomd-copy-src2.png").to_string_lossy().to_string();
    let dst = dir.path().join("solomd-copy-dst2.png").to_string_lossy().to_string();
    fs::write(&src, b"new").unwrap();
    fs::write(&dst, b"old").unwrap();

    copy_file(src, dst.clone()).unwrap();

    assert_eq!(fs::read(&dst).unwrap(), b"new");
}

#[test]
fn copy_missing_source_errors() {
    let dir = tempfile::tempdir().unwrap();
    let src = dir.path().join("solomd-does-not-exist.png").to_string_lossy().to_string();
    let dst = dir.path().join("solomd-dst-fail.png").to_string_lossy().to_string();
    let result = copy_file(src, dst);
    assert!(result.is_err());
}

#[test]
fn write_binary_creates_parent_dirs() {
    use app_lib::commands::write_binary_file_inner as write_binary_file;
    let dir = tempfile::tempdir().unwrap();
    let path = dir
        .path()
        .join("solomd-bin-test")
        .join("sub")
        .join("dir")
        .join("file.bin")
        .to_string_lossy()
        .to_string();
    write_binary_file(path.clone(), vec![1, 2, 3, 4]).unwrap();
    assert_eq!(fs::read(&path).unwrap(), vec![1, 2, 3, 4]);
}
