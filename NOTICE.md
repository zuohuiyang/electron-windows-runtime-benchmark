# Scope and third-party material

This repository is a benchmark evidence and PR discussion archive. Electron/Chromium build patches and source references retain their upstream licensing; this archive does not grant a new license for upstream code or fixtures.

The media fixtures and runtime binaries are not redistributed. See `harness/MEDIA.md` for the exact upstream video, hash and setup. The earlier unused MP4 is omitted as well. User profiles, login configuration, credentials, machine-wide settings and process/service diagnostic inventories are not included.

Raw records retain their original bytes, including generic benchmark paths, sample IDs, process IDs, timestamps and the dedicated test account name. These are provenance, not portable runtime configuration. Public file hashes verify the archive bytes; they are not independent proof of the physical conditions of the original run.

The two effective-args.txt exports replace only the inherited toolchain PATH string with `<REDACTED_MACHINE_PATH>` to omit private home directories and unrelated installed software. SOURCE-FILES.json records both the original and exported hashes; build manifests retain the original hashes. Feature arguments and raw measurement records are unchanged.

No standalone license for newly authored benchmark code has been selected yet. Before asking upstream to incorporate that code, confirm its licensing; access to the public evidence itself should not be described as granting an upstream license.
